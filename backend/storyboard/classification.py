"""Pure classification DTO validation; provider transport is deliberately absent."""
import json
from .script_document import KINDS, ROLES

def classification_input(inventory, choices):
    rows = []
    for table in inventory['tables']:
        if table['id'] not in choices.get('tables', {}):
            continue
        for row in table['rows']:
            rows.append(dict(row_id=row['id'], cells=[dict(cell_id=c['id'], text=c['text'], anchor=c['anchor']) for c in row['cells']]))
    data = json.dumps(rows, ensure_ascii=False)
    if len(data) > 120000:
        raise ValueError('选中原文超过 AI 归类请求上限，请缩小选表范围或使用手工映射')
    return rows


def validate_classification(inventory, choices, result):
    """Reject omissions, invented sources, rewritten text and cross-row cells."""
    if not isinstance(result, dict) or set(result) != {'rows'} or not isinstance(result['rows'], list):
        raise ValueError('AI 返回必须只包含 rows 列表')
    expected = {r['row_id']: r for r in classification_input(inventory, choices)}
    seen = set()
    output = json.loads(json.dumps(choices))
    for item in result['rows']:
        if not isinstance(item, dict) or set(item) != {'row_id', 'kind', 'cells'}:
            raise ValueError('AI 返回包含改写内容或未知字段')
        rid = item['row_id']
        if rid not in expected or rid in seen or item['kind'] not in KINDS:
            raise ValueError('AI 返回来源缺失、重复或行归类无效')
        seen.add(rid)
        if not isinstance(item['cells'], list):
            raise ValueError('AI 单元格归类无效')
        actual_cells = set()
        expected_cells = {c['cell_id'] for c in expected[rid]['cells']}
        for cell in item['cells']:
            if not isinstance(cell, dict) or set(cell) != {'cell_id', 'role'}:
                raise ValueError('AI 不允许改写原文')
            cid = cell['cell_id']
            if cid not in expected_cells or cid in actual_cells or cell['role'] not in ROLES:
                raise ValueError('AI 单元格来源不存在、跨行或重复')
            actual_cells.add(cid)
        if actual_cells != expected_cells:
            raise ValueError('AI 遗漏原始单元格')
        tid = rid.split('/')[0]
        output['tables'][tid].setdefault('rows', {})[rid] = item['kind']
        output['tables'][tid].setdefault('cell_roles', {}).update({c['cell_id']: c['role'] for c in item['cells']})
    if seen != set(expected):
        raise ValueError('AI 遗漏原始行')
    return output
