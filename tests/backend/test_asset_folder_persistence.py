"""Synthetic upgrade/persistence proofs; never inspect or mutate user storage."""
from contextlib import closing
import json
import os
import hashlib
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from backend.assets.folders import AssetFolders
from backend.contracts.database import Database, APPLICATION_ID, _MIGRATIONS
from backend.contracts.errors import Conflict, InvalidInput, StorageError
from tools.migration.sqlite_snapshot import snapshot_sqlite, sqlite_logical_digest

class FolderPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='studio-folder-proof-');self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.path=self.root/'studio.db'
        with closing(sqlite3.connect(self.path)) as c:
            for version in range(1,5):
                for statement in _MIGRATIONS[version]:c.execute(statement)
            c.execute(f'PRAGMA application_id={APPLICATION_ID}');c.execute('PRAGMA user_version=4')
            c.execute("INSERT INTO assets(asset_id,identity_key,kind,text_snapshot,created_at) VALUES('old-id','old-key','text','Original text','original-time')")
            c.execute("INSERT INTO favorites(favorite_id,asset_id,display_name,created_at) VALUES('old-favorite','old-id','Original favorite','original-time')")
            c.commit()
        self.original=self.root/'original-workflow.json';self.original.write_text('{"assetId":"old-id","text":"unchanged"}')
        self.original_bytes=self.original.read_bytes();self.before=self.tables()
        self.db=Database(self.path);self.folders=AssetFolders(self.db,self.root/'asset-library')
    def evidence(self,name,value):
        destination=os.environ.get('STUDIO_FOLDER_EVIDENCE_DIR')
        if destination:
            folder=Path(destination);folder.mkdir(parents=True,exist_ok=True)
            (folder/(name+'.json')).write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
    def tables(self):
        with closing(sqlite3.connect(self.path)) as c:
            return {name:c.execute('SELECT * FROM "'+name+'"').fetchall() for (name,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'asset_folders'")}
    def unchanged(self):
        self.assertEqual(self.tables(),self.before);self.assertEqual(self.original.read_bytes(),self.original_bytes)
    def test_01_schema4_upgrade_changes_no_existing_rows_or_workflow(self):
        self.unchanged();self.assertEqual(self.folders.list(),[])
        with self.db.read() as c:self.assertEqual(c.execute('PRAGMA user_version').fetchone()[0],5)
        self.evidence('01-upgrade',{'beforeSchema':4,'afterSchema':5,'beforeRows':self.before,'afterRows':self.tables(),'workflowSha256':hashlib.sha256(self.original_bytes).hexdigest(),'folders':self.folders.list()})
    def test_02_creation_only_adds_owned_directories_and_survives_new_process(self):
        first=self.folders.create('root','Characters');child=self.folders.create(first['folderId'],'Hero')
        self.assertTrue((self.folders.root/'Characters/Hero').is_dir())
        other=self.folders.create('root','Scenes');self.folders.create(other['folderId'],'Hero')
        with self.assertRaises(Conflict):self.folders.create(first['folderId'],'HERO')
        code="from backend.contracts.database import Database;from backend.assets.folders import AssetFolders;import json,sys;print(json.dumps(AssetFolders(Database(sys.argv[1]),sys.argv[2]).list()))"
        reopened=json.loads(subprocess.check_output([sys.executable,'-c',code,str(self.path),str(self.folders.root)],text=True))
        self.assertEqual(sorted(reopened,key=lambda f:f['folderId']),sorted(self.folders.list(),key=lambda f:f['folderId']))
        self.assertEqual(next(f for f in reopened if f['folderId']==child['folderId'])['relativePath'],'Characters/Hero')
        self.unchanged()
        self.evidence('02-only-new',{'folders':reopened,'physicalDirectories':sorted(p.relative_to(self.folders.root).as_posix() for p in self.folders.root.rglob('*')),'existingRowsUnchanged':self.tables()==self.before,'newProcessRead':True})
    def test_03_snapshot_roundtrip_keeps_rows_ids_paths_and_physical_directories(self):
        self.folders.create('root','Characters');raw=snapshot_sqlite(self.path)
        restored=self.root/'restore';restored.mkdir();copy=restored/'studio.db';copy.write_bytes(raw)
        shutil.copytree(self.folders.root,restored/'asset-library')
        folders=AssetFolders(Database(copy),restored/'asset-library')
        self.assertEqual(folders.list(),self.folders.list());self.assertTrue((folders.root/'Characters').is_dir())
        self.assertEqual(sqlite_logical_digest(snapshot_sqlite(copy)),sqlite_logical_digest(raw));self.unchanged()
        self.evidence('03-snapshot-roundtrip',{'original':self.folders.list(),'restored':folders.list(),'logicalDigest':sqlite_logical_digest(raw),'physicalCopyExists':(folders.root/'Characters').is_dir()})
    def test_04_failure_preserves_database_and_leaves_no_physical_directory(self):
        for name in ('','../escape','CON','bad/name'):
            with self.assertRaises(InvalidInput):self.folders.create('root',name)
        mkdir=Path.mkdir
        def denied(path,*args,**kwargs):
            if path.name=='Denied':raise PermissionError('synthetic denial')
            return mkdir(path,*args,**kwargs)
        with patch.object(Path,'mkdir',denied):
            with self.assertRaises(StorageError):self.folders.create('root','Denied')
        self.assertEqual(self.folders.list(),[]);self.assertFalse((self.folders.root/'Denied').exists());self.unchanged()
        with self.db.transaction() as c:
            c.execute("CREATE TRIGGER reject_folder BEFORE INSERT ON asset_folders WHEN NEW.name='Rollback' BEGIN SELECT RAISE(ABORT,'synthetic publication failure'); END")
        with self.assertRaises(StorageError):self.folders.create('root','Rollback')
        self.assertFalse((self.folders.root/'Rollback').exists());self.assertEqual(self.folders.list(),[]);self.unchanged()
        self.evidence('04-failure',{'invalidNamesRejected':4,'permissionFailureRejected':True,'publicationFailureRolledBack':True,'folders':self.folders.list(),'existingRowsUnchanged':self.tables()==self.before,'orphanDirectories':list(p.name for p in self.folders.root.iterdir())})
