# 架构与合同

- `OWNERSHIP.md`：模块依赖与数据所有权。
- `EDITING.md`：原生工作流、文档控制器、事务与异步结果。
- `JOBS_ASSETS.md`、`ASSET_REGISTRATION.md`：任务账本、资产身份、结果验证。
- `LOCAL_GENERATION.md`：本地提供方、执行与资源准入。
- `FRONTEND_INTERACTION.md`：按任务选择相关 UI 章节及真实宿主验收。
- `CONTRIBUTING_CONTROLS.md`：共享控件和生命周期。
- `FRONTEND_IMPLEMENTATION_AUDIT.md`：历史实现核对与差异，不等于当前全量通过。

改合同先核对其生产实现和调用方；依赖检查运行 `node tools/check_architecture.mjs`，实际行为测试由拥有模块的 README 指定。
