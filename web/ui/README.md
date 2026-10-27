# 共享交互控件

提供无业务依赖的按钮、字段、事件边界、面板 lease 和失焦历史守卫。

表格与提示词共用 `table_controls.mjs`、`list_editor_controls.mjs`、`inline_editor.mjs`、`reference_menu.mjs` 和 `material_thumbnail.mjs`。列引用选项由 application 提供；控件不查询生成服务或原生历史。

源码入口：creative_button.mjs：异步按钮状态；creative_field.mjs：草稿与提交；creative_events.mjs：键盘传播；creative_panel_context.mjs、creative_panel_state.mjs：借用与模式；unfocused_history_guard.ts：失焦撤销边界。

协作边界：业务通过回调传入能力；共享层不识别节点类型、模型、API 或业务字段。主题来自 design。

本目录的可编辑源位于 `frontend/src/ui/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_canvas/panel_keyboard.test.mjs tests/migrated_canvas/creative_panel_state.test.mjs tests/migrated_canvas/creative_panel_lease.test.mjs tests/migrated_business/unfocused_history_guard.test.mjs
```

