"""Library folders share the asset database and own only newly created directories."""
import unicodedata
import uuid
from pathlib import Path

from ..contracts.errors import Conflict, InvalidInput, MissingRecord, StorageError

ROOT_FOLDER = 'root'
_RESERVED = {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(10)), *(f'LPT{i}' for i in range(10))}


def folder_name(value):
    if not isinstance(value, str):
        raise InvalidInput('请输入文件夹名称')
    name = unicodedata.normalize('NFC', value.strip())
    if not name or len(name) > 64:
        raise InvalidInput('文件夹名称须为 1–64 个字符')
    if (name in {'.', '..'} or name.endswith('.') or any(c in name for c in '/\\:*?"<>|')
            or not name.isprintable() or name.split('.')[0].upper() in _RESERVED):
        raise InvalidInput('文件夹名称包含不可用字符或保留名称')
    return name


class AssetFolders:
    def __init__(self, database, root):
        self.database, self.root = database, Path(root)

    @staticmethod
    def public(row):
        return {'folderId': row['folder_id'], 'parentId': row['parent_id'],
                'name': row['name'], 'relativePath': row['relative_path']}

    def list(self):
        with self.database.read() as connection:
            rows = connection.execute('SELECT * FROM asset_folders WHERE folder_id != ? ORDER BY created_at,folder_id', (ROOT_FOLDER,)).fetchall()
        return [self.public(row) for row in rows]

    def get(self, folder_id):
        with self.database.read() as connection:
            row = connection.execute('SELECT * FROM asset_folders WHERE folder_id = ?', (folder_id,)).fetchone()
        if row is None:
            raise MissingRecord('文件夹不存在，请刷新目录')
        return self.public(row)

    def create(self, parent_id, value):
        name = folder_name(value)
        if not isinstance(parent_id, str) or not parent_id:
            raise InvalidInput('缺少父文件夹')
        target, created, published = None, False, False
        try:
            with self.database.transaction() as connection:
                parent = connection.execute('SELECT * FROM asset_folders WHERE folder_id = ?', (parent_id,)).fetchone()
                if parent is None:
                    raise MissingRecord('父文件夹不存在，请刷新目录')
                if connection.execute('SELECT 1 FROM asset_folders WHERE parent_id = ? AND name_key = ?', (parent_id, name.casefold())).fetchone():
                    raise Conflict('当前目录已有同名文件夹')
                if self.root.is_symlink():
                    raise StorageError('素材库目录不可用')
                self.root.mkdir(exist_ok=True)
                parent_path = self.root / parent['relative_path']
                root = self.root.resolve()
                resolved_parent = parent_path.resolve()
                if not resolved_parent.is_relative_to(root) or parent_path.is_symlink() or not parent_path.is_dir():
                    raise StorageError('父目录不可用，未创建文件夹')
                target = parent_path / name
                if not target.resolve().is_relative_to(root):
                    raise InvalidInput('文件夹路径超出素材库')
                folder_id = str(uuid.uuid4())
                relative = target.relative_to(self.root).as_posix()
                # The write transaction serializes same-parent creation across clients.
                target.mkdir(exist_ok=False)
                created = True
                connection.execute('INSERT INTO asset_folders(folder_id,parent_id,name,name_key,relative_path) VALUES(?,?,?,?,?)',
                                   (folder_id, parent_id, name, name.casefold(), relative))
            published = True
            return {'folderId': folder_id, 'parentId': parent_id, 'name': name, 'relativePath': relative}
        except FileExistsError:
            raise Conflict('当前目录已存在同名文件或文件夹') from None
        except OSError:
            raise StorageError('目录写入失败，请检查权限后重试') from None
        finally:
            # Only remove our just-created, still-empty directory if DB publication failed.
            if created and not published:
                try:
                    target.rmdir()
                except OSError:
                    pass
