"""Construct Studio's ten final local requests offline and compare fixed captures.

No provider preflight, transport, queue, model runtime or package bootstrap runs.
The only child process is a guarded Node process for the production pure ESM
snapshot builder. Weight identities are M0 inventory metadata, not a fresh load.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

from tools.evals.prepare_local_inputs import (
    ROOT, BUSINESS, HOST, _NODE_FREEZE, file_hash, no_external_io,
    safe_relative, save_new, validate_fixed_inputs,
)
from tools.evals.request_contract import compare_requests, sha256, validate_payload
from tools.host.prepare_gpu_evaluation import model_bindings


def read_json(path):
    return json.loads(Path(path).read_text('utf-8'))


def verified_inputs(root):
    root = Path(root).resolve()
    manifest = read_json(root / 'manifest.json')
    if file_hash(root / 'samples.json') != manifest['samplesSha256']:
        raise ValueError('Declared sample input changed.')
    fixtures = read_json(root / 'samples.json')
    validate_payload(fixtures)
    plan = read_json(ROOT / 'docs/validation/catalog/local-eval-plan.json')
    if sha256(plan) != manifest['planSha256']:
        raise ValueError('Declared evaluation plan changed.')
    validate_fixed_inputs(fixtures, plan)
    if manifest['samples'] != [{'id': s['id'], 'inputSha256': sha256(s)} for s in fixtures['samples']]:
        raise ValueError('Sample identities differ from their manifest.')
    for media in manifest['media']:
        source = safe_relative(root, media['path'])
        if source.stat().st_size != media['bytes'] or file_hash(source) != media['sha256']:
            raise ValueError('Declared synthetic image changed.')
    return fixtures, manifest


def esm_sources(entry):
    """Hash the actual relative-import closure before executing its entrypoint."""
    sources = {}
    def visit(path):
        path = Path(path).resolve()
        relative = path.relative_to(ROOT).as_posix()
        if relative in sources:
            return
        sources[relative] = file_hash(path)
        for imported in re.findall(r"(?:from\s*|import\s*)['\"]([^'\"]+)['\"]", path.read_text('utf-8')):
            if not imported.startswith('.'):
                raise ValueError('The snapshot builder must have only local pure ESM imports.')
            visit(safe_relative(ROOT, (path.parent / imported.split('?', 1)[0]).relative_to(ROOT)))
    visit(entry)
    return sources


def freeze_table(fixtures, node='node'):
    entry = ROOT / 'frontend/src/features/prompt/prompt_optimization_model.mjs'
    sources = esm_sources(entry)
    payload = {'module': entry.as_uri(), 'table': fixtures['table'],
               'samples': [s for s in fixtures['samples'] if s['entry'] == 'table-row']}
    completed = subprocess.run([node, '--input-type=module', '-e', _NODE_FREEZE],
                               input=json.dumps(payload, ensure_ascii=False), encoding='utf-8',
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False)
    if completed.returncode:
        raise ValueError('Studio snapshot construction failed without submission. ' + completed.stderr[-1600:])
    verify_sources(sources)
    return {row['sampleId']: row['snapshot'] for row in json.loads(completed.stdout)}, sources


def python_sources():
    result = {}
    for module in tuple(sys.modules.values()):
        name = getattr(module, '__file__', None)
        if name:
            path = Path(name).resolve()
            if path.suffix == '.py' and path.is_relative_to(ROOT):
                result[path.relative_to(ROOT).as_posix()] = file_hash(path)
    # `python -m` may expose this file only as __main__.
    result[Path(__file__).relative_to(ROOT).as_posix()] = file_hash(__file__)
    return result


def verify_sources(sources):
    for path, expected in sources.items():
        if file_hash(safe_relative(ROOT, path)) != expected:
            raise ValueError('Source changed while capturing: ' + path)


def prepare_reference(assets, fixture_root, relative, input_root):
    from backend.generation.media import freeze_reference
    source = safe_relative(fixture_root, relative)
    target = safe_relative(input_root, relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and file_hash(target) != file_hash(source):
        raise ValueError('An existing staged source changed.')
    if not target.exists():
        shutil.copyfile(source, target)
    registered = assets.register_file('input', relative, kind='image', provenance={'origin': 'studio-eval-synthetic'})
    reference = next(r for r in registered['references'] if r['root_key'] == 'input' and r['relative_path'] == relative)
    frozen = freeze_reference(assets, {'reference_id': reference['reference_id']})
    if frozen['sha256'] != file_hash(source):
        raise ValueError('Frozen bytes differ from the declared fixture.')
    return frozen


def qwen_effective(body, runtime, reference_order):
    """Project the constructed wire body, without reading old effective fields."""
    return {'model': body['model'], 'systemInstruction': body['system'], 'expandedText': body['prompt'],
            'referenceOrder': reference_order,
            'preprocessedImageSha256': [hashlib.sha256(base64.b64decode(v, validate=True)).hexdigest() for v in body.get('images', [])],
            'weightSha256': [w['sha256'] for w in runtime['ollama']['blobsVerifiedByRehash']],
            'temperature': body['options']['temperature'], 'seed': body['options'].get('seed', 'omitted'),
            'contextTokens': body['options']['num_ctx'], 'maxOutputTokens': body['options']['num_predict'], 'lora': []}


def native_effective(prepared, runtime, input_root, fixture_root, manifest):
    """Derive settings and reference order from the new graph and actual bytes."""
    graph = prepared['graph']
    condition = graph['condition']['inputs']
    by_hash = {item['sha256']: item['path'] for item in manifest['media']}
    if len(by_hash) != len(manifest['media']):
        raise ValueError('Reference labels require unambiguous fixture content hashes.')
    references = []
    for role in ('first_frame', 'last_frame'):
        if role not in condition:
            continue
        node_id, slot = condition[role]
        node = graph[node_id]
        if slot != 0 or node['class_type'] != 'LoadImage':
            raise ValueError('Unexpected native reference loader or output slot.')
        relative = node['inputs']['image']
        actual = safe_relative(input_root, relative)
        content_hash = file_hash(actual)
        fixture = by_hash[content_hash]
        original = safe_relative(fixture_root, fixture)
        if original.read_bytes() != actual.read_bytes():
            raise ValueError('Native reference bytes differ from the public source.')
        references.append({'role': role, 'fixture': fixture, 'nativeInput': relative,
                           'sha256': content_hash, 'bytes': actual.stat().st_size})
    selected = {entry['name']: entry['sha256'] for entry in prepared['models'].values()}
    names = {node['inputs'][key] for node in graph.values() for key in ('unet_name', 'clip_name', 'vae_name', 'lora_name') if key in node['inputs']}
    if prepared['kind'] == 'image':
        names.add(prepared['models']['mmproj']['name'])
    if names != set(selected):
        raise ValueError('Graph model names do not match the prepared inventory.')
    weights = []
    for item in runtime['weights']:
        name = Path(item['path']).name
        if name in names:
            if item['sha256'] != selected[name]:
                raise ValueError('Graph inventory differs from the fixed runtime hash.')
            weights.append(item['sha256'])
    if len(weights) != len(selected):
        raise ValueError('A graph weight is outside the fixed runtime inventory.')
    image = prepared['kind'] == 'image'
    dimensions = graph['latent']['inputs'] if image else condition
    result = {'model': prepared['model'], 'systemInstruction': '', 'expandedText': condition['prompt'],
              'referenceOrder': [r['fixture'] for r in references], 'sourceImageSha256': [r['sha256'] for r in references],
              'preprocessedImageSha256': [], 'preprocessingStatus': 'runtime-boundary-capture-required' if references else 'no-references',
              'weightSha256': weights, 'width': dimensions['width'], 'height': dimensions['height'],
              'seed': graph['sample']['inputs']['seed'] if image else graph['noise']['inputs']['noise_seed'], 'lora': []}
    if image:
        result.update({key: graph['sample']['inputs'][wire] for key, wire in
                       [('steps', 'steps'), ('cfg', 'cfg'), ('sampler', 'sampler_name'), ('scheduler', 'scheduler')]})
    else:
        result.update(steps=graph['schedule']['inputs']['steps'], sampler=graph['sampler']['inputs']['sampler_name'],
                      scheduler=graph['schedule']['inputs']['scheduler'], frames=condition['length'], fps=graph['video']['inputs']['fps'],
                      inputDurationSeconds=prepared['settings']['duration'], turbo='turbo' in graph)
    return result, references


def construct(fixtures, manifest, snapshots, runtime, fixture_root, output):
    from backend.integrations.comfyui.services import CoreServices
    from backend.generation.media import read_frozen, stage_native_input
    from backend.providers.native import ModelInventory, NativeProvider
    from backend.providers.parameters import IMAGE_MODEL, VIDEO_MODEL
    from backend.providers.qwen import qwen_request
    input_root = output / 'input'
    input_root.mkdir()
    (output / 'output').mkdir()
    services = CoreServices(output / 'user', input_root, output / 'output')
    bindings = model_bindings(runtime)  # Existence and size only, no model import.
    records = []
    for sample in fixtures['samples']:
        references = sample.get('references', [sample['image']] if sample.get('image') else [])
        media = [prepare_reference(services.assets, fixture_root, name, input_root) for name in references]
        identities = []
        if sample['entry'] in ('canvas-polish', 'canvas-reverse', 'table-row'):
            if sample['entry'] == 'table-row':
                data = {'entry': 'table', 'optimization': snapshots[sample['id']]}
            else:
                data = {'mode': 'reverse' if sample['entry'] == 'canvas-reverse' else 'polish',
                        'source': sample.get('source', ''), 'instruction': sample['instruction']}
            body = qwen_request(data, read_frozen(services.assets, media[0]) if media else None)
            effective = qwen_effective(body, runtime, references)
            entry = ['backend/providers/qwen.py:qwen_request']
            if sample['entry'] == 'table-row':
                entry.insert(0, 'frontend/src/features/prompt/prompt_optimization_model.mjs:freezeSnapshot')
            for index, encoded in enumerate(body.get('images', [])):
                (output / f"{sample['id']}-preprocessed-{index}.jpg").write_bytes(base64.b64decode(encoded, validate=True))
        else:
            kind = 'image' if sample['entry'] == 'local-image' else 'video'
            model = IMAGE_MODEL if kind == 'image' else VIDEO_MODEL
            provider = NativeProvider(kind, inventory=ModelInventory(bindings[kind], lambda: ()), queue=None,
                                      media_input=lambda item: stage_native_input(services.assets, item))
            data = {'config': {'model': model, 'kind': kind, 'mode': sample.get('mode', 'text2image'), 'settings': sample['settings']},
                    'segments': sample.get('segments', [{'type': 'text', 'text': sample.get('text', '')}])}
            prepared = provider.build(data, media, sample['id'])
            body = prepared['graph']
            effective, identities = native_effective(prepared, runtime, input_root, fixture_root, manifest)
            entry = ['backend/providers/native.py:NativeProvider.build', 'backend/generation/media.py:stage_native_input']
        validate_payload(body)
        record = {'schemaVersion': 1, 'sampleId': sample['id'], 'captureKind': 'offline-studio-source-construction',
                  'transportSubmitted': False, 'inferenceExecuted': False, 'entry': entry,
                  'inputSha256': sha256(sample), 'finalRequest': body, 'effective': effective, 'nativeReferences': identities,
                  'limitations': ['No preflight, HTTP, queue, live node registration, GPU or model load executed.',
                                  'Weight hashes refer to the fixed M0 inventory; weights were not rehashed here.',
                                  'H3 source PNG identity does not replace live tokenize/VAE tensor capture.']}
        save_new(output / (sample['id'] + '.json'), record)
        records.append(record)
    if services.jobs.list_jobs():
        raise ValueError('Offline construction unexpectedly created jobs.')
    return records


def compare_captures(records, baseline_root, fixture_root, output):
    baseline_root = Path(baseline_root).resolve()
    index = read_json(baseline_root / 'preparation.json')
    if index['publicManifestSha256'] != file_hash(fixture_root / 'manifest.json'):
        raise ValueError('Old captures refer to a different fixture manifest.')
    by_id = {item['sampleId']: item for item in index['records']}
    if len(by_id) != len(records) or set(by_id) != {r['sampleId'] for r in records}:
        raise ValueError('Old capture set does not cover the same ten samples.')
    comparisons = []
    for record in records:
        metadata = by_id[record['sampleId']]
        path = safe_relative(baseline_root, metadata['path'])
        if file_hash(path) != metadata['sha256']:
            raise ValueError('An immutable old capture changed.')
        old = read_json(path)
        if old['inputSha256'] != record['inputSha256']:
            raise ValueError('Old and new captures have different source inputs.')
        result = compare_requests(old, record)
        candidates = []
        for ref in record['nativeReferences']:
            pointer = '/finalRequest/' + ref['role'] + '/inputs/image'
            change = next((change for change in result['differences'] if change['path'] == pointer), None)
            if not change:
                continue
            old_name = old['finalRequest'][ref['role']]['inputs']['image']
            old_file = safe_relative(baseline_root / 'input', old_name)
            new_file = safe_relative(output / 'input', ref['nativeInput'])
            if old_file.read_bytes() != new_file.read_bytes() or file_hash(old_file) != ref['sha256']:
                raise ValueError('The changed LoadImage path does not contain identical bytes.')
            candidates.append({**change, 'reviewStatus': 'pending-human-review',
                               'reason': 'Studio asset service freezes and stages input by content SHA-256; exact source bytes and order match.',
                               'baselineInput': old_name, 'studioInput': ref['nativeInput'],
                               'contentSha256': ref['sha256'], 'byteSize': ref['bytes'], 'bytesEqual': True})
        result.update(baselineCaptureSha256=metadata['sha256'], studioCaptureSha256=file_hash(output / (record['sampleId'] + '.json')),
                      reviewCandidates=candidates)
        save_new(output / (record['sampleId'] + '-comparison.json'), result)
        comparisons.append(result)
    return comparisons


def prepare(args):
    from PIL import __version__ as pillow_version
    output = args.output.resolve()
    if output.exists() or not output.is_relative_to((ROOT / '.local').resolve()):
        raise ValueError('Output must be a new directory under this repository .local.')
    runtime = read_json(args.runtime)
    if runtime['sourceBaselines']['business']['commit'] != BUSINESS or runtime['host']['gitHead'] != HOST:
        raise ValueError('Runtime identity differs from the pinned baseline.')
    fixture_root = args.fixtures.resolve()
    fixtures, manifest = verified_inputs(fixture_root)
    output.mkdir(parents=True)
    input_files = {str(path.resolve()): file_hash(path) for path in
                   [args.runtime, fixture_root / 'samples.json', fixture_root / 'manifest.json', args.baseline / 'preparation.json']}
    try:
        snapshots, sources = freeze_table(fixtures, args.node)
        save_new(output / 'table-snapshots.json', snapshots)
        # Import only the production implementation closure while outbound IO and
        # child execution are denied. Capture source identities before construction.
        with no_external_io():
            import backend.integrations.comfyui.services
            import backend.generation.media
            import backend.providers.native
            import backend.providers.qwen
            sources.update(python_sources())
            records = construct(fixtures, manifest, snapshots, runtime, fixture_root, output)
        verify_sources(sources)
        for path, expected in input_files.items():
            if file_hash(path) != expected:
                raise ValueError('A capture input changed during construction.')
        comparisons = compare_captures(records, args.baseline, fixture_root, output)
        preprocessing = None
        if args.h3_preprocessing:
            data = read_json(args.h3_preprocessing)
            if data['fixtureManifestSha256'] != file_hash(fixture_root / 'manifest.json'):
                raise ValueError('H3 CPU evidence refers to other fixtures.')
            preprocessing = {'path': str(args.h3_preprocessing.resolve()), 'sha256': file_hash(args.h3_preprocessing),
                             'role': 'Related CPU preparation metadata only; not live model input or weight-load proof.'}
        report = {'schemaVersion': 1, 'status': 'requests-prepared-inference-not-executed',
                  'transportSubmitted': False, 'inferenceExecuted': False, 'jobsCreated': 0,
                  'weightRehashExecuted': False, 'inputFiles': input_files, 'sourceFiles': sources,
                  'sourceFingerprint': sha256(sources),
                  'h3PreprocessingPreparation': preprocessing,
                  'tooling': {'python': sys.version, 'pillow': pillow_version,
                              'node': subprocess.run([args.node, '--version'], capture_output=True, text=True, check=True, timeout=10).stdout.strip()},
                  'records': [{'sampleId': r['sampleId'], 'path': r['sampleId'] + '.json', 'sha256': file_hash(output / (r['sampleId'] + '.json'))} for r in records],
                  'comparison': {'exactOrAllowedOutputOnly': sum(c['passed'] for c in comparisons),
                                 'results': [{'sampleId': c['sampleId'], 'path': c['sampleId'] + '-comparison.json',
                                              'sha256': file_hash(output / (c['sampleId'] + '-comparison.json'))} for c in comparisons],
                                 'pendingReview': [c['sampleId'] for c in comparisons if not c['passed']],
                                 'effectiveDifferences': {c['sampleId']: c['immutableEffectiveDifferences'] for c in comparisons if c['immutableEffectiveDifferences']},
                                 'modelRequestDifferences': {c['sampleId']: c['immutableModelRequestDifferences'] for c in comparisons if c['immutableModelRequestDifferences']},
                                 'inferenceAcceptance': False}}
        save_new(output / 'preparation.json', report)
        print(json.dumps({'output': str(output), **report['comparison'], 'transportSubmitted': False, 'inferenceExecuted': False}, ensure_ascii=False))
        return report
    except Exception as error:
        save_new(output / 'first-failure.json', {'type': type(error).__name__, 'message': str(error), 'transportSubmitted': False, 'inferenceExecuted': False})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, default=ROOT / '.local/baseline/runtime.json')
    parser.add_argument('--baseline', type=Path, default=ROOT / '.local/local-eval-preparation/1792859601674585100')
    parser.add_argument('--fixtures', type=Path, default=ROOT / 'tests/fixtures/local-eval')
    parser.add_argument('--output', type=Path, default=ROOT / '.local/studio-eval-preparation' / str(time.time_ns()))
    parser.add_argument('--h3-preprocessing', type=Path)
    parser.add_argument('--node', default='node')
    prepare(parser.parse_args())


if __name__ == '__main__':
    main()
