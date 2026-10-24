"""Capture pinned ComfyUI image preprocessing on CPU, with no models or queues.

This is preparation evidence only. Live runs must recapture the same boundaries.
Complete original definitions are evaluated in explicit dependency namespaces;
only latent allocation, token encoding, VAE encoding and output packaging are doubles.
"""
import argparse
import hashlib
import io
import itertools
import json
import logging
import math
import os
from pathlib import Path
import subprocess
import sys
import time
from fractions import Fraction
from types import SimpleNamespace
from typing import Optional

try:
    from .prepare_local_inputs import HOST, ROOT, file_hash, no_external_io, safe_relative, save_new, selected
except ImportError:
    from prepare_local_inputs import HOST, ROOT, file_hash, no_external_io, safe_relative, save_new, selected


def verified_source(root, name, evidence):
    path = safe_relative(root, name)
    committed = subprocess.run(['git', '-C', str(root), 'show', HOST + ':' + name],
                               capture_output=True, check=False, timeout=15)
    current = path.read_bytes()
    if committed.returncode or current.replace(b'\r\n', b'\n') != committed.stdout.replace(b'\r\n', b'\n'):
        raise ValueError('Pinned host source changed: ' + name)
    evidence[name] = {'commit': HOST, 'sha256': hashlib.sha256(current).hexdigest()}
    return current.decode('utf-8')


def tensor_identity(value):
    import torch
    if value.device.type != 'cpu' or value.dtype != torch.float32:
        raise ValueError('Preparation requires actual CPU float32 tensors.')
    array = value.detach().contiguous().numpy().astype('<f4', copy=False)
    return {'shape': list(value.shape), 'dtype': 'float32', 'byteOrder': 'little',
            'sha256': hashlib.sha256(array.tobytes(order='C')).hexdigest(), 'bytes': array.nbytes}


def verified_fixtures(root):
    root = Path(root).resolve()
    manifest = json.loads((root / 'manifest.json').read_text('utf-8'))
    if file_hash(root / 'samples.json') != manifest['samplesSha256']:
        raise ValueError('Declared sample input changed.')
    for media in manifest['media']:
        source = safe_relative(root, media['path'])
        if source.stat().st_size != media['bytes'] or file_hash(source) != media['sha256']:
            raise ValueError('Declared synthetic image changed.')
    samples = json.loads((root / 'samples.json').read_text('utf-8'))['samples']
    chosen = [sample for sample in samples if sample['entry'] == 'local-video']
    if [sample['id'] for sample in chosen] != ['LOCAL-H3-001', 'LOCAL-H3-002', 'LOCAL-H3-003']:
        raise ValueError('Expected all three fixed H3 samples in order.')
    for sample in chosen:
        if sample['settings'] != {'width': 512, 'height': 288, 'duration': 1.5, 'turbo': False, 'seed': 20261023}:
            raise ValueError('H3 preparation parameters differ from the fixed evaluation.')
    return chosen


