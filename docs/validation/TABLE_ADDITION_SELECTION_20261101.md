# 手动新增行列的选择行为

任务：Raft task #2。F：表格结构编辑；AC：手动新增或插入行不自动勾选，新增行列不选中新单元格；UC：追加、相对插入、已有选区、双实例、撤销重做。

修改 `features/table/table_structure.mjs`：手动新增行显式设为未勾选，移除新增行列后的单元格聚焦。保留已保存选择、初始行及上游同步的既有规则。

TC / EV（2026-11-01）：

- `dev/table/tests/structure-selection.spec.mjs` 覆盖追加和插入、既有选区、独立实例、两轮撤销重做及重新渲染；完整独立表格浏览器套件 9/9 通过。
- 结构、素材列及事务测试 30/30 通过；构建、类型、架构、资产校验和 diff 检查通过。
- 隔离 ComfyUI CPU 宿主 8351 中创建两个真实表格节点，经 DOM click 调用新增按钮处理器验证新行未勾选、新列无单元格选择、另一实例未变及工作流序列化重载。此检查不等同于物理鼠标命中验收。脚本与结果：`.local/selection-host-probe.mjs`、`.local/selection-host-result.json`、`.local/selection-host-pass.png`。
- 首次浏览器断言误将保留旧单元格焦点判为失败；修正为不得聚焦新增行，原选区断言保持不变。首次结果保存在 `.local/selection-fix-first/browser.json`。首次宿主强制鼠标点击未命中预期节点，后续 DOM click 仅证明处理器行为。

未覆盖：真实中文输入法、完整缩放与模式矩阵、人工验收。没有运行模型，也未替换用户已有服务快照；不构成 M6 或发布验收。
