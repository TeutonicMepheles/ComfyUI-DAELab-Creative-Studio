# 四类本地生成入口验证

2026-10-29，基于 `fca1633` 的 `codex/local-generation-coverage` 候选，生成节点和多维表格分别完成文生图、文生视频、首尾帧视频和两图参考视频，共八条成功任务。Ref 接线是本次新增；原基线不能据此视为已支持。未合并到 main，未判定 M6 通过。

## 环境与指纹

隔离宿主 `127.0.0.1:8310`，独立 user/input/output/temp；未修改原 8000 工作流。RTX 5080 16 GB、约 96 GB RAM、ComfyUI 0.39.2、前端 1.53.10、PyTorch 2.8 + CUDA 12.9。Studio 单独安装，另加载现有 ComfyUI-GGUF；所有权重从现有本地目录读取并校验实际 SHA-256，无下载或云端生成。

现场前端 sourceFingerprint：`1fbbbbea83f4df232b402b804cc75d642655c6747258da24e82dba26fc868e42`。最终 backend/providers/native.py SHA-256：`ff36d38bfa0ad49e0e1afefc7156200e08e9c6bc57a16ecd535b3fc7e314ef90`；parameters.py：`d3b58ca91598a2cfead2918f29a226c92f8cce2699651ad6f89363643f8b0976`。真实生成后仅追加 Ref 隐藏不支持的 turbo 控件，重启后验证结果恢复；最终后端回归通过。

工作流 `Generation-Acceptance.json`，ID `12b38f6a-7719-4596-8b39-c59e7e652010`。节点 1–4 为生成节点，11–14 为四个独立表格。提示词为白色桌面上红球与蓝色方块，使用合成的两张参考图片。原始数据保存在忽略目录 `.local/generation-acceptance/`：`generation-evidence.json`、`native-history.json`、`media-validation.json`、`eight-results.jpg`、`reference-parameters.jpg`、`outputs-contact-sheet.jpg` 及 user 工作流和输出。

## 实际结果

| 需求 | 本地模型 | 生成节点任务 | 表格任务 | 结果 |
| --- | --- | --- | --- | --- |
| 文生图 | Qwen-Image-2.1 Turbo | 678ab24e-677a-4af3-ac61-2cb663b237f4 | dd66d12a-7408-46f7-b1c9-a4fc7366f831 | 两张 512×512 PNG |
| 文生视频 | MiniMax H3 FL | bc94bb4e-7dfa-4276-94cf-6adf2b4ccfca | 70755779-8098-4043-a7cc-62df5977baaf | 两个视频 |
| 首尾帧视频 | MiniMax H3 FL | 6dc8c16e-5f62-4550-82bb-f2981d0dd185 | 904bdbe3-b4b2-4317-8d05-3c3a5c177ef2 | 两个视频 |
| 两图参考视频 | MiniMax H3 Ref | 058f9bc0-30b8-4ffd-adfd-16f2b56f3f15 | 0da18c13-4a88-438e-9f48-0563a64a3098 | 两个视频 |

视频均为 512×288、39 帧、24 fps，带音轨；请求 1.5 秒按模型帧约束得到 1.625 秒。使用 20 步非 turbo。八条任务均从实际 UI 入口提交、账本成功、结果写回，保存并重开后每个入口保留一个结果和一个收据。相同请求内容可能复用 ComfyUI 原生缓存，不能作为八次独立质量试验。抽帧和浏览器播放已检查，不代表完整人工语义评分。

现有权重：Qwen 图像扩散 INT8、GGUF Q8_0 编码器及匹配 mmproj、Qwen VAE；H3 FL2VA 与 Ref2VA NVFP4、共享 Qwen3VL NVFP4/AWQ 文本编码器、H3 视频 VAE FP16 和音频 VAE FP32。无需新增权重；Ref 需要单独的 `modelBindings.video_reference` 配置，见 [模型配置](../MODELS.md)。

## 回归与边界

- `npm run check`：前端 382 通过、3 既有跳过；业务 566 通过；类型、构建、架构及资源检查通过。后端 generation 117 通过，配置 5 通过，host 35 通过。
- 实际多实例、参数焦点、缩放、面板边界、图形/创作画布切换、保存重开已检查；未重复全面 mute/bypass 和 App Mode 矩阵。
- `8311` 独立 CPU 宿主加载 Studio 与只读 ComfyTV，节点注册和浏览器入口正常。联合安装未重复 GPU 推理；该项仅是集成启动检查。
- 首次能力查询曾在 30 秒时限内超时，扩大到 120 秒用于大文件哈希校验；保留原日志和任务记录。原生已提交任务未自动重发。一次离屏视频占位状态在进入视口后正常加载，文件解码通过。
- Ref 接受 1–9 张图片；本轮真实测试为两张，边界拒绝及引用编号顺序由定向测试覆盖。视频/音频参考、Ref turbo、长视频、高分辨率和生产吞吐未验收。

本任务关联 F-BIZ-027/F-BIZ-028/F-BIZ-035、AC-BIZ-028-002、UC-BIZ-009/UC-BIZ-014、TC-BIZ-047 的媒体生成子集；现场证据记为 `EV-local-generation-20261029`，定位见上方忽略目录。未覆盖该 TC 的文本优化、图片反推、单首帧、峰值显存等全部要求，不将整个 TC 或累计门禁标为通过。Ref 是本次用户新增范围。
