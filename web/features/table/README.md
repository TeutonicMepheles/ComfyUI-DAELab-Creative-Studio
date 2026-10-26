# 结构化表格编辑

拥有记录、字段、单元格编辑、选择、结构修改、素材单元格以及工作台视图。

源码入口：data_table_model.mjs：数据结构；data_table_editor.mjs：编辑事务；table_inline_editor.mjs：输入边界；table_structure.mjs：行列操作；table_material_columns.mjs、table_exchange.mjs：素材和公开交换。

协作边界：原生工作流是表数据保存依据；默认素材/提示词/生成列与三行、500 行和 64 列上限保持。生成和优化功能经各自控制器接入。

本目录的可编辑源位于 `frontend/src/features/table/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/data_table.test.mjs tests/migrated_business/table_structure.test.mjs tests/migrated_business/table_inline_tab_boundary.test.mjs tests/migrated_business/table_transaction_serialization.test.mjs
```

