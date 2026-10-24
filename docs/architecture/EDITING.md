# 编辑事务与异步结果

原生 ComfyUI 工作流是保存与撤销的依据。`DocumentController` 不保存文档副本或后端任务状态；`business_document.ts` 只保存会话身份、输入版本、当前输入分组和未完成请求票据。事务内的临时克隆用于先校验再提交，不是第二份可写工作流。

## 当前产品接线

| 入口 | 原生编辑数据 | 事务与异步入口 |
| --- | --- | --- |
| 多维表格、分镜表 | 原节点的 `table_data` / `storyboard_data`，现有 `__dataTable` 是面板投影缓存 | `createTableEditor.change` → `BusinessDocument` → `DocumentController` → 原生历史 |
| ScriptParser | 原节点 `table_data`，现有 `__scriptTable` 是面板投影缓存 | 同一表格编辑器；DOCX 导入、归一与确认持有会话票据 |
| 提示词解析、人工审阅 | 原表格稳定 recordId / fieldId 所在单元格 | 每行票据与原有依赖检查同时成立后，一次批量事务应用 |
| LLM 配置与同意更改 | `node.properties.llmStylePreview` | 配置编辑和显式应用经文档控制器；撤销应用委托宿主 Undo |
| 表格图片、素材组上传、文稿导入 | 原表格素材或记录 | 等待上传/预览前取得票据，提交前检查会话和输入版本 |
| 连线表格与旧回执投影 | 原节点的兼容字段 | `derived` 修改经宿主 `amend` 合入当前状态，不新增历史步骤 |

原始字段、未知字段、素材身份、recordId 和 fieldId 随临时文档整体保留。原有校验仍在提交前运行。初始化和 `onConfigure` 从原生 widget 恢复缓存属于加载，不另建编辑历史。旧组件无原生文档绑定的独立测试入口仍可使用 `SnapshotHistory`；正式 Table 和 ScriptParser 均注入原生绑定，不使用该栈执行产品撤销。

原生 properties 及其嵌套素材可能是宿主响应式 Proxy。`contracts/json_snapshot.ts` 的 `snapshotJson` 是宿主无关的 JSON 值边界，供 `BusinessDocument` 的读取/替换事务和 LLM 面板的读取/建议投影/应用使用。它按原生保存语义生成临时快照，完整保留未知 JSON 键，不按 schema 裁剪；对象的 undefined 字段省略、数组 undefined 项变为 null。非有限数字、bigint、function、symbol 和循环引用在打开编辑事务前拒绝。替换使用自有数据属性，避免 `__proto__` 等未知键触发 setter。此 helper 不存储文档，也不依赖 feature 或 integration。

## 历史与生命周期

普通用户动作使用原生 `begin/end`，一次批量审阅只开一次事务。持续输入通过显式 group 合并；如果原生序列化状态已被另一个动作改变，就停止合并，避免吞掉别的节点操作。Undo/Redo 始终调用宿主历史，不通过一次新的表格编辑模拟撤销。撤销只恢复编辑投影，不调用任务取消、重提、状态回写等后端操作。

宿主扩展的 `beforeConfigureGraph` 和 `afterLoadGraph` 推进会话 epoch；activeWorkflow 对象变化推进 workflowSession。票据含 workflowSession、epoch、documentId、recordId、fieldId、requestId、inputVersion，并且只能由签发它的控制器实例使用。相同 requestId、复制的票据对象和旧节点对象均不能跨实例授权应用。节点移除、面板销毁和对应请求取消会释放票据。既有生成状态轮询与 LLM 面板定时同步随所属面板销毁；没有新增全局轮询器。

表格行票据比较整行输入、字段定义和表格元信息。其他行的编辑不使本行失效；纯列宽、显示隐藏、行高、密度和选择变化不计入该行输入版本。全表导入票据采用全表版本。相同内容被编辑后再撤销，也因 epoch/单调输入版本而拒绝旧回执。这里保留的是防止写回的边界，不能以此推断模型请求、计费、后端持久回执或恢复流程已经验收。

非组合输入状态的 Ctrl/Cmd+S 从表格、ScriptParser、LLM 及验收 fixture 根容器传给宿主。中文组合输入、229 边界键、文本框自身撤销和其余现有键盘处理保持原来的归属。

## 已验证与待验收

运行 `node --test tests/application/*.mjs` 验证事务分组、未知字段和稳定身份、跨实例票据、切工作流、撤销后旧回执、解绑/销毁、批量审阅和快捷键传播。产品函数测试直接运行提示词解析和 LLM 应用/撤销，使用合成结果，不调用模型。现有业务回归同时运行。

尚不能据此关闭 M1/M3 的真实 UI 门禁：需在重新构建的隔离 ComfyUI 中验证两个实例、中文组合/焦点/溢出、内容与原生模式、保存重开、缩放和视口，特别检查一次编辑的一步 Undo/Redo、Tab 后 Ctrl+S 以及跨工作流延迟结果。

## 生成与优化的实际任务接线

`bindBusinessHttp` 显式装配新 generation / optimization 路由；`bindGenerationHttp` 可显式绑定测试 namespace，乱序销毁不会复活已经释放的绑定。缺少提供方返回不可用，不回退到旧 LibTV 或云端执行。`DAELAB.LibTV.VideoGenerate` 的正式前端复用原生成面板，后端定义的 17 个输入、5 个输出不由前端重建。

