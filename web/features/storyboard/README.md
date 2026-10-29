# 文稿与分镜导入

将文稿解析及分镜表转换为可编辑结构，保留来源映射、字段身份和素材引用。

源码入口：script_parser_model.mjs、script_parser_panel.mjs：解析编辑；daelab_storyboard_model.mjs、daelab_storyboard_import.mjs：分镜规则；storyboard_import_assets.mjs：素材映射；storyboard_table_adapter.mjs：表格交换。

`script_partitions.ts` 负责新剧本的四列投影、章节来源分组、每表 10 行和修订合并；原生批次提交由 `integrations/comfyui/business/script_parser.js` 的 `createScriptBatchImport` 通过文档控制器写入同一宿主历史步骤。批次任一表在读取期间发生编辑，旧解析结果拒绝提交。

新表固定为镜号/序号、画面描述、画面参考、备注；画面描述复用提示词编辑器。章节以标题/原始行位置区分，同名章节不合并，参考图保留出现顺序与实例身份。旁白等非展示字段和原文保存在导入详情。追加按来源去重，修订保留手改单元格；空出的旧页保留节点及连接。旧表打开不自动转换，现有导入菜单提供“按四列与章节拆表”，转换前完整表格保留供核对；无法安全迁移的旧提示词引用拒绝转换。普通多维表格的容量不受此限制影响。

协作边界：后端提供解析数据，表格模块提供编辑容器；重新导入和字段映射不能静默覆盖用户修改或丢失未知数据。

本目录的可编辑源位于 `frontend/src/features/storyboard/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/script_parser.test.mjs tests/migrated_business/daelab_storyboard_import.test.mjs tests/migrated_business/storyboard_import_assets.test.mjs
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/script_partitions.test.mjs tests/migrated_business/script_partition_host.test.mjs
```


尚无本模块独立预览入口。模型/合同用例可从上述命令单独运行；界面、模式与保存需在独立 ComfyUI 中检查。示例使用见 [Showcase](../../../Showcase/README.md)，开发环境见 [开发指南](../../../docs/DEVELOPMENT.md)。
