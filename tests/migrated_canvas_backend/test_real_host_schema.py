"""Opt-in metadata check against the installed Comfy SDK; no server or model run."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest


class RealHostSchemaTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('CREATIVE_STUDIO_COMFY_ROOT'), 'requires an installed ComfyUI SDK')
    def test_upload_metadata_with_real_comfy_sdk(self):
        root = str(Path(os.environ['CREATIVE_STUDIO_COMFY_ROOT']).resolve())
        script = r'''
import json,sys
sys.argv = ['schema-contract', '--cpu']
sys.path.insert(0, sys.argv_host_root)
from backend.integrations.comfyui.canvas_nodes.media_upload import MediaUpload
info = MediaUpload.GET_NODE_INFO_V1()
assert list(info['input']['required']) == ['asset_data']
assert list(info['input']['optional']) == ['source_report', 'source_video']
assert info['input']['optional']['source_report'][0] == 'STRING'
assert info['input']['optional']['source_video'][0] == 'COMFYTV_VIDEO'
assert info['input']['optional']['source_video'][1]['lazy'] is True
assert 'forceInput' not in info['input']['optional']['source_video'][1]
assert MediaUpload.check_lazy_status(asset_data='{}', source_video=None) == []
assert list(info['output']) == ['COMFYTV_IMAGE','COMFYTV_IMAGES','COMFYTV_VIDEO','IMAGE','VIDEO']
print('HOST_SCHEMA_JSON:' + json.dumps(info, ensure_ascii=True))
'''
        process = subprocess.run([sys.executable, '-c', 'import sys;sys.argv_host_root=' + repr(root) + '\n' + script],
                                 cwd=Path(__file__).resolve().parents[2], text=True, capture_output=True, timeout=60)
        self.assertEqual(process.returncode, 0, process.stderr + process.stdout)
        line = next(value for value in process.stdout.splitlines() if value.startswith('HOST_SCHEMA_JSON:'))
        info = json.loads(line.partition(':')[2])
        self.assertEqual(info['name'], 'DAELAB.MediaUpload')


if __name__ == '__main__':
    unittest.main()
