"""Prepare a standalone test-only observer package; optionally copy synthetic media to an owned isolation root."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT/'tests/fixtures/performance'


def prepare_package(destination: Path):
    destination = destination.resolve()
    if destination.exists():
        raise ValueError('Use a new observer package directory; existing contents are never overwritten')
    source = ROOT/'tests/host_fixture/web/performance.js'
    destination.mkdir(parents=True)
    (destination/'web').mkdir()
    shutil.copyfile(source, destination/'web/performance.js')
    (destination/'__init__.py').write_text('"""Test-only passive performance observer. No node registrations."""\nNODE_CLASS_MAPPINGS = {}\nWEB_DIRECTORY = "./web"\n',encoding='utf-8',newline='\n')
    marker={'schemaVersion':1,'kind':'test-only-performance-observer','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'nodeRegistrations':0,'requiresVisibleStart':True}
    (destination/'observer-package.json').write_text(json.dumps(marker,indent=2)+'\n',encoding='utf-8',newline='\n')
    return marker


def copy_media(environment: Path):
    environment = environment.resolve()
    marker = environment/'creative-studio-isolation.json'
    old_marker = environment/'old-baseline-owner.json'
    if marker.is_file() and old_marker.is_file():
        raise ValueError('Ambiguous isolation ownership manifests')
    if not marker.is_file():
        marker = old_marker
    if not marker.is_file(): raise ValueError('Media destination must have the isolation tool ownership manifest')
    config = json.loads(marker.read_text(encoding='utf-8'))
    if marker == old_marker and (config.get('owner') != 'creative-studio-old-baseline-v1' or config.get('cpu_only') is not True):
        raise ValueError('Unrecognized old CPU baseline ownership')
    if type(config.get('port')) is not int or not 1024 <= config['port'] <= 65535 or config['port'] == 8000: raise ValueError('Refusing production or unspecified port')
    if Path(config.get('environment_root','')).resolve() != environment: raise ValueError('Isolation manifest root mismatch')
    target = (environment/'input'/'DAELAB'/'performance-synthetic-v1').resolve()
    if not target.is_relative_to(environment) or not (environment/'input').is_dir(): raise ValueError('Input destination escapes isolation')
    manifest = json.loads((FIXTURES/'manifest.json').read_text(encoding='utf-8'))
    sources=[]
    for entry in manifest['media']:
        source = (FIXTURES/entry['file']).resolve()
        if not source.is_relative_to((FIXTURES/'media').resolve()) or hashlib.sha256(source.read_bytes()).hexdigest()!=entry['sha256']: raise ValueError('Fixture media hash/path mismatch')
        destination = target/source.name
        if not destination.resolve().is_relative_to(environment): raise ValueError('Media destination escapes isolation')
        if destination.exists() and destination.read_bytes()!=source.read_bytes(): raise ValueError('Existing media differs; refusing overwrite')
        sources.append((source,destination))
    target.mkdir(parents=True,exist_ok=True)
    for source,destination in sources:
        if not destination.exists(): shutil.copyfile(source,destination)
    return {'files':len(sources),'subfolder':'DAELAB/performance-synthetic-v1','serviceStarted':False}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package-output',type=Path)
    parser.add_argument('--copy-media-to-isolation',type=Path)
    args=parser.parse_args()
    if not args.package_output and not args.copy_media_to_isolation: parser.error('Choose a preparation action')
    result={}
    if args.package_output: result['package']=prepare_package(args.package_output)
    if args.copy_media_to_isolation: result['media']=copy_media(args.copy_media_to_isolation)
    print(json.dumps(result))
