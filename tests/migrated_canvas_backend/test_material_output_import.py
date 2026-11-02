import importlib
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from PIL import Image
from unittest.mock import patch
from backend.contracts.errors import Conflict, StorageError
from backend.media import material_output_files as module
class MaterialOutputImportTest(unittest.TestCase):
 def test_installed_node_import_uses_package_relative_dependencies(self):
  with tempfile.TemporaryDirectory() as tmp:
   package=Path(tmp)/'ComfyUI-DAELab-Creative-Studio'
   shutil.copytree(Path(__file__).parents[2]/'backend',package/'backend',
                   ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
   (package/'__init__.py').write_text('',encoding='utf-8')
   script=r'''
import importlib,importlib.util,sys
from pathlib import Path
package=Path(sys.argv[1]);name='installed_creative_studio'
spec=importlib.util.spec_from_file_location(name,package/'__init__.py',submodule_search_locations=[str(package)])
loaded=importlib.util.module_from_spec(spec);sys.modules[name]=loaded;spec.loader.exec_module(loaded)
installed=importlib.import_module(name+'.backend.media.material_output_files')
assert callable(installed.import_materials)
'''
   environment={key:value for key,value in os.environ.items() if key!='PYTHONPATH'}
   result=subprocess.run([sys.executable,'-c',script,str(package)],cwd=tmp,env=environment,
                         capture_output=True,text=True,encoding='utf-8')
   self.assertEqual(result.returncode,0,result.stderr)
 def test_local_output_keeps_the_original_file_reference(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);i=root/'input';o=root/'output';i.mkdir();o.mkdir();Image.new('RGB',(8,8),'red').save(o/'a.png')
   assets=[dict(kind='image',id='one',url='/view?filename=a.png&type=output',provenance={'recordId':'row'})]
   first=module.import_materials(assets,i,o);self.assertEqual(first,module.import_materials(assets,i,o));self.assertEqual(first[0]['provenance'],{'recordId':'row'});self.assertEqual(first[0]['type'],'output');self.assertEqual((o/first[0]['subfolder']/first[0]['filename']).resolve(),(o/'a.png').resolve());self.assertEqual(list(i.iterdir()),[])
   (i/'b.mp4').write_bytes(b'local video reference')
   video=module.import_materials([dict(kind='video',url='/view?filename=b.mp4&type=input')],i,o)[0]
   self.assertEqual(video['type'],'input');self.assertEqual((i/video['subfolder']/video['filename']).resolve(),(i/'b.mp4').resolve());self.assertFalse((i/'DAELAB/results').exists())
   for url in ['/view?filename=../a.png&type=output','https://external/view?filename=a.png&type=output','/view?filename=a.png&type=output&type=input']:
    self.assertEqual(module.import_materials([dict(kind='image',url=url)],i,o),[])
 def test_invalid_items_are_skipped_without_dropping_valid_items(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);i=root/'input';o=root/'output';i.mkdir();o.mkdir();Image.new('RGB',(8,8)).save(o/'a.png')
   result=module.import_materials([dict(kind='image',url='/view?filename=a.png&type=output'),dict(kind='image',url='/view?filename=missing.png&type=output')],i,o)
   self.assertEqual([(item['filename'],item['sourceIndex']) for item in result],[('a.png',0)])
   self.assertFalse((i/'DAELAB/results').exists())
 def test_item_level_registration_conflict_is_skipped_but_storage_failure_is_not(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);i=root/'input';o=root/'output';i.mkdir();o.mkdir()
   Image.new('RGB',(8,8)).save(o/'valid.png');Image.new('RGB',(8,8)).save(o/'changed.png')
   assets=[dict(kind='image',url='/view?filename=valid.png&type=output'),
           dict(kind='image',url='/view?filename=changed.png&type=output')]
   def register(value):
    if value['asset']['filename']=='changed.png':raise Conflict('synthetic changed source')
    return {'asset':{'assetId':'asset-valid'},'byteSize':64}
   result=module.import_materials(assets,i,o,register=register)
   self.assertEqual([(item['filename'],item['sourceIndex']) for item in result],[('valid.png',0)])
   def unavailable(_value):raise StorageError('synthetic unavailable storage')
   with self.assertRaises(StorageError):module.import_materials(assets[:1],i,o,register=unavailable)
 def test_single_file_oserror_is_skipped_but_registration_oserror_is_not(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);i=root/'input';o=root/'output';i.mkdir();o.mkdir()
   Image.new('RGB',(8,8)).save(o/'valid.png');Image.new('RGB',(8,8)).save(o/'blocked.png')
   assets=[dict(kind='image',url='/view?filename=valid.png&type=output'),
           dict(kind='image',url='/view?filename=blocked.png&type=output')]
   original_is_file=module.Path.is_file
   def inspect(path):
    if path.name=='blocked.png':raise OSError('synthetic invalid path')
    return original_is_file(path)
   with patch.object(module.Path,'is_file',inspect):
    result=module.import_materials(assets,i,o)
   self.assertEqual([(item['filename'],item['sourceIndex']) for item in result],[('valid.png',0)])
   def unavailable(_value):raise OSError('synthetic storage failure')
   with self.assertRaises(OSError):module.import_materials(assets[:1],i,o,register=unavailable)
if __name__=='__main__':unittest.main()
