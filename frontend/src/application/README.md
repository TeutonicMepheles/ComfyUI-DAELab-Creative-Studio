# 应用用例与编辑事务

将编辑控制器、资产服务和剪辑导出组合为可由宿主适配器绑定的用例。这里不拥有另一份可写工作流。

源码入口：document_controller.ts：同步编辑与异步票据；business_document.ts：原生读写闭包；asset_library_service.ts、asset_registration.ts：资产流程；media_export_service.ts：导出应用服务。

`table_model.mjs`、`table_editor.mjs` 是表格与提示词/生成列的组合入口；`table_content_view.mjs` 和 `table_reference_options.mjs` 组合富文本呈现及引用选项。基础表格不自行选择这些实现。

协作边界：通过 contracts 的端口访问宿主和后端。异步结果必须核对会话、文档、输入版本；撤销不能改变后端任务事实。

本目录的可编辑源位于 `frontend/src/application/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/application/business_document.test.mjs tests/application/prepared_document_edit.test.mjs tests/application/media_export.test.mjs
```


表格素材交换、工作台与面板组合集中在 table_asset_groups、table_exchange、table_material_columns、table_material_output、table_presentation、table_source_model、table_workbench。仅通过表格公开入口获取核心/视图；table_host_history 为相邻面板保留宿主历史桥接。独立装配示例见 [dev/table](../../../dev/table/README.md)。
