# 本地模型配置

表格编辑不需要模型。本仓库的真实模型验收限定为 `qwen3.5:9b-q4_K_M`、Qwen-Image-2.1 Turbo 和 MiniMax H3 FL / Ref；不自动下载替代模型，不以云端回退验证本次重构。界面列出其他配置项不代表本环境已经具备执行能力。

宿主从其 **user 目录**下的 `daelab/creative-studio/local-generation.json` 读取显式配置。文件缺失或 `enabled=false` 时不装配本地生成。配置字段的权威实现是 [local_generation.py](../backend/integrations/comfyui/local_generation.py)：

| 字段 | 要求 |
| --- | --- |
| `schemaVersion` | 整数 `1` |
| `enabled` | 布尔值 |
| `resourceLock` | 专用 `.lock` 文件的绝对路径；本地准入协调使用 |
| `modelBindings.image` | 可声明 `diffusion_models`、`text_encoders`、`mmproj`、`vae` |
| `modelBindings.video` | 可声明 `diffusion_models`、`text_encoders`、`video_vae`、`audio_vae`、`loras` |
| `modelBindings.video_reference` | H3 Ref 独立绑定 `diffusion_models`、`text_encoders`、`video_vae`、`audio_vae`；不使用 FL 加速 LoRA |
| 每个模型绑定 | 仅有 `name`、`path`、`sha256`；路径为绝对路径，哈希为 64 位小写十六进制；名称须与宿主解析结果一致 |
| `qwenBinding` | `manifestPath`、`installedManifestPath`、`blobsRoot`、`manifestSha256`、`blobs` |
| Qwen 的 `blobs` | 六个不重复角色：`model`、`projector`、`config`、`template`、`license`、`params`；每项含 `role`、正整数 `bytes`、`sha256` |

Qwen 使用本机 Ollama 回环接口 `127.0.0.1:11434`。注册清单、已安装清单和六个 blob 必须符合固定绑定；服务可连接不代表模型身份验证通过。原生图片/视频模型还会核对节点类型、文件哈希及 ComfyUI 解析到的实际路径。

本指南不提供虚构路径或通用哈希模板。为目标机器准备实际清单并重启独立宿主后，在设置界面重新读取模型选项；缺失节点、权重或哈希不匹配须先解决。配置中无需写入云端密钥。机器路径、清单和权重留在宿主 user 或本地数据目录，不提交源码仓库。

配置读取、能力查询和界面设置不等于推理验收。当前本地模型执行记录、首失败和未覆盖项见 [验证状态](validation/STATUS.md)。

本地文生图使用 Qwen-Image-2.1 Turbo；文生视频、首帧与首尾帧使用 MiniMax H3 FL；1–9 张图片参考使用独立的 MiniMax H3 Ref。Ref 的图片顺序保留为 `<Picture N>` 编号，当前不接入视频或音频参考。生成节点与多维表格共用这些提供方和任务服务。权重格式与名称来自显式绑定，不自动切换量化版本；图片 GGUF 编码器需要已安装的 `CLIPLoaderGGUF` 节点及匹配的 mmproj 文件。首次能力查询会校验模型文件哈希，界面最多等待 120 秒。

## LLM 优化

独立 LLM 节点和多维表格优化共用任务账本，支持上述本地 Qwen 和显式选择的 `deepseek-flash`。DeepSeek 使用宿主进程的 `DEEPSEEK_API_KEY`，也可在宿主 user 目录的 `daelab/creative-studio/deepseek.env` 中设置同名变量。表格优化还支持仅当前页面保存的密钥，请勿将密钥写入工作流或提交源码。

DeepSeek 表格优化先估算并确认美元预算，再逐行提交；服务器有配置不代表密钥有效或账户余额充足。请求固定发往官方 API，无自动重试、代理继承或模型回退；响应丢失会保留未知状态，恢复查询不会重新计费提交。独立节点可优化文字或使用用户选择的参考图反推。自动化测试采用模拟接口，真实云端调用需要另外授权。

Qwen 需要在启动 LLM 优化前运行已安装的本地 Ollama 服务；Studio 不自动下载模型或启动外部进程。只有通过清单及六个 blob 校验后才允许本地推理。

## Seedance（ComfyUI 账户）

生成节点通过已安装的官方 `ByteDance2TextToVideoNode`、`ByteDance2FirstLastFrameNode`、`ByteDance2ReferenceNodeV2` 接入 Seedance 2.5、2.0、2.0 Fast、2.0 Mini。启用 ComfyUI API 节点并登录 ComfyUI 账户（或配置其 API Key）后，重启服务、刷新页面即可读取模式；选项取自当前安装的官方节点，不依赖本地模型配置。实际生成使用 ComfyUI 账户积分。

宿主启动参数不能包含 `--offline` 或 `--disable-api-nodes`：这些参数会禁用官方积分节点，账户已登录且有余额也无法生成。隔离准备工具默认使用离线模式；仅在用户明确要求积分生成时，保存工作流、确认队列空闲后移除离线参数并重启隔离宿主。

支持文生视频、首帧、首尾帧和全能参考。图片／视频经冻结文件传入官方节点；全能参考按素材类型分别编号，结构化文字引用转换为 `Image N`／`Video N`。认证仅传入原生队列的敏感字段，不写入工作流或任务账本。

Seedance 参考图在提交前适配官方尺寸限制：宽高比 0.4–2.5、每边 300–6000 像素。超限图片等比缩放并居中补黑边，不裁剪；合规图片保持原文件字节。处理结果单独保存，原图及冻结输入不修改。此处理不改变视频素材。

排队中可取消；已发往云端的任务不能通过本地中断确认取消或退款，继续保留原任务记录。断线或宿主中断后结果不明时不自动重发。初始接线验证仅覆盖官方节点结构、请求和任务生命周期；后续授权真实推理范围见 [Comfy 积分验证](validation/COMFY_CREDITS_20261030.md)。

## MiniMax H3（ComfyUI 账户）

界面的 `Minimax H3` 接入官方 `MinimaxHailuo03TextToVideoNode`、`MinimaxHailuo03FirstLastFrameNode` 和 `MinimaxHailuo03ReferenceNode`，保留已有工作流模型名称，并在接口边界映射为官方 `MiniMax H3`。支持文生视频、首帧、首尾帧及图片／视频全能参考；模式和参数读取已安装节点的实际定义。与 Seedance 共用登录、文件冻结和任务恢复通道，取消及付费验证限制同上。

云端 H3 与 `MiniMax H3 FL（本地）` 分别路由；本地版仍只支持文生视频和图片首尾帧，不会自动回退到云端。

## GPT Image（ComfyUI 账户）

GPT Image 2、2.5 Flare、2.5 Sunburst 使用官方 `OpenAIGPTImageNodeV2`。支持文生图和最多 16 张图片参考，每个任务生成一张图片；尺寸、质量和背景选项读取已安装节点。参考顺序及结构化 `Image N` 引用保持一致，结果通过 `SaveImage` 写入宿主输出目录并由共享任务服务校验。认证与中断处理复用上述 ComfyUI 账户通道，不需要单独配置 OpenAI 密钥。
