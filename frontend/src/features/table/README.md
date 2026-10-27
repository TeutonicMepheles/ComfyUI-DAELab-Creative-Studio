# 结构化表格编辑

拥有记录、字段、单元格编辑、选择、结构修改、素材单元格以及工作台视图。

公共模型入口为 `index.ts` 的 `createTableModel(extensions)`，类型见 `contracts.ts`。基础模型通过实例参数接收列格式扩展；原生文档端口复用 `NativeDocumentPort<TableData>`。

`application/table_model.mjs` 装配现有提示词格式，`application/table_editor.mjs` 装配编辑器的提示词表头、生成历史和内容呈现。`data_table_model.mjs`、`data_table_editor.mjs` 为兼容转发，不维护第二套实现。`editor_runtime.mjs` 拥有编辑事务和视图；共享按钮、引用菜单、内联编辑和素材缩略图已归 `ui/`。

尚无独立预览命令。面板宿主能力注入和其余旧入口迁移属于 T2–T4；当前类型/模型测试不代表真实 ComfyUI 验收。

协作边界：原生工作流是表数据保存依据；默认素材/提示词/生成列与三行、500 行和 64 列上限保持。生成和优化功能经各自控制器接入。

本目录的可编辑源位于 `frontend/src/features/table/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/data_table.test.mjs tests/migrated_business/table_structure.test.mjs tests/migrated_business/table_inline_tab_boundary.test.mjs tests/migrated_business/table_transaction_serialization.test.mjs
```

