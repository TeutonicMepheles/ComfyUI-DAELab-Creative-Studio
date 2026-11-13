# 模型提示词改写 · 2026-11-13

基线 `origin/main 4254d95`，候选分支 `codex/prompt-model-rewrite-20261113`。前端指纹 `745ce21bc0543aef816268dba2dcd2b954d621d2e6306a920078496312275bee`。后端六个改动文件按路径排序并拼接路径与原始字节的 SHA-256：`01eb248fa380e6625d10092e8aa73b79b0248c008ce68d055709c0a90d449cfa`。

## 范围与追踪

本任务：按模型提供 Qwen Image / MiniMax H3 × 保真整理 / 生成扩写四项，排除新的 Seedance 模板，保留旧配置。功能对应 F-BIZ-017 / AC-BIZ-017-001、003 / UC-BIZ-007，涉及 TC-BIZ-021、046、048 的输入、账本及审阅子范围。本文不是上述完整 TC 或 M6 验收通过声明。

- `tests/generation/test_prompt_rewrite.py`：协议、模式、时长、引用、对白、JSON、失败无回执及持久账本恢复。
- `tests/generation/test_native_27b.py`：新 HTTP 字段到冻结原生图、JSON 系统规则和独立输出预算；旧图不变。
- `tests/migrated_business/rewrite_templates.test.mjs`：四项、旧要求保留、序列化、输入戳和传输/审阅元数据。
- `tests/migrated_business/llm_io_render_stability.test.mjs`：新结果先审阅再应用、输入变化使建议失效；旧恢复与历史回归。

## 自动检查

- `npm run check`：477 项通过、3 项跳过；业务前端 723 项通过。原始日志 `.local/check-delivery.log`。随后调整审阅文本区高度及放弃/失效的状态提示；21 项定向回归通过，日志 `.local/review-final.log`。重新构建并在最终指纹上执行两个真实宿主 UI 检查。
- `python -m unittest discover -s tests/generation -p 'test_*.py'`：172 项通过，日志 `.local/backend-final.log`；补充 HTTP/3072 预算断言后的 27B 定向 4 项通过，日志 `.local/native27b-final.log`。
- 文档链接与暂存 diff 检查在提交前执行。

## 隔离 ComfyUI

独立 CPU 宿主 8366：`.local/prompt-review-host2`。组合 CPU 宿主 8367：`.local/optional-prompt-review-complete`，ComfyTV 固定 `a5e0c16b5ca7f74b31293c2f940a704107e4a009`，只读归档。两者均使用独立 user/input/output/temp；8365 和 8000 未修改。

实际节点均创建两个 `DAELAB.LLMStylePreviewB`。Playwright 脚本 `.local/ui-acceptance.mjs` 使用明确的 HTTP 文本结果替身，拦截原生 `/prompt`，没有真实推理。检查四项选择、任务与时长、实例隔离、焦点、原文/新增细节审阅及同意输出、Mute/Active、保存 JSON 后刷新重开、图形/创作画布往返；图形在 1600×1100 与 1000×800、50%/100%/150% 下检查横向溢出，创作画布检查相同缩放的面板租借及宽度。

原始证据：`.local/ui-8366-complete.log`、`.local/ui-8367-complete.log`、`.local/8366-ui-evidence.json`、`.local/8367-ui-evidence.json`、各端口的 `rewrite-review.png` 和 `creative-canvas.png`。结果替身不证明真实 Qwen3.8 JSON 遵循、模型质量或 GPU 推理通过。

## 首次失败与修复

最初 CPU 启动用基础 Python，缺少 filelock，原日志保留在 `.local/prompt-review-host/logs/`；改用已有完整运行环境，未安装替代模型。首次 DOM 定向检查有 7 项失败，原因是测试的 footer 插入锚点被新审阅区覆盖；改用独立锚点后原有 17 项恢复通过。新测试首次发现严格可选属性不能显式赋 undefined、失败任务不含 receipt 字段；分别改为删除可选键及检查缺省字段。早期构建和日志保留，没有将早期指纹的 UI 结果计入最后候选。

## 限制

未运行真实 Qwen3.8、PE、图片或视频模型，也未提交付费请求；模型报告新增细节不是语义保真证明，需人工审阅。独立文本节点不自动读取下游生成设置；首尾帧时长及素材关系需要用户一致配置。Qwen3.8 路径仍为文字输入，视觉反推走已有单图 PE 路径。未合并、推送或替换 8365 副本，不构成发布。
