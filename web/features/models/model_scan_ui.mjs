/**
 * Manual "扫描模型" control. It never starts a scan on its own; a click opens a
 * small panel, a second explicit action runs the scan, and only a final
 * "确认应用" writes the generated local-generation.json.
 */
// @ts-expect-error Shared ESM popover owns placement, scale, escape and cleanup.
import { createSettingsPopover } from '../prompt/table_prompt_settings.mjs';
// @ts-expect-error Existing shared controls retain native button semantics.
import { createTableButton } from '../../ui/table_controls.mjs';
import { scanModels, applyModels, getGenerationFileReport } from './model_scan_api.mjs';

/** Family → display name, locked by Product (local model families). */
const FAMILY_LABEL = Object.freeze({
  image: 'Qwen-Image-2.1 Turbo（本地）',
  image_base: 'Qwen-Image-2.1（本地）',
  video_base: 'MiniMax H3 FL 低配（本地）',
  video_reference_base: 'MiniMax H3 Ref 低配（本地）',
  video_high: 'MiniMax H3 FL 高配（本地）',
  video_reference_high: 'MiniMax H3 Ref 高配（本地）',
  text_pe: 'Qwen-Image-2.1 PE（本地）',
  text_27b: 'Qwen3.8-27B（本地）',
});

const CATEGORY_LABEL = Object.freeze({
  diffusion_models: '主模型',
  text_encoders: '文本编码器',
  mmproj: '多模态投影',
  vae: 'VAE',
  video_vae: '视频VAE',
  audio_vae: '音频VAE',
  loras: 'LoRA',
});

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

const FILE_STATUS = {missing: '缺少', wrongComponent: '配置与档位不符，需使用', wrongSize: '大小不符', ambiguous: '存在同名文件', pathMismatch: '配置路径不符', unconfigured: '尚未配置'};

export function generationFileReport(kind) {
  const root = el('details', 'generation-file-report');
  const summary = el('summary', '', '正在检查本机模型文件…');
  root.append(summary);
  let disposed = false;
  async function load() {
    try {
      const entries = await getGenerationFileReport(kind);
      if (disposed) return;
      let complete = 0;
      for (const [family, files] of entries) {
        const issues = files.filter(file => file.status !== 'found');
        if (!issues.length) complete++;
        const label = (FAMILY_LABEL[family] || family).replace('（本地）', '');
        const group = el('div', 'generation-file-profile');
        group.append(el('strong', '', label + (issues.length ? ' · 待处理 ' + issues.length + ' 项' : ' · 文件齐全')));
        for (const file of issues) {
          group.append(el('div', '', (FILE_STATUS[file.status] || file.status) + ' · ' + file.category + '/' + file.name));
        }
        root.append(group);
      }
      summary.textContent = '本机模型文件 · ' + complete + '/' + entries.length + ' 组齐全';
      root.open = complete < entries.length;
    } catch (error) {
      if (!disposed) summary.textContent = '读取本机模型目录失败，重新打开菜单可重试';
    }
  }
  void load();
  return {root, dispose: () => { disposed = true; }};
}

function describeFamily(item) {
  const family = FAMILY_LABEL[item.family] || item.family;
  const category = CATEGORY_LABEL[item.category] || item.category;
  return `${family} · ${category}`;
}

/** Creates a self-contained "扫描模型" button. Returns {root, dispose}. */
export function createModelScanButton({ active = () => true } = {}) {
  let disposed = false;
  let popover = null;
  const root = createTableButton('扫描模型', open);
  root.className = 'model-scan-trigger';
  root.setAttribute('aria-haspopup', 'dialog');
  root.setAttribute('aria-expanded', 'false');
  root.title = '扫描本地模型目录，按哈希匹配生成配置';

  function open() {
    if (disposed || !active() || popover) return;
    popover = createSettingsPopover(root, '扫描本地模型', () => { popover = null; }, { placement: 'below' });
    renderBody(popover.root);
  }

  function renderBody(container) {
    const scanBtn = createTableButton('开始扫描', () => runScan(container));
    scanBtn.className = 'model-scan-action';
    const hint = el('p', 'model-scan-hint', '按文件名筛候选、大小用于冲突判断，再对候选算 SHA-256 与已知清单核对；同名冲突（异大小/异哈希）交你裁决，不自动换量化、不下载、不启动 Ollama。');
    const results = el('div', 'model-scan-results');
    const actions = el('div', 'model-scan-footer');
    container.append(scanBtn, hint, results, actions);

    async function runScan() {
      scanBtn.disabled = true;
      results.replaceChildren(el('p', 'model-scan-state', '扫描中…'));
      actions.replaceChildren();
      try {
        const result = await scanModels();
        renderResults(results, actions, result);
      } catch (error) {
        results.replaceChildren(el('p', 'model-scan-error', error?.message || String(error)));
      } finally {
        scanBtn.disabled = false;
      }
    }
  }

  function renderResults(results, actions, result) {
    results.replaceChildren();
    const { hits = [], conflicts = [], missing = [] } = result || {};
    if (!hits.length && !conflicts.length && !missing.length) {
      results.append(el('p', 'model-scan-state', '清单为空，无可扫描的模型。'));
      return;
    }
    if (hits.length) {
      results.append(el('h4', 'model-scan-section', '已匹配'));
      for (const hit of hits) results.append(el('p', 'model-scan-line model-scan-hit', `${describeFamily(hit)} ✓`));
    }
    if (missing.length) {
      results.append(el('h4', 'model-scan-section', '未找到'));
      for (const miss of missing) results.append(el('p', 'model-scan-line model-scan-missing', `${describeFamily(miss)} · 缺失`));
    }
    const adopted = new Set();
    if (conflicts.length) {
      results.append(el('h4', 'model-scan-section', '同名冲突（异大小/异哈希）'));
      for (const conflict of conflicts) {
        const key = `${conflict.family}\u0000${conflict.category}`;
        const label = el('label', 'model-scan-line model-scan-conflict');
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = false;
        check.addEventListener('change', () => { if (check.checked) adopted.add(key); else adopted.delete(key); syncApply(); });
        const sizeNote = conflict.sizeMismatch ? `（大小不符：清单 ${conflict.expectedBytes} / 实际 ${conflict.actualBytes}）` : '（哈希不符）';
        label.append(check, el('span', null, `${describeFamily(conflict)} ${sizeNote}`));
        results.append(label);
      }
    }

    const applyButton = createTableButton('确认应用', () => apply());
    applyButton.className = 'model-scan-apply';
    applyButton.disabled = true;
    applyButton.title = '把命中项（和勾选的同名冲突项）写入 local-generation.json，需重启生效';
    actions.append(applyButton);

    function syncApply() {
      applyButton.disabled = !hits.length && !adopted.size;
    }
    syncApply();

    async function apply() {
      applyButton.disabled = true;
      const adoptConflicts = [...adopted].map(key => {
        const [family, category] = key.split('\u0000');
        return { family, category };
      });
      try {
        await applyModels(adoptConflicts);
        actions.replaceChildren(el('p', 'model-scan-state', '已写入，重启 ComfyUI 后生效。'));
      } catch (error) {
        actions.replaceChildren(el('p', 'model-scan-error', error?.message || String(error)));
        actions.append(applyButton);
        applyButton.disabled = false;
      }
    }
  }

  return {
    root,
    dispose() { disposed = true; popover?.close(); root.remove(); },
  };
}
