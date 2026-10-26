# 公共任务展示

根据业务提供的 task snapshot v1 显示任务胶囊、进度、等待时间和短暂终态通知。

源码入口：creative_tasks_model.mjs：过滤、排序和显示文本；creative_tasks.mjs：视图挂载；creative_tasks.css：状态样式。

协作边界：只消费快照；模型请求、取消、恢复和后端账本仍由任务所属功能控制。合同定义在 docs/task-contract.md。

本目录的可编辑源位于 `frontend/src/features/tasks/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_canvas/creative_tasks.test.mjs tests/migrated_business/table_generation_task_snapshots.test.mjs
```

