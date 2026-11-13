# 处理要求编辑区可读性 · 2026-11-13

基线 `f8cd280`，用户截图显示图片反推模式的处理要求被压成一条缝。原因是 `height:0`、可收缩的字段容器及外层隐藏溢出叠加；此前只检查横向溢出，漏掉反推模式的可读高度。本记录更正先前界面验收范围，不撤销已验证的后端协议检查。

## 修复与归属

只修改 prompt 模块的布局：取消原文/要求的剩余空间压缩，处理要求默认 138px（23px 行高扣除内边距后至少五行），原文 134px；长文本内滚，表单不足时外滚，并为聚焦滚动保留边距。允许拖动编辑区增高，不新增数据所有者、请求或模型依赖。适用旧处理要求和新补充要求。

追踪：F-BIZ-017 / AC-BIZ-017-001、003 / UC-BIZ-007；只验证 TC-BIZ-046/048 相关界面子范围，不声称完整 TC 或 M6 通过。

## 实际部署与检查

最终 CSS SHA-256：`4c421a1ff54a63b4e67e2a7c3de6f906394d182988fab0c8e42c9bec592ffb7f`。将构建的单个 CSS 同步至 8365（原运行副本）、8366（独立预览）、8367（ComfyTV 组合预览）；每个原文件均先备份，清单在 `.local/requirements-hotfix/deployment.json`。没有替换 JS、后端、用户工作流、数据或模型配置，也没有重启服务。运行副本的旧 build manifest 仍标识原包；本次是明确记录的单样式热修复，不代表全包升级。

三个实际服务均执行 `.local/requirements-layout.mjs`，日志 `.local/layout-8365-actual.log`、`layout-8366-actual.log`、`layout-8367-actual.log` 全部通过。原始测量与截图为 `.local/<port>-requirements-actual.json` 和 `<port>-requirements-fixed-actual.png`。浏览器使用独立 context，不操作用户现有页面；所有生成请求拦截，没有推理或付费调用。

每个宿主创建两个实际文本节点，检查旧视频/Seedance 要求和新版反推要求、至少五行、聚焦时输入框完整处于表单视口内、长文本输入、实例隔离、润色/反推往返、保存 JSON 后刷新重开、Mute/Active。创作画布在 1500×1050 / 1000×800、50% / 100% / 150% 下复查。可重复入口 `STUDIO_TEST_URL=http://127.0.0.1:8366 node tests/browser/requirements_layout.mjs` 仅允许显式回环 .local 宿主；该版本在 8366 执行通过，日志 `.local/requirements-tracked-browser.log`。

## 首次失败与复查

第一次测试误将不同模式的独立草稿都要求以同一句开始，已改为在原模式直接验证输入与实例隔离，模式往返检查实际几何。8365 的 150% 检查随后发现聚焦时底边仍被遮住约 2px，原日志 `layout-8365-candidate-r2.log` 与截图 `8365-clipped-candidate.png` 保留。加入滚动边距后 `layout-8365-candidate-r3.log` 及上述实际部署复查通过，未放宽五行与视口完整性断言。

`npm run check` 日志 `.local/requirements-check.log`；该项是自动回归，不代替上述实际页面复查。未运行任何真实模型质量或 GPU 推理验收。
