"""Build synthetic native workflows only. Never contacts a host or executes a prompt."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import uuid
import zlib

ROOT = Path(__file__).resolve().parents[2]
SPECS = {
    "S": dict(nodes=100, links=100, tables=1, rows=100, columns=10, videos=2),
    "M": dict(nodes=300, links=400, tables=2, rows=500, columns=10, videos=4),
    "L": dict(nodes=1000, links=1500, tables=10, rows=500, columns=10, videos=4),
}
NAMESPACE = uuid.UUID("23d7c10c-9bd9-46c1-b95d-5b9e9bf22c72")
MEDIA_FOLDER = "DAELAB/performance-synthetic-v1"
SCHEMAS = {
    "DAELAB.TextInput": ([('text', 'STRING')], [('text', 'STRING')]),
    "DAELAB.Table": ([('table_data', 'STRING'), ('source_table', 'STRING')], [('table_json', 'STRING')]),
    "DAELAB.LLMStylePreviewB": ([('原文', 'STRING'), ('参考图片', 'IMAGE'), ('素材组', 'DAELAB_ASSETS'), ('多维表格', 'STRING'), ('其他输入', '*')], [('结果', 'STRING'), ('逐行结果', 'STRING')]),
    "DAELAB.MediaUpload": ([('asset_data', 'STRING')], [('image_ref', 'COMFYTV_IMAGE'), ('image_refs', 'COMFYTV_IMAGES'), ('video_ref', 'COMFYTV_VIDEO'), ('image', 'IMAGE'), ('video', 'VIDEO')]),
}


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def identity(value):
    return str(uuid.uuid5(NAMESPACE, value))


def table_data(tier, index):
    spec = SPECS[tier]
    fields = [dict(id=f"field-{column:02}", name=f"合成列 {column:02}", type="content", width=180, hidden=False) for column in range(spec['columns'])]
    records = [dict(id=f"{tier}-table-{index:02}-row-{row:04}", name=f"合成记录 {row:04}", selected=False,
                    values={field['id']: f"性能测试 {tier} / 表 {index} / 行 {row:04} / 列 {column:02}。固定中文文本与数字 12345。" for column, field in enumerate(fields)})
               for row in range(spec['rows'])]
    return dict(version=1, fields=fields, records=records, view="table", meta={"material_columns": True, "syntheticPerformance": {"version": 1, "tier": tier}})


def make_node(node_id, node_type, widgets, properties, pos, size):
    inputs, outputs = SCHEMAS[node_type]
    return dict(id=node_id, type=node_type, pos=pos, size=size, flags={}, order=node_id - 1, mode=0,
                inputs=[dict(name=name, type=kind, link=None) for name, kind in inputs],
                outputs=[dict(name=name, type=kind, links=[], slot_index=index) for index, (name, kind) in enumerate(outputs)],
                title=f"合成性能节点 {node_id:04}", properties=properties, widgets_values=widgets)


def workflow(tier, video=False):
    spec = SPECS[tier]
    nodes = []
    for index in range(spec['tables']):
        value = encoded(table_data(tier, index))
        node = make_node(len(nodes)+1, 'DAELAB.Table', [value],
                         {'Node name for S&R': 'DAELAB.Table', 'daelabPromptOptimizationV1': {'tableId': identity(f'{tier}-table-{index}')}},
                         [(index % 2) * 1750, (index // 2) * 900], [1600, 700])
        # The old serialized widget socket is retained at index 0. It has no links.
        node['inputs'][0]['widget'] = {'name': 'table_data'}
        nodes.append(node)
    media_y = math.ceil(spec['tables']/2)*900
    for index in range(spec['videos']):
        filename = 'loop.mp4' if video else 'pattern.png'
        asset = dict(version=1, id=identity(f'{tier}-media-{index}'), kind='video' if video else 'image',
                     name=f'合成预览 {index+1}', filename=filename, subfolder=MEDIA_FOLDER, type='input')
        nodes.append(make_node(len(nodes)+1, 'DAELAB.MediaUpload', [encoded(asset)], {'Node name for S&R': 'DAELAB.MediaUpload'}, [index*540, media_y], [520, 400]))
    receiver_count = math.ceil(spec['links']/3)
    source_count = spec['nodes'] - len(nodes) - receiver_count
    sources = []
    first_grid_y = media_y+600
    for index in range(source_count):
        node = make_node(len(nodes)+1, 'DAELAB.TextInput', [f'固定合成输入 {tier}-{index:04}：蓝色方块与红色圆球。'],
                         {'Node name for S&R': 'DAELAB.TextInput'}, [(index % 8)*760, first_grid_y+(index//8)*650], [350, 220])
        nodes.append(node); sources.append(node)
    receivers = []
    base_y = first_grid_y+math.ceil(source_count/8)*650
    for index in range(receiver_count):
        node = make_node(len(nodes)+1, 'DAELAB.LLMStylePreviewB', ['', ''],
                         {'llmStylePreview': {'version': 1, 'mode': 'polish', 'model': 'qwen', 'instruction': '这是性能夹具，请勿生成。'}},
                         [(index % 8)*760, base_y+(index//8)*650], [700, 600])
        nodes.append(node); receivers.append(node)
    links = []
    for index in range(spec['links']):
        source = sources[(index*17 + index//len(sources)) % len(sources)]
        target = receivers[index//3]
        slot = (0, 3, 4)[index % 3]  # Verified pinned LLM source; never guessed socket indices.
        link_id = index+1
        links.append([link_id, source['id'], 0, target['id'], slot, 'STRING'])
        source['outputs'][0]['links'].append(link_id)
        target['inputs'][slot]['link'] = link_id
    result = dict(id=identity(f'performance-{tier}-{video}'), revision=0, version=0.4, last_node_id=len(nodes), last_link_id=len(links),
                  nodes=nodes, links=links, groups=[], config={}, extra={
                      'ds': {'scale': 0.5, 'offset': [40, 40]},
                      'daelabCreativeCanvasV1': {'version': 1, 'active': True, 'viewport': {'x': 24, 'y': 24, 'zoom': 0.5},
                                               'cards': {str(n['id']): dict(x=n['pos'][0], y=n['pos'][1], width=n['size'][0], expanded=True) for n in nodes}},
                      'syntheticPerformanceFixture': {'version': 1, 'tier': tier, 'mediaVariant': 'video' if video else 'no-video', 'executePrompts': False}})
    validate(result, tier)
    return result


def validate(document, tier):
    spec = SPECS[tier]
    nodes = {node['id']: node for node in document['nodes']}
    if len(nodes) != spec['nodes'] or len(document['links']) != spec['links']:
        raise ValueError('Incorrect node/link counts')
    links = {link[0]: link for link in document['links']}
    if len(links) != spec['links']:
        raise ValueError('Duplicate link ID')
    incoming, adjacency = {}, {node_id: [] for node_id in nodes}
    for link_id, source_id, output_index, target_id, input_index, kind in links.values():
        source, target = nodes[source_id], nodes[target_id]
        output, socket = source['outputs'][output_index], target['inputs'][input_index]
        if source_id == target_id or (target_id, input_index) in incoming:
            raise ValueError('Self-link or occupied input')
        if output['type'] != kind or socket['type'] not in (kind, '*'):
            raise ValueError('Socket type mismatch')
        if socket['link'] != link_id or output['links'].count(link_id) != 1:
            raise ValueError('Native socket back-reference mismatch')
        incoming[target_id, input_index] = link_id
        adjacency[source_id].append(target_id)
    visiting, visited = set(), set()
    def visit(node_id):
        if node_id in visiting: raise ValueError('Cycle')
        if node_id in visited: return
        visiting.add(node_id)
        for target in adjacency[node_id]: visit(target)
        visiting.remove(node_id); visited.add(node_id)
    for node in nodes.values():
        if node['type'] not in SCHEMAS: raise ValueError('Unregistered fixture node')
        for index, socket in enumerate(node['inputs']):
            if socket.get('link') != incoming.get((node['id'], index)): raise ValueError('Orphan input reference')
        for index, output in enumerate(node['outputs']):
            if set(output['links']) != {link[0] for link in links.values() if link[1:3] == [node['id'], index]}: raise ValueError('Orphan output reference')
        visit(node['id'])
    tables = [json.loads(n['widgets_values'][0]) for n in nodes.values() if n['type'] == 'DAELAB.Table']
    if len(tables) != spec['tables'] or any(len(t['records']) != spec['rows'] or len(t['fields']) != spec['columns'] for t in tables):
        raise ValueError('Table capacity/count mismatch')
    return document


def png(path):
    width, height = 320, 180
    raw = b''.join(b'\0'+bytes(channel for x in range(width) for channel in ((x*3)%256, (y*2)%256, 80 if (x//32+y//30)%2 else 180)) for y in range(height))
    def chunk(tag, data): return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b''))


def video(path):
    # Optional local encoding dependencies; never installs/downloads them.
    import av
    import numpy as np
    with av.open(str(path), 'w') as container:
        stream = container.add_stream('libx264', rate=24)
        stream.width, stream.height, stream.pix_fmt = 320, 180, 'yuv420p'
        stream.options = {'crf': '23', 'preset': 'medium', 'threads': '1'}
        yy, xx = np.mgrid[:180, :320]
        for index in range(72):
            frame = np.stack(((xx+index*4)%256, (yy*2)%256, np.full_like(xx, 160)), axis=-1).astype(np.uint8)
            for packet in stream.encode(av.VideoFrame.from_ndarray(frame,format='rgb24')): container.mux(packet)
        for packet in stream.encode(): container.mux(packet)
    return {'encoder': 'libx264', 'pyav': av.__version__, 'size': [320,180], 'fps': 24, 'frames': 72, 'durationSeconds': 3, 'audio': False}


def prepare(destination, encode_video=False):
    destination.mkdir(parents=True, exist_ok=True); (destination/'media').mkdir(exist_ok=True)
    source_contracts = ROOT/'tests/fixtures/performance/sources.json'
    if source_contracts.resolve() != (destination/'sources.json').resolve():
        (destination/'sources.json').write_bytes(source_contracts.read_bytes())
    png(destination/'media/pattern.png')
    video_info = video(destination/'media/loop.mp4') if encode_video else {'status': 'existing binary; see fixed hash and media recipe', 'frames':72, 'fps':24, 'size':[320,180]}
    video_present = (destination/'media/loop.mp4').is_file()
    entries=[]
    for tier, spec in SPECS.items():
        for media in (False, True):
            name=f'FX-PERF-{tier}-{"video" if media else "no-video"}.json'
            data=(encoded(workflow(tier, media))+'\n').encode('utf-8'); (destination/name).write_bytes(data)
            entries.append({'file':name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),**spec,'mediaVariant':'video' if media else 'no-video','videoFileAvailable':video_present if media else None,'status':'prepared-not-opened'})
    sequence=['合成收藏 0001','分组 3','黄色圆柱','1999','不存在的合成词','']
    (destination/'search-sequence.json').write_text(json.dumps({'fixture':'../asset-library/search-2000.json','queries':sequence,'repeatSequence':5,'input':'Type through actual UI; wait for visible results; never dispatch synthetic input events'},ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    jobs=[{'request_id':f'perf-fake-{index:03}','kind':('fake-local','fake-cloud','fake-transcode')[index%3], 'duration_ms':100+37*(index%11), 'outcome':'failed' if index%19==0 else 'succeeded', 'real_network':False} for index in range(100)]
    (destination/'fake-job-plan.json').write_text(json.dumps({'schemaVersion':1,'status':'workload-only-not-executed','requires':'Inject deterministic adapters into the actual scheduler; collect admission, queue wait, release and observed health latency separately','jobs':jobs},indent=2)+'\n',encoding='utf-8',newline='\n')
    media_files=[{'file':p.relative_to(destination).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted((destination/'media').iterdir()) if p.is_file()]
    manifest={'schemaVersion':1,'kind':'synthetic-performance-preparation-not-acceptance','nativeWorkflowVersion':0.4,'sourceContracts':'sources.json','executionForbidden':True,
              'protocol':{'warmupMs':10000,'sampleMs':30000,'repetitions':5,'allRawSamples':True},'workflows':entries,'media':media_files,'videoRecipe':video_info,
              'mediaInstallSubfolder':MEDIA_FOLDER,'limitations':['Both old/new actual open/save validation remains required','No inference, API provider credentials, historical receipts or user media','Visible video counts must be observed, not inferred from fixture counts','PERF-05 resource ownership and controlled GC, PERF-06 actual scheduler, PERF-07 one hour require separate evidence']}
    (destination/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    return manifest


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'tests/fixtures/performance')
    parser.add_argument('--encode-video',action='store_true',help='Encode the synthetic 3 s video with already-installed PyAV; no downloads')
    args=parser.parse_args(); result=prepare(args.output.resolve(),args.encode_video)
    print(json.dumps({'workflows':len(result['workflows']),'nodes':[s['nodes'] for s in SPECS.values()],'mediaFiles':len(result['media'])}))
