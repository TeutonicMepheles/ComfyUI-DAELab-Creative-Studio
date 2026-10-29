# 提示词与 LLM 编辑

多维表格保留唯一提示词列：已选列的表头按钮打开整列模型配置，不取消指定；删除当前提示词列前需先将其他文本列设为提示词。

负责表格提示词引用、模板、单格覆盖、优化请求、逐行结果审阅以及独立 LLM 面板。

源码入口：table_prompt_model.mjs、table_prompt_template.mjs：片段和展开；prompt_optimization_controller.mjs：请求与审阅；prompt_optimization_model.mjs：身份和输入戳；llm_io_panel.mjs：独立 LLM 交互。

协作边界：编辑通过原生文档控制器；模型运输通过绑定的业务端口。引用顺序、处理要求和上下文上限是请求合同的一部分。

只有列头指定为“提示词”的列可通过 `@` 引用其他列的文字；其他文本列仅提供素材引用，图片引用保持可用。切换提示词列后菜单随新指定更新，已有非法文字引用在展开时提示错误，不静默删改内容。

旧表格没有提示词列声明且仅有一列标量文本／一列图片时，保留原输入解析并遵守勾选状态；现代提示词列丢失或版本不支持时仍报错，不自动猜测。

LLM 优化节点读取多维表格指定的提示词列，仅处理勾选行并保持行序，展开文字引用。表格输入禁用图片反推，即使只有一行也显示任务列表并输出文本组。多项输入在顶部切换查看各行原文与优化结果；生成操作按顺序处理全部输入。确认批量结果后创建一个包含各行文本节点的素材组，也可从输出端再次导出。单个任务保留直接输入和连线输入，确认后输出单个文本节点；单图片输入仍可反推。未确认或输入已变化的结果不能导出。

视频设置中的多图与混合参考统一显示为“全能参考”；模型支持混合参考时合并为混合模式选项，否则保留其声明的多图模式。打开旧配置不改写已保存的模式和素材。独立生成节点的参数摘要按文字宽度显示，空间不足时收缩。

本目录的可编辑源位于 `frontend/src/features/prompt/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/prompt_optimization_controller.test.mjs tests/migrated_business/prompt_optimization_history_review.test.mjs tests/migrated_business/table_prompt_template.test.mjs tests/generation_frontend/qwen_contract.test.mjs
```


表格组合经 application/table_model.mjs 和 table_editor.mjs；通用引用菜单与内联控件归 ui。提示词列保留结构化片段、模板及单格覆盖，服务只提供可审阅结果。尚无单独页面，可在 [表格预览](../../../../dev/table/README.md) 检查真实提示词组件；优化服务在该页不可用，不代表两 LLM 宿主验收。
