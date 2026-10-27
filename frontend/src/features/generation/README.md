# 生成配置与任务会话

为表内和独立生成节点共用输入构造、设置、账本查询、恢复审阅和结果应用。

源码入口：table_generation_model.mjs：最终输入和配置；generation_session.ts：异步会话；table_generation_tasks.mjs：提交与恢复；video_tasks_panel.mjs：独立节点；task_snapshots.mjs：任务展示快照。

协作边界：后端 generation 服务拥有任务事实，前端仅保存引用和编辑输入。libtv_video_model.mjs 是保留格式/配置模型，不代表启用旧 LibTV 执行通道。

本目录的可编辑源位于 `frontend/src/features/generation/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/generation_frontend/session.test.mjs tests/generation_frontend/table_flow.test.mjs tests/migrated_business/generation_input_regression.test.mjs tests/migrated_business/table_generation_history.test.mjs
```


输入为编辑配置和稳定任务身份，输出为账本投影及经过文档票据批准的素材引用。表内外复用请求合同，模型能力由宿主绑定。尚无独立生成页面；[表格预览](../../../../dev/table/README.md) 提供真实设置界面和明确模拟结果，不调用模型。配置字段与真实验收见 [模型指南](../../../../docs/MODELS.md) 和 [状态](../../../../docs/validation/STATUS.md)。
