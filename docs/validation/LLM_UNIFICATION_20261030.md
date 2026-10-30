# GPT 优化入口统一 · 2026-10-30

独立 LLM 节点和表格优化共享 GPT-6 Luna 模型、Comfy 工作区认证及文本提供方。新增宿主绑定原先未装配的业务认证端口，凭据只在请求头及请求上下文存在。文本优化和单图反推沿用输入身份、审阅应用及任务账本；原生计费 POST 禁止自动重试，响应 ID 可用于原请求查询。

验证范围：前端 399 项通过、3 项跳过，业务 598 项通过；新增共享登录测试另外 2 项通过。后端生成 131 项、单元 16 项、宿主隔离与组合布局 35 项通过。安装中的官方请求模型校验通过；公开官方文档积分价格可读取。这些是模拟传输、静态和只读能力验证，没有提交 GPT 付费请求。

生成回归首轮暴露批量调度顺序可能被异步账本读取改变：第二、三项偶发逆序。共享服务现为同次提交保存前驱任务顺序，取消等待项不取消运行中的前驱；三任务队列检查随后通过。首失败保留在 `.local/gpt-unify-generation-first.log`。其余证据为 `.local/gpt-unify-generation.log`、`gpt-unify-frontend-final.log`、`gpt-unify-business-final.log`、`gpt-unify-auth-final.log`、`gpt-unify-unit.log`、`gpt-unify-host.log`。

修复已复制到 8340 隔离实例，等待用户队列结束并重启。两 LLM 实例、焦点与溢出、模式往返、保存重载和缩放矩阵尚未完成，不作为产品验收通过。原生 8000 未修改。

对应检查入口：`tests/generation/test_comfy_text.py`、`tests/generation_frontend/qwen_contract.test.mjs`、`tests/migrated_business/comfy_submission_auth.test.mjs`；行为合同见 [提示词模块](../../frontend/src/features/prompt/README.md) 与 [模型指南](../MODELS.md#llm-优化)。
