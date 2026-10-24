"""Build a deterministic, allowlisted ComfyUI candidate from one Git commit.

No publication, installation, inference or acceptance is performed. The archive
is a custom_nodes directory, not a Python wheel. Working-tree changes are ignored.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = 'ComfyUI-DAELab-Creative-Studio'
FIXED = {'__init__.py', 'pyproject.toml', 'requirements.txt', 'package.json', 'README.md'}
LICENSES = {'web/design/vendor/alibaba-puhuiti-3/LICENSE.txt',
            'web/design/vendor/remixicon/LICENSE', 'web/design/vendor/remixicon/LICENSE.business-source',
            'web/design/vendor/model-icons/LICENSE'}
FONT_MANIFEST = 'web/design/vendor/alibaba-puhuiti-3/manifest.json'
FONT_NAMES = {'AlibabaPuHuiTi-3-55-Regular.woff2', 'AlibabaPuHuiTi-3-65-Medium.woff2',
              'AlibabaPuHuiTi-3-75-SemiBold.woff2'}
FORBIDDEN_PARTS = {'.git', '.local', 'node_modules', 'tests', 'test', 'test_fixtures',
                   'frontend', '__pycache__', '.venv', 'venv', 'secrets', 'credentials'}
FORBIDDEN_SUFFIXES = {'.safetensors', '.gguf', '.ckpt', '.pt', '.pth', '.bin', '.onnx',
                      '.pem', '.key', '.p12', '.pfx', '.env', '.sqlite', '.sqlite3', '.db', '.pyc'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(name):
    if not isinstance(name, str) or not name:
        raise ValueError('Archive path must be a normalized relative path.')
    p = PurePosixPath(name)
    if (p.is_absolute() or '\\' in name or any(char in name for char in ':<>"|?*')
            or any(ord(char) < 32 or ord(char) == 127 for char in name)
            or any(part in {'', '.', '..'} or part.endswith((' ', '.'))
                   or part.split('.')[0].upper() in {'CON', 'PRN', 'AUX', 'NUL',
                                                    *('COM' + str(i) for i in range(1, 10)),
                                                    *('LPT' + str(i) for i in range(1, 10))}
                   for part in name.split('/'))):
        raise ValueError('Archive path must be portable and normalized.')
    return name


def excluded(name):
    p = PurePosixPath(name)
    return (any(part.casefold() in FORBIDDEN_PARTS for part in p.parts)
            or p.suffix.casefold() in FORBIDDEN_SUFFIXES
            or p.name.casefold().startswith(('.env', 'id_rsa', 'id_ed25519', 'test_'))
            or p.name.casefold().split('.')[0] in {'credentials', 'secrets', 'private_key', 'api_keys', 'api-key'}
            or '.test.' in p.name.casefold())


def possible(name):
    p = PurePosixPath(name)
    return (name in FIXED or name.startswith('web/')
            or len(p.parts) == 1 and p.name.startswith(('LICENSE', 'NOTICE'))
            or p.parts[0] in {'backend', 'compat'} and p.suffix == '.py'
            or name.startswith('tools/migration/') and p.suffix == '.py'
            or name.startswith('docs/') and p.suffix in {'.md', '.json', '.csv'})


def validate_paths(names):
    aliases = {}
    for name in names:
        safe_path(name)
        parts = name.split('/')
        for index in range(1, len(parts) + 1):
            prefix = '/'.join(parts[:index])
            previous = aliases.setdefault(prefix.casefold(), prefix)
            if previous != prefix:
                raise ValueError('Case aliases cannot share an installation path.')


def validate_resources(files, web_files):
    if not LICENSES <= web_files or FONT_MANIFEST not in web_files:
        raise ValueError('Required third-party notices or font manifest are missing.')
    if any(not files[name].decode('utf-8').strip() for name in LICENSES):
        raise ValueError('Third-party notices cannot be empty.')
    fonts = json.loads(files[FONT_MANIFEST])
    if not isinstance(fonts, list) or {entry['file'] for entry in fonts} != FONT_NAMES or len(fonts) != len(FONT_NAMES):
        raise ValueError('The fixed font resource set is incomplete.')
    for entry in fonts:
        name = str(PurePosixPath(FONT_MANIFEST).parent / safe_path(entry['file']))
        if name not in web_files or len(files[name]) != entry['bytes'] or digest(files[name]) != entry['sha256']:
            raise ValueError('Font resource differs from its original byte/hash manifest.')


def collect(files):
    """Validate the supplied committed tree and select exact runtime contents."""
    validate_paths(files)
    if not FIXED <= files.keys() or 'web/build-manifest.json' not in files:
        raise ValueError('Commit does not contain the complete built product.')
    config = tomllib.loads(files['pyproject.toml'].decode('utf-8'))
    version = config['project']['version']
    package = json.loads(files['package.json'])
    manifest = json.loads(files['web/build-manifest.json'])
    if version.replace('.dev', '-dev.') != package['version'] or manifest['version'] != package['version']:
        raise ValueError('Python, package and web versions differ.')
    if not re.fullmatch('[a-f0-9]{64}', manifest.get('sourceFingerprint', '')):
        raise ValueError('Frontend source fingerprint is invalid.')
    requirements = [line.strip() for line in files['requirements.txt'].decode('utf-8').splitlines()
                    if line.strip() and not line.lstrip().startswith('#')]
    if requirements != config['project']['dependencies']:
        raise ValueError('Runtime dependency entrypoints differ.')
    if config.get('tool', {}).get('setuptools', {}).get('packages') != []:
        raise ValueError('Python metadata must explicitly disable automatic package discovery.')
    selected = set(FIXED) | {'web/build-manifest.json'}
    web_files = set()
    if not isinstance(manifest['files'], list) or not manifest['files']:
        raise ValueError('Frontend manifest must contain its complete file list.')
    for entry in manifest['files']:
        if not isinstance(entry, dict) or set(entry) != {'path', 'sha256'}:
            raise ValueError('Frontend manifest entry shape is invalid.')
        name = 'web/' + safe_path(entry['path'])
        if excluded(name) or name == 'web/build-manifest.json' or name in web_files or name not in files or digest(files[name]) != entry['sha256']:
            raise ValueError('Frontend manifest is stale, duplicate or incomplete.')
        web_files.add(name)
    if {name for name in files if name.startswith('web/')} != web_files | {'web/build-manifest.json'}:
        raise ValueError('Unmanifested files are present in the frontend output.')
    selected |= web_files
    for name in files:
        if possible(name) and not excluded(name):
            selected.add(name)
    required = {'backend/integrations/comfyui/bootstrap.py', 'compat/workflows/reader.py',
                'web/integrations/comfyui/index.js', 'tools/migration/__main__.py'}
    if not required <= selected:
        raise ValueError('Required product entrypoints or third-party notices are missing.')
    validate_resources(files, web_files)
    index = files['web/integrations/comfyui/index.js'].decode('utf-8')
    for key, expected in [('STUDIO_VERSION', package['version']), ('FRONTEND_BUILD_ID', manifest['sourceFingerprint'])]:
        values = re.findall(r'export\s+const\s+' + key + r'''\s*=\s*['"]([^'"]+)['"]''', index)
        if values != [expected]:
            raise ValueError('Compiled frontend version/build identity differs from its manifest.')
    return {name: files[name] for name in sorted(selected)}, version, manifest['sourceFingerprint']


def candidate_bytes(files, revision):
    if not re.fullmatch('[a-f0-9]{40}', revision):
        raise ValueError('Candidate needs an exact Git commit.')
    selected, version, build_id = collect(files)
    record = {'schemaVersion': 1, 'status': 'candidate-not-accepted', 'releaseAllowed': False,
              'revision': revision, 'version': version, 'frontendBuildId': build_id,
              'files': [{'path': name, 'bytes': len(raw), 'sha256': digest(raw)}
                        for name, raw in selected.items()]}
    selected['release-candidate.json'] = (json.dumps(record, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, raw in sorted(selected.items()):
            info = zipfile.ZipInfo(PACKAGE + '/' + name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw, compresslevel=9)
    return output.getvalue(), record


def committed_files(root, revision):
    if not isinstance(revision, str) or not re.fullmatch('[a-f0-9]{40}', revision):
        raise ValueError('Specify a full immutable Git commit, not a branch or tag.')
    def git(*args):
        return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.PIPE)
    commit = git('rev-parse', '--verify', revision + '^{commit}').decode('ascii').strip()
    if commit != revision:
        raise ValueError('Resolved commit differs from the requested identity.')
    entries = git('ls-tree', '-r', '-z', commit).split(b'\0')
    files = {}
    for entry in entries:
        if not entry:
            continue
        metadata, name_bytes = entry.split(b'\t', 1)
        mode, kind, _oid = metadata.split(b' ')
        name = safe_path(name_bytes.decode('utf-8'))
        if mode not in {b'100644', b'100755'} or kind != b'blob':
            raise ValueError('Candidate source must not contain links or submodules.')
        # Read only possible allowlist roots, avoiding test evidence and datasets.
        if name.startswith('web/') and excluded(name):
            raise ValueError('Forbidden runtime data is present in the web tree.')
        if possible(name) and not excluded(name):
            files[name] = git('cat-file', 'blob', _oid.decode('ascii'))
    return commit, files


def write_candidate(root, revision, output):
    commit, files = committed_files(root, revision)
    raw, record = candidate_bytes(files, commit)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('xb') as stream:
        stream.write(raw)
    return {'path': str(output), 'sha256': digest(raw), 'bytes': len(raw),
            'revision': commit, 'files': len(record['files']), 'releaseAllowed': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(write_candidate(ROOT, args.revision, args.output)))


if __name__ == '__main__':
    main()