def capture(host_root, fixture_root, output):
    import av
    import numpy as np
    import torch
    from PIL import Image, ImageOps, ImageSequence, __version__ as pillow_version
    if torch.cuda.is_initialized():
        raise ValueError('Use a fresh process without an initialized CUDA context.')
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    evidence = {}
    texts = {name: verified_source(host_root, name, evidence) for name in (
        'nodes.py', 'comfy/utils.py', 'comfy_extras/nodes_minimax_h3.py',
        'comfy_api/latest/_input_impl/video_types.py')}
    fixture_root = Path(fixture_root).resolve()
    samples = verified_fixtures(fixture_root)
    # Hash the complete declared fixture manifest; per-image hashes are recorded below.
    report = {'schemaVersion': 1, 'kind': 'cpu-preprocessing-preparation', 'inferences': 0,
              'submitted': 0, 'cudaInitialized': False, 'sources': evidence,
              'toolSha256': file_hash(__file__), 'fixtureManifestSha256': file_hash(fixture_root / 'manifest.json'),
              'versions': {'python': sys.version, 'torch': torch.__version__, 'av': av.__version__,
                           'numpy': np.__version__, 'pillow': pillow_version}, 'samples': [],
              'limitations': ['Model, VAE and latent allocation are explicit doubles; no sampling occurred.',
                              'Live executions must capture these tensor boundaries again.']}
    utility = {'torch': torch, 'np': np, 'Image': Image}
    selected(texts['comfy/utils.py'], ['lanczos', 'common_upscale'], utility)
    comfy = SimpleNamespace(utils=SimpleNamespace(common_upscale=utility['common_upscale']),
                            model_management=SimpleNamespace(intermediate_dtype=lambda: torch.float32,
                                                             intermediate_device=lambda: torch.device('cpu')))
    video = {'av': av, 'np': np, 'torch': torch, 'io': io, 'itertools': itertools,
             'json': json, 'math': math, 'os': os, 'logging': logging, 'Optional': Optional,
             'Fraction': Fraction, 'VideoInput': object, 'AudioInput': dict,
             'VideoComponents': SimpleNamespace, 'InputContainer': av.container.InputContainer,
             'VideoContainer': SimpleNamespace(AUTO='auto'), 'VideoCodec': SimpleNamespace(AUTO='auto'),
             'comfy': comfy}
    selected(texts['comfy_api/latest/_input_impl/video_types.py'],
             ['_rotation_quadrant', 'last_decodable_audio_stream', 'VideoFromFile'], video)
    loader = {'comfy': comfy, 'torch': torch, 'np': np, 'Image': Image,
              'ImageOps': ImageOps, 'ImageSequence': ImageSequence,
              'folder_paths': SimpleNamespace(get_annotated_filepath=lambda p: str(safe_relative(fixture_root, p))),
              'InputImpl': SimpleNamespace(VideoFromFile=video['VideoFromFile']),
              'node_helpers': SimpleNamespace(pillow=lambda fn, *args: fn(*args))}
    selected(texts['nodes.py'], ['LoadImage'], loader)
    h3 = {'comfy': comfy, 'io': SimpleNamespace(ComfyNode=object, NodeOutput=lambda *args: args),
          '_empty_av_latent': lambda width, height, length: ({'testOnly': True}, length),
          'node_helpers': SimpleNamespace(conditioning_set_values=lambda cond, values: (cond, values))}
    selected(texts['comfy_extras/nodes_minimax_h3.py'], ['_resize', 'MiniMaxH3ImageToVideo'], h3)
    with no_external_io():
        for sample in samples:
            tensors, sources, tokenized, encoded = [], [], [], []
            for relative in sample['references']:
                source = safe_relative(fixture_root, relative)
                # Only the public synthetic, local PNG fixtures can reach PyAV.
                if source.suffix.lower() != '.png' or not source.is_file():
                    raise ValueError('Expected an existing synthetic PNG.')
                tensors.append(loader['LoadImage']().load_image(relative)[0])
                sources.append({'path': relative, 'sha256': file_hash(source), 'loaded': tensor_identity(tensors[-1])})

            def tokenize(prompt, images):
                tokenized.extend(images)
                return {'preparationOnly': True}

            def encode(value):
                index = len(encoded)
                if index >= len(tokenized) or value is not tokenized[index]:
                    raise ValueError('Tokenize and VAE boundaries did not receive the same ordered image object.')
                encoded.append(tensor_identity(value))
                return {'preparationOnly': True}

            clip = SimpleNamespace(tokenize=tokenize, encode_from_tokens_scheduled=lambda tokens: [])
            vae = SimpleNamespace(encode=encode)
            h3['MiniMaxH3ImageToVideo'].execute(clip, vae, 'preprocessing-only', 512, 288, 39,
                                                first_frame=tensors[0] if tensors else None,
                                                last_frame=tensors[1] if len(tensors) > 1 else None)
            identities = [tensor_identity(value) for value in tokenized]
            if identities != encoded:
                raise ValueError('Tokenize and VAE tensor bytes changed.')
            if torch.cuda.is_initialized():
                raise ValueError('CPU preparation unexpectedly initialized CUDA.')
            report['samples'].append({'id': sample['id'], 'mode': sample['mode'], 'width': 512, 'height': 288,
                                      'frames': 39, 'sources': sources, 'tokenize': identities, 'vae': encoded,
                                      'sameOrderedTensorObjects': True})
    save_new(output / 'preprocessing.json', report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, default=ROOT / '.local/baseline/runtime.json')
    parser.add_argument('--fixture-root', type=Path, default=ROOT / 'tests/fixtures/local-eval')
    parser.add_argument('--output', type=Path, default=ROOT / '.local/h3-preprocessing' / str(time.time_ns()))
    args = parser.parse_args()
    runtime = json.loads(args.runtime.read_text('utf-8'))
    if runtime['host']['gitHead'] != HOST:
        raise ValueError('Runtime host does not match the pinned baseline.')
    result = capture(Path(runtime['host']['root']), args.fixture_root, args.output)
    print(json.dumps({'output': str(args.output), 'samples': len(result['samples']), 'inferences': 0,
                      'cudaInitialized': result['cudaInitialized']}))


if __name__ == '__main__':
    main()
