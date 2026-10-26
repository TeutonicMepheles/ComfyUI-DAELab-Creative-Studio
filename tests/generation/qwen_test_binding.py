"""Public synthetic six-blob registry for tests; never a product fallback."""
import hashlib
import json
from backend.providers.qwen_binding import QwenModelBinding


def binding_fixture(root):
    root.mkdir(parents=True,exist_ok=True);blobs=root/'blobs';blobs.mkdir()
    expected=[];entries={}
    for role in ('model','projector','config','template','license','params'):
        data=('public synthetic '+role).encode();sha=hashlib.sha256(data).hexdigest()
        (blobs/('sha256-'+sha)).write_bytes(data)
        expected.append({'role':role,'sha256':sha,'bytes':len(data)})
        entries[role]={'mediaType':'application/vnd.ollama.image.'+role,'digest':'sha256:'+sha,'size':len(data)}
    manifest={'schemaVersion':2,'config':entries['config'],'layers':[entries[r] for r in entries if r!='config']}
    raw=json.dumps(manifest,separators=(',',':')).encode()
    source=root/'registry.json';installed=root/'installed.json';source.write_bytes(raw);installed.write_bytes(raw)
    return QwenModelBinding(manifest_path=source,installed_manifest_path=installed,blobs_root=blobs,expected_manifest_sha256=hashlib.sha256(raw).hexdigest(),expected_blobs=expected)
