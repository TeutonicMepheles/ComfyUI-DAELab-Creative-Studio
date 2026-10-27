# 文稿与分镜导入

将文稿解析及分镜表转换为可编辑结构，保留来源映射、字段身份和素材引用。

源码入口：script_parser_model.mjs、script_parser_panel.mjs：解析编辑；daelab_storyboard_model.mjs、daelab_storyboard_import.mjs：分镜规则；storyboard_import_assets.mjs：素材映射；storyboard_table_adapter.mjs：表格交换。

协作边界：后端提供解析数据，表格模块提供编辑容器；重新导入和字段映射不能静默覆盖用户修改或丢失未知数据。

本目录的可编辑源位于 `frontend/src/features/storyboard/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/script_parser.test.mjs tests/migrated_business/daelab_storyboard_import.test.mjs tests/migrated_business/storyboard_import_assets.test.mjs
```


尚无本模块独立预览入口。模型/合同用例可从上述命令单独运行；界面、模式与保存需在独立 ComfyUI 中检查。示例使用见 [Showcase](../../../../Showcase/README.md)，开发环境见 [开发指南](../../../../docs/DEVELOPMENT.md)。
