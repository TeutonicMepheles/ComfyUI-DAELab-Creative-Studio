# 素材组组织

管理素材组成员、排列、标题、颜色、序号、锁定及公开整组输出。

源码入口：material_group_model.mjs：纯分组规则；material_groups.mjs：组交互和成员协调；material_groups.css：布局与动画。

协作边界：组输出为有序公开素材快照；不借用另一节点的私有 DOM 或创建虚假的原生连线。组数据由原生工作流保存。

本目录的可编辑源位于 `frontend/src/features/groups/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_canvas/material_groups.test.mjs tests/migrated_canvas/mixed_group.test.mjs tests/migrated_canvas/material_projection_layout.test.mjs
```

