import {getGenerationFileReport} from './model_scan_api.mjs';

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
