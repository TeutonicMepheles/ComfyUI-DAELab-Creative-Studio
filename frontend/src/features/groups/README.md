# 素材组组织

管理素材组成员、排列、标题、颜色、序号、锁定及公开整组输出。

源码入口：material_group_model.mjs：纯分组规则；material_groups.mjs：组交互和成员协调；material_groups.css：布局与动画。

协作边界：组输出为有序公开素材快照；不借用另一节点的私有 DOM 或创建虚假的原生连线。组数据由原生工作流保存。

选区与组工具栏提供图标加文字的保存、打组／解组入口。保存通过公共 `inputSnapshot` 和资产服务逐项收藏，组布局仍由工作流保存；解组保留成员、重新选中并使用宿主撤销。异步保存固定点击时的输入，报告部分失败，工作流切换后停止后续保存。

本目录的可编辑源位于 `frontend/src/features/groups/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_canvas/material_groups.test.mjs tests/migrated_canvas/mixed_group.test.mjs tests/migrated_canvas/material_projection_layout.test.mjs
```


尚无本模块独立预览入口。模型/合同用例可从上述命令单独运行；界面、模式与保存需在独立 ComfyUI 中检查。示例使用见 [Showcase](../../../../Showcase/README.md)，开发环境见 [开发指南](../../../../docs/DEVELOPMENT.md)。
