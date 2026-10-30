"""Only pure frozen-input and suggestion rules; no former Ledger or Service."""
import json
import re
from .optimization_instructions import INSTRUCTION_VERSION, INSTRUCTION_DIGEST, INPUT_VERSION
from .context_copy import context_copy_reason
from .parameters import QWEN_MODEL
MODEL_LIMITS = {'gpt-6-luna': {'maxOutputTokens':4096,'contextTokens':262144}, QWEN_MODEL: {'maxOutputTokens':1024,'contextTokens':16384}, 'deepseek-flash': {'maxOutputTokens':4096,'contextTokens':131072}}
TOKEN = re.compile(r'⟦DAE_REF_[A-Za-z0-9_-]+_\d+⟧')

def validate_snapshot(s):
    if set(s) != {'contractVersion', 'target', 'revision', 'requestSeq', 'snapshotDigest', 'model', 'requirements', 'purpose', 'instructionVersion', 'instructionDigest', 'inputVersion', 'maxOutputTokens', 'input', 'inputText'}:
        raise ValueError('快照包含未知字段或缺少契约字段')
    if s.get('contractVersion') != 1 or s.get('instructionVersion') != INSTRUCTION_VERSION or s.get('instructionDigest') != INSTRUCTION_DIGEST or s.get('inputVersion') != INPUT_VERSION:
        raise ValueError('请求契约或固定指令已改变，请重新估算')
    for value in s['target'].values():
        if not isinstance(value, str) or not value or len(value) > 200:
            raise ValueError('目标身份无效')
    if set(s['target']) != {'documentId', 'tableId', 'recordId', 'fieldId'}:
        raise ValueError('目标身份不完整')
    if not re.fullmatch('[a-f0-9]{64}', s['snapshotDigest']):
        raise ValueError('快照摘要无效')
    for key in ('revision', 'requestSeq'):
        if not isinstance(s[key], int) or s[key] < 0:
            raise ValueError('修订无效')
    if s['model'] not in MODEL_LIMITS or not isinstance(s['maxOutputTokens'], int) or not 32 <= s['maxOutputTokens'] <= MODEL_LIMITS[s['model']]['maxOutputTokens']:
        raise ValueError('模型或输出预算不受支持，请重新选择')
    # Ledger canonicalization sorts dictionary keys, while inputText is the exact
    # frozen wire payload. Validate its order and bytes, then compare redundancy.
    if not isinstance(s['inputText'], str) or len(s['inputText']) > 120000:
        raise ValueError('输入与冻结 JSON 不一致或过长')
    try:
        inp = json.loads(s['inputText'])
    except ValueError:
        raise ValueError('冻结输入不是有效 JSON') from None
    if not isinstance(inp, dict) or list(inp) != ['purpose', 'optimization_requirements', 'prompt_text', 'protected_tokens', 'reference_context']:
        raise ValueError('输入字段或次序无效')
    if inp != s['input'] or json.dumps(inp, ensure_ascii=False, separators=(',', ':')) != s['inputText']:
        raise ValueError('输入与冻结 JSON 不一致或格式已改变')
    if inp['purpose'] not in ('image', 'video', 'general') or not isinstance(inp['prompt_text'], str) or not inp['prompt_text'].strip():
        raise ValueError('提示词为空或用途无效')
    if not isinstance(inp['optimization_requirements'], str) or not inp['optimization_requirements'].strip() or s['purpose'] != inp['purpose']:
        raise ValueError('优化要求或用途不一致')
    protected = inp['protected_tokens']
    if not isinstance(protected, list) or TOKEN.findall(inp['prompt_text']) != protected or len(set(protected)) != len(protected):
        raise ValueError('保护标记不完整')
    if len(inp['reference_context']) != len(protected):
        raise ValueError('引用上下文缺失')
    for token, ref in zip(protected, inp['reference_context']):
        if not isinstance(ref, dict) or ref.get('token') != token or not {'token', 'kind', 'label'} <= ref.keys() or not set(ref) <= {'token', 'kind', 'label', 'text', 'role'}:
            raise ValueError('引用上下文结构无效')
        if any(not isinstance(v, str) for v in ref.values()) or ('text' in ref and ref['kind'] != 'text'):
            raise ValueError('引用只允许文字上下文')
        if any(re.search(r'https?://|file://|data:|[A-Za-z]:[\\/]', v, re.I) for k, v in ref.items() if k != 'text'):
            raise ValueError('素材 URL 或路径不能发送')

def suggestion(response, snapshot):
    if response.get('status') != 'completed':
        return {'status': 'invalid', 'text': '', 'reason': '响应未完整完成，不能应用'}
    contents = [c for o in response.get('output', []) if o.get('type') == 'message' for c in o.get('content', [])]
    if any(c.get('type') == 'refusal' for c in contents):
        return {'status': 'invalid', 'text': '', 'reason': '模型拒绝此请求'}
    text = ''.join(c.get('text', '') for c in contents if c.get('type') == 'output_text')
    original = snapshot['input']['prompt_text']
    valid = bool(text.strip()) and len(text) <= 100000 and not text.lstrip().startswith(('```', '{', '['))
    valid = valid and TOKEN.findall(text) == snapshot['input']['protected_tokens']
    # Reject malformed/unknown reserved delimiters as well as exact-token changes.
    residue = TOKEN.sub('', text)
    valid = valid and 'DAE_REF_' not in residue and '⟦' not in residue and '⟧' not in residue
    valid = valid and not re.search(r'@(image|video|audio)_\d+\b|\{\{\s*Node\b', residue, re.I)
    copied_reason = context_copy_reason(snapshot['input'], text) if valid else None
    if copied_reason:
        return {'status': 'invalid', 'text': text, 'reason': copied_reason}
    return {'status': ('unchanged' if text == original else 'valid') if valid else 'invalid',
        'text': text, 'reason': '' if valid else '输出为空、格式无效或引用标记已改变'}
