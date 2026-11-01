# PR #18 补审缺陷修复

基线 `d639af23`（分支 `codex/meeting-feedback-fixes`）。本次只修 Golajah-Reviewer 在 PR #18 补审中列出的两项阻塞缺陷，不新增功能，不改写已推送的 22 个提交。

## P1 剪辑去重丢失已有裁剪与主动副本

F：剪辑素材同步。AC：改名前后的同一素材按身份解析到去重后保留的那条，已有片段保留 clip ID、裁剪区间和主动副本，不重建从头开始的默认片段；真正断开的素材仍删除其片段。UC：输入顺序交换、改名、保存后重载。

修改 `features/editor/video_edit_model.mjs` 的 `connectedEdit`：新增按素材身份索引去重后保留条目的映射，片段在按含文件名的 `sourceKey` 找不到时改用身份解析；新增素材时同时按既有片段的素材身份判断是否已存在，避免为改名后的同一素材再追加一条默认片段。

修复前失败记录（`tests/migrated_canvas/video_edit_model.test.mjs`，场景为同身份 `renamed.mp4` 排在 `old.mp4` 之前）：

```
[ [ 'trimmed', 2, 3, true ], [ 'copy', 2, 3, false ] ]
```

实际得到一条 `start=0 / duration=10`、新 clip ID 的默认片段，与审查人复现一致。修复后同一用例通过，并新增：顺序交换后片段不变、保存序列化后重载幂等、真正断开的素材仍删除片段。

## P2 提示词列头「应用全部」面板抽卡次数无效

F：整列模型配置悬浮窗。AC：点击抽卡次数后更新草稿并重绘，「应用全部」后保存到提示词列与各行配置，重新打开时按已保存次数显示。UC：选择、应用、重载。

修改 `features/generation/table_generation_panel.mjs` 的 `drawSettings`：调用 `createGenerationParameters` 时补传 `onAttempts`，与其他入口一致地写入 `draft.attempts` 并重绘。

修复前失败记录（`tests/migrated_business/generation_parameters.test.mjs`）：点「4 次」后 `draft.attempts` 仍为 `undefined`（`aria-pressed` 保持 `false`），落进 `table_prompt_settings.mjs` 的默认空回调。修复后同一用例通过。

该用例不桩掉被测代码：从 `table_generation_panel.mjs` 读取 `openPromptColumn` 内真实的 `drawSettings` 源码执行，并使用真实的 `createGenerationParameters`、`applyColumnGenerationConfig`、`rowGenerationConfig` 和 `generationAttempts`，只提供最小 DOM 替身与表格夹具，因此缺少回调时必然失败。

## 检查结果（2026-11-01，本机）

- `npm run check`：类型、构建、架构、资产校验通过；前端 409 项（406 通过、3 跳过），业务 613 项全部通过。退出码 0。
- `npm run check:docs`：构建 302 个产物，125 份 Markdown 的本地链接通过。
- 新增用例在修复前失败、修复后通过（上面两处记录）；其余既有用例未改断言、全部通过。
- `docs/provenance/canvas-files.json` 更新 `video_edit_model.mjs` 与对应用例的当前哈希，并保留原始上游哈希。

## 未覆盖

- 未在隔离 ComfyUI 宿主或浏览器中重跑本次两项的界面与保存重载用例；本机只跑了自动测试与构建检查。指针命中、缩放和真实中文输入法未验证。
- 未执行真实模型推理或云调用；P2 只验证配置保存与下游配置取值，不验证真实抽卡执行。
- 需要 Golajah-Reviewer 对包含本次修复的新 HEAD 重新复核；本次合并仍不构成 M6 或发布验收，不发布、不建标签、不部署。
