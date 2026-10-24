"""Injected document storage and optional classification, with no import-time I/O."""
import asyncio
import copy
import hashlib
import inspect
import io
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlencode

from .classification import classification_input, validate_classification
from .script_document import parse_docx, normalize_inventory


class ProviderUnavailable(RuntimeError):
    pass


def safe_child(root, name):
    root = Path(root).resolve()
    target = (root / name).resolve()
    if not target.is_relative_to(root) or target == root:
        raise ValueError('文档路径超出允许目录')
    return target


def atomic_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class StoryboardServices:
    """Server-owned directories and ports; never derives paths from client data.

    classifier is an optional callable receiving only classification_input rows.
    Its result must obey the original strict classification DTO. It may be async.
    No provider, network endpoint, credentials or model is supplied by default.
    """
    def __init__(self, *, cache_directory, input_directory, local_media=None,
                 classifier=None, classifier_model='', asset_catalog=None):
        self.cache_directory = Path(cache_directory).resolve()
        self.input_directory = Path(input_directory).resolve()
        self.local_media = local_media
        self.classifier = classifier
        self.classifier_model = classifier_model
        self.asset_catalog = asset_catalog

    def prepare_images(self, inventory, blobs):
        from PIL import Image, UnidentifiedImageError
        directory = safe_child(self.input_directory, 'DAELAB/script-parser')
        for aid, asset in inventory['assets'].items():
            try:
                with Image.open(io.BytesIO(blobs[aid])) as image:
                    if image.width * image.height > 40_000_000:
                        raise ValueError('图片超过4000万像素')
                    image.load()
                    output = io.BytesIO()
                    image.save(output, format='PNG')
                name = aid + '.png'
                target = safe_child(directory, name)
                data = output.getvalue()
                if not target.is_file() or target.read_bytes() != data:
                    atomic_write(target, data)
                asset.update(url='/view?' + urlencode(dict(filename=name, subfolder='DAELAB/script-parser', type='input')),
                             filename=name, subfolder='DAELAB/script-parser', type='input', kind='image')
                if self.asset_catalog is not None:
                    record = self.asset_catalog.register_file('input', 'DAELAB/script-parser/' + name,
                        kind='image', provenance={'document_id': inventory['document_id'], 'occurrence_asset_id': aid})
                    asset['catalog_asset_id'] = record['asset_id']
            except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
                asset['error'] = f'图片无法准备：{type(exc).__name__}，请替换或明确排除此图片'
        return inventory

    def import_document(self, payload, filename):
        inventory, blobs = parse_docx(payload, Path(filename).name)
        document_id = inventory['document_id']
        # Original bytes are content addressed, so retries cannot overwrite another document.
        original = safe_child(self.cache_directory, document_id + '.docx')
        if original.exists() and hashlib.sha256(original.read_bytes()).hexdigest() != document_id:
            raise ValueError('已保存的文档原件校验失败')
        if not original.exists():
            atomic_write(original, payload)
        self.prepare_images(inventory, blobs)
        atomic_write(safe_child(self.cache_directory, document_id + '.json'),
                     json.dumps(inventory, ensure_ascii=False).encode('utf-8'))
        return inventory

    def read_inventory(self, document_id):
        if not isinstance(document_id, str) or not re.fullmatch('[0-9a-f]{64}', document_id):
            raise ValueError('文档标识无效')
        path = safe_child(self.cache_directory, document_id + '.json')
        if not path.is_file():
            raise ValueError('临时草稿已清理，请重新上传原件')
        inventory = json.loads(path.read_text('utf-8'))
        if inventory.get('document_id') != document_id:
            raise ValueError('保存的文档来源不匹配')
        return inventory

    def normalize(self, payload):
        inventory = payload.get('inventory')
        if inventory is None:
            inventory = self.read_inventory(payload.get('document_id'))
        elif not isinstance(inventory, dict) or inventory.get('document_id') != payload.get('document_id'):
            raise ValueError('保存的文档来源不匹配')
        result = normalize_inventory(inventory, payload.get('choices'))
        result['assets'] = copy.deepcopy(inventory['assets'])
        return result

    async def classify(self, payload):
        if self.classifier is None:
            raise ProviderUnavailable('AI 归类未接入；可继续使用本地规则和手工映射')
        inventory = await asyncio.to_thread(self.read_inventory, payload.get('document_id'))
        choices = payload.get('choices')
        normalize_inventory(inventory, choices)
        rows = classification_input(inventory, choices)
        try:
            result = await asyncio.to_thread(self.classifier, copy.deepcopy(rows))
            if inspect.isawaitable(result):
                result = await result
        except Exception:
            raise RuntimeError('归类提供方失败；原草稿保留') from None
        return validate_classification(inventory, choices, result)

    def resolve_media(self, url):
        if self.local_media is None:
            raise ProviderUnavailable('本地素材解析服务未接入')
        return self.local_media(url)
