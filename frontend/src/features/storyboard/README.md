# 文稿与分镜导入

将文稿解析及分镜表转换为可编辑结构，保留来源映射、字段身份和素材引用。

源码入口：script_parser_model.mjs、script_parser_panel.mjs：解析编辑；daelab_storyboard_model.mjs、daelab_storyboard_import.mjs：分镜规则；storyboard_import_assets.mjs：素材映射；storyboard_table_adapter.mjs：表格交换。

`script_partitions.ts` 负责新剧本的四列投影、源表／章节分组、无章节每页 10 行和修订合并；原生批次提交由 `integrations/comfyui/business/script_parser.js` 的 `createScriptBatchImport` 通过文档控制器写入同一宿主历史步骤。批次任一表在读取期间发生编辑，旧解析结果拒绝提交。

导入默认创建镜号/序号、画面描述、画面参考、备注四列，并指定画面描述为提示词列。源表身份独立，不跨表合并；有明确标题／章节标识的源表保持整章，无章节时每个源表分别按 10 行分页。标题保留原文，缺失时显示「表 N」，并显示来源表、页和行数；折叠只改变视图。落表后使用标准多维表格的编辑能力与 500 行/64 列上限，可增删改行列、更换提示词列及输出文字、图片、视频素材。历史 `fixed-four` 标记仅识别导入模板，不再限制编辑。章节以源表和标题/原始行位置区分，同名章节不合并，参考图保留出现顺序与实例身份。旁白等非展示字段和原文保存在导入详情。追加按来源去重；修订保留手改和已删除/改型字段，无法直接写回的字段记录冲突；新页重新使用默认布局，不复制用户改过的列结构。空出的旧页保留节点及连接。旧版非模板表不自动转换，显式转换仍保留原表备份。

协作边界：后端提供解析数据，表格模块提供编辑容器；重新导入和字段映射不能静默覆盖用户修改或丢失未知数据。

解析表复用共享编辑器、右键菜单、素材填充和输出协议，不另设编辑菜单。指针打开菜单不自动聚焦项目，AI 优化使用普通菜单项；键盘菜单保留焦点与导航。导入问题提示及处置流程本轮不变。

本目录的可编辑源位于 `frontend/src/features/storyboard/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/script_parser.test.mjs tests/migrated_business/daelab_storyboard_import.test.mjs tests/migrated_business/storyboard_import_assets.test.mjs
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/script_partitions.test.mjs tests/migrated_business/script_partition_host.test.mjs
```


尚无本模块独立预览入口。模型/合同用例可从上述命令单独运行；界面、模式与保存需在独立 ComfyUI 中检查。示例使用见 [Showcase](../../../../Showcase/README.md)，开发环境见 [开发指南](../../../../docs/DEVELOPMENT.md)。
