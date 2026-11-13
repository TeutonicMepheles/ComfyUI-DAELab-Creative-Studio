# 模型提示词改写

独立文本节点由用户选择目标模型与处理强度；执行模型仍由原模型目录选择，Qwen3.8 27B 负责文字处理，不代表下游图片或视频已执行。新建默认 Qwen Image 保真整理。模板菜单只有 Qwen Image / MiniMax H3 × 保真整理 / 生成扩写四项。旧 Seedance、模板和自定义要求保持兼容，不自动升级已保存工作流。

## 输入与输出

`rewrite: {version: 1, strength: faithful|expand, task, duration?}` 随输入冻结进原任务账本及指纹。支持文生图、图片编辑、文生视频、首帧、首尾帧、尾帧、全能参考。首尾帧与尾帧必须提供实际目标时长；程序组装对齐首行。独立文本节点无法读取另一个生成节点的配置，用户须保持任务、素材编号与时长相符，不声称自动绑定。

系统规则、强度、目标任务与用户补充要求分开。保真整理不授权新增事实；生成扩写可决定构图、光线、材质及已有动作衔接，不擅自新增人物、关键事件、产品特征、对白或配乐。已有自定义要求保留；只有精确匹配旧内置默认时，切换新模板清除旧默认，避免中文与英文规则冲突。

模型返回 `{prompt, added_details, warnings}`；服务在形成不可变文本回执前校验 JSON、字段、引用及 MiniMax 章节。保真结果声明新增细节或校验失败时结束为失败，不应用、不自动重试。正文进入回执 `text`，新增细节与警告进入 `metadata.rewrite`。前端审阅后由原历史事务输出；恢复只读原账本，无新请求。更改输入、模板、任务、时长或模式使建议失效。模型报告并不能证明语义完全保真，需要用户审阅。表格优化的引用保护合同不变。

Qwen3.8 原生路径为文本输入，不暗中读取图片。图片编辑模板可整理文字编辑要求，但精确视觉判断需走支持参考图的 PE/反推路径；它目前只支持单图。选择模板不会切换执行模型，也不下载模型。

## 来源与项目取舍

- [Qwen 官方文生图改写](https://github.com/QwenLM/Qwen-Image-2.1/blob/main/prompt_rewrite/prompts/system_prompt_t2i.txt)：英文完成画面、位置、材质、光线及字样。项目采用简化适配，保真模式不采用官方主动填充所有留白策略，不强制 400–500 词；比例继续由生成配置管理。
- [Qwen 官方编辑改写](https://github.com/QwenLM/Qwen-Image-2.1/blob/main/prompt_rewrite/prompts/system_prompt_edit.txt)：操作指令、目标属性及非目标保持；不完整复制官方比例决策 JSON。
- [MiniMax 官方基础模式](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md)：三段正文、镜头、对白及模式专用对齐首行。
- [MiniMax 官方全能参考](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md)：六段、参考标签及英文描述。项目保留台词原语言；未指定声音使用 N/A，不主动创作配乐。确定的对齐行由程序组装。

上述链接是适配依据；新增 JSON 审阅封装、限制扩写和用户确认是项目合同，不是模型官方输出协议。

源码：`backend/providers/prompt_rewrite.py`、`frontend/src/features/prompt/rewrite_templates.ts`。验证范围见 [本次记录](../validation/PROMPT_REWRITE_20261113.md)。
