"""Prepare one guarded CPU-only optional ComfyTV host, never production data."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

from . import prepare_isolated as isolated
from .prepare_baseline import archive_members, extract_new, _plain_ancestors

ROOT = Path(__file__).resolve().parents[2]
HOST_COMMIT = '3c1b7a17fdf239d35ce98cc777756f572d089795'
COMFYTV_COMMIT = 'a5e0c16b5ca7f74b31293c2f940a704107e4a009'
PORT = 8227
MARKER = 'optional-comfytv.json'

GUARD = r'''import ipaddress,json,os,runpy,shlex,sys
from pathlib import Path
root=Path(__file__).resolve().parent
manifest=json.loads((root/'optional-comfytv.json').read_text('utf-8'))
log=root/'logs/network-process-audit.jsonl'
def record(event,data,blocked=False):
    with log.open('a',encoding='utf-8') as output:
        output.write(json.dumps({'event':event,'data':data,'blocked':blocked},ensure_ascii=False)+'\n')
def audit(event,args):
    if event in ('socket.connect','socket.getaddrinfo'):
        address=args[1] if event=='socket.connect' else (args[0],args[1])
        if not isinstance(address,tuple):
            return
        host,port=address[:2]
        try: local=ipaddress.ip_address(str(host)).is_loopback
        except ValueError: local=str(host).lower()=='localhost'
        blocked=not local or str(port) in {'8000','8224','8225','8226','11434'}
        record(event,{'host':str(host),'port':str(port)},blocked)
        if blocked: raise PermissionError('Optional CPU host forbids external/protected connections')
    elif event=='subprocess.Popen':
        command=args[1]
        values=list(command) if isinstance(command,(list,tuple)) else shlex.split(str(command),posix=False)
        program=Path(str(values[0]).strip('"')).name.lower() if values else ''
        git_args=['-C',str(root/'custom_nodes/ComfyTV'),'ls-files','-z','--','workflows']
        allowed=(program in ('git','git.exe') and [str(x).strip('"') for x in values[1:]]==git_args
                 or program in ('rocm-sdk','rocm-sdk.exe') and values[1:]==['path','--root'])
        record(event,{'program':program,'arguments':[str(x) for x in values[1:]]},not allowed)
        if not allowed: raise PermissionError('Optional CPU host forbids unreviewed child execution')
sys.addaudithook(audit)
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
os.environ.pop('COMFYTV_TESTING',None)
sys.argv=manifest['hostCommand'][3:]
sys.path.insert(0,str(Path(manifest['source_host'])))
runpy.run_path(sys.argv[0],run_name='__main__')
'''


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.PIPE)


def verify_source(source):
    source = Path(source).resolve()
    if (Path(git(source, 'rev-parse', '--show-toplevel').decode().strip()).resolve() != source
            or git(source, 'rev-parse', 'HEAD').decode().strip() != COMFYTV_COMMIT
            or git(source, 'status', '--porcelain').strip()):
        raise ValueError('ComfyTV must be the clean, exact reviewed repository revision.')
    tree = git(source, 'ls-tree', '-rz', COMFYTV_COMMIT)
    if any(row and not row.startswith((b'100644 blob ', b'100755 blob ')) for row in tree.split(b'\0')):
        raise ValueError('Optional archive must not contain links or submodules.')
    return source


def optional_command(config):
    if config.get('fixture_package') or type(config['port']) is not int or not 1024 <= config['port'] <= 65535 or config['port'] in {8000, 8224, 8225, 8226, 11434}:
        raise ValueError('Optional validation uses only Studio/ComfyTV on its dedicated port.')
    command = isolated.command_for(config)
    command.insert(1, '-B')
    command.insert(command.index('--feature-flag'), 'ComfyTV')
    return command


def prepare(runtime_file, source, environment, port=PORT):
    runtime_file = Path(runtime_file).resolve()
    runtime = json.loads(runtime_file.read_text('utf-8'))
    source = verify_source(source)
    environment = _plain_ancestors(environment)
    if environment.exists() or not environment.is_relative_to(ROOT / '.local'):
        raise ValueError('Optional host needs a new owned directory under this repository .local.')
    host = Path(runtime['host']['root']).resolve()
    if (runtime['host']['gitHead'] != HOST_COMMIT or git(host, 'rev-parse', 'HEAD').decode().strip() != HOST_COMMIT
            or git(host, 'status', '--porcelain').strip()):
        raise ValueError('The fixed clean host revision changed.')
    config = isolated.resolve_configuration(str(host), runtime['host']['python'], str(environment), str(ROOT), port)
    optional_command(config)  # Validate the dedicated port before writing the snapshot.
    manifest = isolated.prepare(config)
    archive = environment / 'ComfyTV-fixed-source.zip'
    with archive.open('xb') as output:
        subprocess.run(['git', '-C', str(source), 'archive', '--format=zip', COMFYTV_COMMIT], stdout=output, stderr=subprocess.PIPE, check=True)
    records = archive_members(archive)
    extract_new(archive, environment / 'custom_nodes/ComfyTV', records)
    verify_source(source)
    build = json.loads((environment / 'custom_nodes' / isolated.PACKAGE_NAME / 'web/build-manifest.json').read_text('utf-8'))
    manifest.update(optionalOwner='creative-studio-optional-comfytv-cpu-v1',
                    comfytv={'source': str(source), 'commit': COMFYTV_COMMIT,
                             'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'files': records},
                    runtimeSha256=hashlib.sha256(runtime_file.read_bytes()).hexdigest(),
                    frontendBuildId=build['sourceFingerprint'], hostCommand=optional_command(config))
    guard_path = environment / 'guarded-main.py'
    guard_path.write_text(GUARD, encoding='utf-8', newline='\n')
    manifest['command'] = [config['python'], '-B', '-s', str(environment / 'guarded-main.py')]
    manifest['guardSha256'] = hashlib.sha256(guard_path.read_bytes()).hexdigest()
    (environment / MARKER).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, default=ROOT / '.local/baseline/runtime.json')
    parser.add_argument('--comfytv-source', type=Path, required=True)
    parser.add_argument('--environment', type=Path, default=ROOT / '.local/host-optional-comfytv')
    parser.add_argument('--start', action='store_true')
    parser.add_argument('--port', type=int, default=PORT, help='Free loopback port; protected production/evaluation ports remain forbidden')
    args = parser.parse_args()
    manifest = prepare(args.runtime, args.comfytv_source, args.environment, args.port)
    if args.start:
        manifest = isolated.start(manifest)
        (args.environment / MARKER).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: manifest.get(key) for key in ('status', 'port', 'pid', 'frontendBuildId', 'stdout', 'stderr')}))


if __name__ == '__main__':
    main()
