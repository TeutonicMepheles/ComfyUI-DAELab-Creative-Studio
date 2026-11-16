# 11 月 13 日会议工作流修复与任务登记

基线 `9d31ff8`，分支 `codex/workflow-bug-docs-20261116`。需求依据为 11 月 13 日 Recording 2、任务交付指南和 11 月 16 日用户的阶段范围调整。本轮优先修复工作流 Bug 并补齐文档；附加风格噪点及 VAE/解码检查、中文文字清晰度对比暂缓。MiniMax 跨镜头质量对比留待后续效果评估，不在本轮执行。

## 复现与修复

隔离 CPU 宿主 8371 的实际页面确认：独立表格导出后空解析器仍有输出“＋”；选中导出提示文字后点击缩放按钮，选区仍保留。原始记录 `.local/workflow-bugs-first.json/png`，复现脚本 `.local/workflow-bugs-probe.mjs`。脚本初次运行缺少 Playwright 依赖，`npm ci` 后恢复；选区探针曾选择不可见文本并改正，原探针不作为通过依据。

修复归属：`canvas/creative_connections.mjs` 提供输出能力投影，`creative_canvas_view.mjs` 在能力变化时刷新端口，`integrations/comfyui/business/script_parser.js` 声明空解析器不可新建输出。已有连线和槽位保留，含记录的旧解析器仍可输出。`creative_navigation.mjs` 清理跨控件点击的画布文字选区，保留同编辑器和外部选区。图片/视频素材追加继续复用既有实现。

追踪范围：F-CAN-018 / F-BIZ-020 / F-BIZ-024 的交互与导入输出子范围；不代表完整 TC-BIZ-020、TC-BIZ-024、TC-CAN-018 或 M6 通过。

## 检查记录

- 完整 `npm run check`：前端 479 通过、3 既有跳过；业务 725 通过。日志 `.local/workflow-bugs-check-r3.log`。前两轮因迁入文件及测试的目标指纹未同步而失败，原日志 `workflow-bugs-check-first.log`、`workflow-bugs-check-final.log` 保留；更新目标哈希与变更说明，原始来源哈希未改。
- 真实宿主脚本：`STUDIO_TEST_URL=http://127.0.0.1:<port> node tests/browser/workflow_bug_followups.mjs`。合成解析数据通过生产文档控制器提交，不代替真实 DOCX 解析质量验收；生成端点拦截。
- 连续上传脚本：同一宿主设置 `STUDIO_TEST_NODE_TYPE=DAELAB.ImageGenerate` 或 `DAELAB.VideoGenerate` 后运行 `node tests/browser/material_upload_add.mjs`。真实 PNG 上传，不执行生成。
- 实际 CPU ComfyUI：8372 为 Studio 独立安装；8373 为 Studio + 固定 ComfyTV `a5e0c16b5ca7f74b31293c2f940a704107e4a009` 的可选组合，ComfyTV 以测试包别名加载且启动日志确认成功。两者独立 user/input/output/temp，不修改 8000 或已有 8365。前端指纹均为 `141dc7e23e0c4338f67f5519c5a2a4cd19d99492c2f15d8e63de81c1baeaf6dd`；环境清单在 `.local/workflow-bugs-20261116-{final,optional}/creative-studio-isolation.json`。
- 两宿主工作流检查通过：双解析器、独立表格输出、上传入口保留、旧内表输出及清空后端口刷新、跨控件选区清理、标题拖动、Mute/Bypass/Active、双实例隔离、1700×1050 与 1000×800、50%/100%/150% 的相关溢出检查。文本输入对图片/视频/文本生成的生产目标策略及原生连接通过，保存 JSON 后实际刷新加载保持三条连线和文本。连线使用原生连接 API，不冒充全套鼠标拉线验收。证据 `.local/8372-workflow-bugs.json`、`8373-workflow-bugs.json` 及同端口 `workflow-parsers.png`、`workflow-bugs.png`，日志 `workflow-bugs-ui-<port>-settled.log`。
- 两宿主的图片、视频各双实例连续上传通过，共四轮、每轮四次真实 `/upload/image` 返回 200；覆盖上传、删除再追加、保存重开再上传、缩放/视口和 Mute/Active。证据 `.local/<port>-{image,video}-material-add-actual.json/png`，日志 `workflow-bugs-upload-<port>-<kind>*.log`；无生成提交。
- 本地 Markdown 链接检查通过（128 文档，仅本地文件，不抓外链与锚点）；规格渲染与追踪检查通过，分别为 126 功能/49 用例/146 测试和 316 验收条件。它们是文档与工具检查，不代表对应产品用例全部验收。
- 最终完整检查重复通过，日志 `.local/workflow-bugs-check-delivery.log`、`workflow-bugs-docs-final.log`；最终构建指纹保持。三台本轮临时宿主在空队列及进程身份核对后退役，原件和数据保留，登记 `.local/workflow-bugs-teardown.json`。尚未合并、推送或部署到用户安装。

## 任务状态

| 编号 | 当前状态 | 剩余交付 |
| --- | --- | --- |
| AIGC-1113-01 | 本轮已复现的两项 Bug 已修复，独立/组合宿主回归通过 | 本地功能分支待审核集成及开发版交接；正式发布另受 M6 门槛约束 |
| AIGC-1113-02 | 部分实现，已校正模型文档 | image/video/text 已有共享目录；四类字段、3D、环境策略和 API 字段仍待补齐 |
| AIGC-1113-03 | 未发现本轮完整交付证据 | 明确旧展厅维护目标，再核对 UI Bug 和验收；不向 Studio 复制旧注册 |
| AIGC-1113-04 | 等待详细需求，组件能力已存在 | 需求到位后统一局部编辑/抠图流程，验证持久化及模式 |
| AIGC-1113-05 | 本次可访问反馈中未见详细文档 | 接收张梦涵需求及验收条件 |
| AIGC-1113-06 | 阶段技术总结已编写 | 随 02–04 交付继续追加证据；见技术总结 |
| AIGC-1113-07 | 待关键模块完成 | 业务实测与估算分开记录，本轮不执行 |

[阶段技术总结](../TECHNICAL_SUMMARY_20261116.md)记录模块、模型盘点、测试边界和回滚方式。本登记是当前阶段状态入口；会议原始 `tasks.json` 与 Word 保留原始快照，不覆盖历史记录。
