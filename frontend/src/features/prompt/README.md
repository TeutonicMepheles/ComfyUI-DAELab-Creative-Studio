# 提示词与 LLM 编辑

文本生成顶部可切换视频提示词和图片提示词，默认视频。用途随工作流保存，并与每行处理要求一同用于润色或图片反推。

图片反推从参考图的可见内容写起。图片用途描述单幅画面，视频用途按 Seedance 或 MiniMax H3 描述当前镜头。润色和反推分别保留各用途的处理要求草稿。镜头、动作和对白在文本节点整理；首尾帧的图片顺序和时间由生成节点提交时确定。

视频提示词在处理要求旁选择 Seedance（默认）或 MiniMax H3。切换时，处理要求框显示对应模型的模板；两个视频模型和图片用途分别保留编辑稿。生成时按当前任务提交框中显示的要求，包括该行连入的要求。图片提示词沿用原有的模板菜单。外部连线禁用内部正文编辑但保留草稿，断线恢复；空外部输入不回退草稿。模型来源胶囊读取共享目录的 provider。

多维表格保留唯一提示词列：已选列的表头按钮打开整列模型配置，不取消指定；删除当前提示词列前需先将其他文本列设为提示词。

负责表格提示词引用、模板、单格覆盖、优化请求、逐行结果审阅以及独立 LLM 面板。

源码入口：table_prompt_model.mjs、table_prompt_template.mjs：片段和展开；prompt_optimization_controller.mjs：请求与审阅；prompt_optimization_model.mjs：身份和输入戳；llm_io_panel.mjs：独立 LLM 交互。

协作边界：编辑通过原生文档控制器；模型运输通过绑定的业务端口。引用顺序、处理要求和上下文上限是请求合同的一部分。


只有列头指定为“提示词”的列可通过 `@` 引用其他列的文字；其他文本列仅提供素材引用，图片引用保持可用。切换提示词列后菜单随新指定更新，已有非法文字引用在展开时提示错误，不静默删改内容。

旧表格没有提示词列声明且仅有一列标量文本／一列图片时，保留原输入解析并遵守勾选状态；现代提示词列丢失或版本不支持时仍报错，不自动猜测。

“文本生成”节点读取多维表格指定的提示词列，仅处理勾选行并保持行序，展开文字引用。表格输入默认使用文字优化；PE 例外按行反推单张参考图，所有勾选行均须具备有效图片，即使只有一行也显示任务列表并输出文本组。多项输入可在顶部切换查看原文。向下游拖线会创建等待结果的文本框或批量素材组。点击生成后，单条结果写入等待框；批量结果按行序加入已连接的输出组。没有等待目标时由画布创建。重新生成按当前输入发起新请求，保留已完成的结果。

文本生成节点与表格优化复用模型列表，支持本地 Qwen、DeepSeek API、GPT-6 Luna（Comfy）。GPT 复用当前 Comfy 工作区登录，不要求 OpenAI 密钥；认证仅通过请求头传递，切换账户或工作区后旧凭据不能继续提交。两处 GPT 共用后端提供方和任务账本，独立节点仍逐项执行，完成后自动输出；图片反推沿用单图输入限制。

视频设置按模型能力显示全能参考和首尾帧。全能参考依据当前任务素材选择实际生成方式。打开旧配置不改写已保存的模式和素材。独立生成节点的参数摘要按文字宽度显示，空间不足时收缩。

本地 Qwen 图片尺寸复用 `table_prompt_settings.mjs` 的自动／可视化比例选择器，固定像素预设读取模型能力的 `config.imageSize`，不在前端另设一套数值。旧手工宽高保留，用户选择比例后才更新；自动模式在新任务预检时按冻结参考图解析。节点、单格及列默认配置使用相同控件。

Comfy GPT Image 设置展示官方尺寸、质量和背景选项；选择 Custom 后显示自定义宽高。参数摘要显示实际图片尺寸和质量，表格与独立生成节点共用设置数据。

本目录的可编辑源位于 `frontend/src/features/prompt/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/prompt_optimization_controller.test.mjs tests/migrated_business/prompt_optimization_history_review.test.mjs tests/migrated_business/table_prompt_template.test.mjs tests/generation_frontend/qwen_contract.test.mjs
```


表格组合经 application/table_model.mjs 和 table_editor.mjs；通用引用菜单与内联控件归 ui。提示词列保留结构化片段、模板及单格覆盖，服务只提供可审阅结果。尚无单独页面，可在 [表格预览](../../../../dev/table/README.md) 检查真实提示词组件；优化服务在该页不可用，不代表两 LLM 宿主验收。

Text model picker: llm_model_picker.ts adapts the existing native select through the shared generation settings popover; it preserves model IDs, availability and change events. B layout scrolls within text surfaces, hides the linked source editor and restores its draft on disconnect.