表格与独立生成面板只在工作流保存 `studioGenerationRefs`：请求 ID、输入摘要、稳定文档/表格/节点/行/字段身份和模型引用。阶段、进度、错误、提供方任务 ID、回执均由 `GenerationSession` 读取 SQLite 的版本化报告，不写入可撤销工作流。同一次生成动作的引用与异步结果使用同一编辑分组；无其他编辑插入时合并为一个原生历史步骤，有其他编辑时不修改别人的历史。旧 `generationColumns` 保留只读，不能恢复旧执行通道。

结果应用同时校验控制器签发的票据、workflowSession / epoch、稳定目标、inputVersion、requestId、冻结输入摘要、账本版本与不可变素材回执。相同版本的“结果文件缺失”投影能撤销应用资格。切工作流、解绑、输入变化或 Undo 后的旧回执仅保留为任务事实，查询不会重新签发应用票据。显式“已有生成结果”审阅才可对相同输入重新签发票据。恢复只查询原 ID；对已取消任务选择“按当前输入重新生成”才创建新 ID。未知接受状态不能通过自动重发绕过。

`generation/status` 支持严格 documentId + tableId + nodeId 的只读发现，SQL 在分页前对文档和表格取交集，节点在返回前过滤；游标按扫描范围前进。空 scope、未知字段、混合 ID/scope 查询和非法分页均被拒绝。Undo 移除编辑引用或面板重建后可重新发现事实，但发现不会写工作流或自动应用。fixture namespace 另行检查整段 scope 只含 fixture 所有的任务。

表格优化保留既有 estimate/lease/submit/permit/advance/recover DTO。`OptimizationRevisions`、批次发现和实时建议只驻留会话；旧 properties.revisions/batches 不再更新。用户偏好通过原生编辑事务保存；应用时一次事务写文本与结果引用。估算和请求持有原生票据，优化回执还核对冻结 snapshotDigest 与稳定 target。Undo 只还原文本，不回退后端任务或使旧票据重新有效。

独立 Qwen 每行以预先固定的 requestId/sourceScope 提交，成功响应必须有匹配作用域与不可变 text receipt。未应用建议是会话投影，`ioResult` 旧内容只读保留；显式同意更改才写 `appliedIO`。工作流可保存请求引用，恢复按钮从所属 scope 读取原结果并重新审阅，不提交新任务。相同输入仍有未确定请求时，生成前检查会阻止再次提交。

新增离线合同测试位于 `tests/generation_frontend/`，实际调用表格任务控制器、优化控制器和独立 Qwen HTTP 适配器；覆盖晚到结果、工作流切换、Undo 不回退任务事实、回执错误、只读轮询、恢复不 submit 和 fixture 绑定释放。首次失败与后续日志保存在忽略目录 `.local/validation/generation-*`。这些测试和构建不证明真实提供方、GPU、浏览器或 M4 阶段验收通过；需要 root 在固定隔离构建中继续验证两个正式实例、保存重开、模式/焦点/缩放及显式 fake-provider 故障场景。

## 结果应用边界复审

本轮进一步修复三个真实边界：原生节点按所选素材 `provenance.requestId` 精确选择对应新回执，不以最新任务 B 代替用户选中的历史 A；显式审阅还要求不可变报告 `source.inputDigest` 等于当前输入摘要，修改工作流的引用摘要不能重标旧结果；`404 record_not_found` 仅表示暂未查到原身份，可能仍有原提交正在预检，不能据此重投或换 ID。用户可明确“封存原请求/原批次”；原子账本占位与正常准备竞争，只有身份、输入摘要和范围一致且 `cancelled`、`cancel_requested`、`attempt == 0` 的持久事实才允许新请求。已开始执行的正常事实不能被覆盖。数据库不可用和未知接受状态继续锁定。fixture 使用相同合同。

新格式有 `studioGenerationRefs` 标记却缺对应字段、缺 `provenance.requestId`、重复匹配或 scope/digest/媒体引用不一致时拒绝读出。没有该标记的旧格式只读验证其本地输出媒体，不将旧包任务 ID 当成新账本身份，也不恢复旧执行器。

宿主快照 `0cffc7` 的 429 首失败和已有两实例观察由 root 记录；该快照早于上述修复，不能作为最终结果应用或恢复通过证据。需要新的固定构建复验同一工作流。首失败证据保留在 `.local/baseline/generation-preflight429-first-ui.txt`、`generation-preflight429-recovery-first-ui.txt`、`generation-preflight429-first-failure.png`。

原子封存合同使用现有 JobLedger：明确准备拒绝保存不含原输入的不可执行 barrier；显式封存也能在原请求仍 await preflight 时抢先占有 requestId。占位与取消之间即便中断，pending barrier 也不能 dispatch/retry；只有完成取消后的事实携带 `replacementAllowed`。已经赢得正常提交的记录必须经原版本 CAS 取消；已领取执行的记录返回原事实，不提供替换许可。普通查询始终只读。

优化提交前通过一次原生事务写入 `table.meta.studioOptimizationRequests` 最小不可变引用（批次、范围、requestId、source、revision/requestSeq），不保存冻结 prompt、媒体、凭据、任务状态或结果快照。实际 composer 的“封存原批次”只发送这份身份引用，恢复期间及普通 404 都不改成其他批次。撤销仍只作用于文档，账本事实保持独立；恢复与封存不应用建议。新请求仍须重新估算并由用户明确开始。

2026-10-25 本轮只验证源码级竞态/合同与合成媒体测试；没有重建 `web`、刷新宿主或运行模型。旧 18a16/0cffc7 快照不能作为本轮封存路径验收证据，需统一构建后在实际两实例、重开、保存/重载与快捷键场景复验。
