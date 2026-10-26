# 前端只读兼容规则

保留历史节点和未知字段的原始序列化数据，并提供明确的只读显示或转换边界。

源码入口：readonly_nodes.ts：旧节点快照合并、原生槽位验证与转换规则；宿主渲染接入位于 integrations/comfyui/compat_readonly.js。

协作边界：和后端 compat/ 的 schema 对齐；不能通过旧执行通道恢复已排除的生成能力。

本目录的可编辑源位于 `frontend/src/compat/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migration/readonly_nodes.test.mjs
```

