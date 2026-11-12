# 本地模型配置

表格编辑不需要模型。本仓库的真实模型验收限定为 `qwen3.5:9b-q4_K_M`、Qwen-Image-2.1 Turbo 和 MiniMax H3 FL / Ref；不自动下载替代模型，不以云端回退验证本次重构。界面列出其他配置项不代表本环境已经具备执行能力。

宿主从其 **user 目录**下的 `daelab/creative-studio/local-generation.json` 读取显式配置。未配置的档位按 ComfyUI 的模型目录自动匹配，已有档位沿用显式绑定。`enabled=false` 关闭本地生成。配置字段的权威实现是 [local_generation.py](../backend/integrations/comfyui/local_generation.py)：

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

## 分发与新机接入

模型权重与每台机器的运行配置不随本仓库或 CC 安装包分发：

- **CC 安装包**（`Creative-Studio-local-test-*.zip`，约 17 MB）只含 `custom_nodes` 下的节点包，不含 ComfyUI 本体、torch、模型权重，也不含每台机器的 `local-generation.json`。
- **离线整包**（`D:\ShipComfy`，338.69 GiB / 45,568 文件）含全量模型权重与便携 Ollama，已全量校验（缺失 0、不匹配 0）。以 `--models-directory <SHIP>\03-models\ComfyUI\models` 让 ComfyUI 直接引用硬盘上的模型，不必搬运。

工作流 JSON 只保存稳定的逻辑模型 ID，不写机器路径或文件哈希，可跨机器复制；接收方装好 CC 包即可打开编辑，生成则需自备权重与配置。

接收方安装支持自动匹配的 Studio 后，将 MiniMax 主权重放在 `diffusion_models`、编码器放在 `text_encoders`、音频和视频 VAE 放在 `vae`、Flex 适配器放在 `loras`，重启即可按本机路径识别。自动匹配要求每个组件有唯一的同名候选且大小符合清单，整组齐全后才登记。匹配结果保存在内存中，可用性探测按字节数判断、不实算哈希，实际提交时按内容 SHA-256 兜底。需要显式指定模型时，可以通过以下方式生成配置：

1. 设置界面「扫描模型」按官方模型清单哈希反查生成（需宿主带此功能；清单见 [model_manifest.json](../backend/integrations/comfyui/model_manifest.json)，条目为 family/category/name/bytes/sha256，不含任何本机路径）；
2. 以现有配置为模板改路径：每条 `path` 改为该机绝对路径、`resourceLock` 改为该机 `.lock` 路径（`qwenBinding` 的 `manifestPath`/`installedManifestPath`/`blobsRoot` 同步）；`sha256` 是文件内容指纹、不是路径——文件相同则沿用原值，仅换量化/重新下载导致字节变化才重算（`certutil -hashfile <file> SHA256` 去空格转小写）；`manifestSha256` 与各绑定 `bytes` 是清单属性，不要动；
3. 手写最小配置（`schemaVersion:1` + `enabled:true` + `resourceLock` + `modelBindings`）。

生成后重启宿主并在设置界面重新读取；仍置灰则看 `GET /daelab/studio/capabilities` 的 `localGeneration.reason`。文本模型需本机 Ollama 服务已运行（Studio 不自动启动、不下载）；云端模型走 ComfyUI 账户登录，与本机配置无关。

配置读取、能力查询和界面设置不等于推理验收。当前本地模型执行记录、首失败和未覆盖项见 [验证状态](validation/STATUS.md)。

本地文生图使用 Qwen-Image-2.1 Turbo；文生视频、首帧与首尾帧使用 MiniMax H3 FL；1–9 张图片参考使用独立的 MiniMax H3 Ref。Ref 的图片顺序保留为 `<Picture N>` 编号，当前不接入视频或音频参考。生成节点与多维表格共用这些提供方和任务服务。权重格式与名称来自显式绑定，不自动切换量化版本；图片 GGUF 编码器需要已安装的 `CLIPLoaderGGUF` 节点及匹配的 mmproj 文件。清单档位查询时检查文件信息、节点及原生工作流，实际提交前核对权重 SHA-256。

## LLM 优化

GPT-6 Luna 在独立 LLM 节点和表格优化中均通过官方 `OpenAIChatNode` 对应的 Comfy Partner Responses 通道执行，使用当前 ComfyUI 工作区积分，不读取 OpenAI API Key。宿主须启用 API 节点并支持该模型；表格积分估算从官方 Partner Node Pricing 文档读取，实际用量来自原生响应头。独立节点支持文字优化与单图反推，两处均保留原请求身份、不自动重试计费 POST。新增接线采用模拟接口验证，不代表已执行付费验收。

独立 LLM 节点和多维表格优化共用任务账本，默认使用上述本地 Qwen 模型。2026-11-04 起移除 DeepSeek 云 API 文本通道，也不再读取宿主环境或 user 目录中的云密钥；Comfy 工作区积分的 GPT-6 Luna 通道保留，不读取 OpenAI 密钥，不因本次移除被关闭。

文本优化先确认范围再逐行提交，请求只发往本机 Qwen 服务；无自动重试、代理继承或模型回退；响应丢失会保留未知状态，恢复查询不会重新提交。独立节点可优化文字或使用用户选择的参考图反推。自动化测试使用本地服务或确定性替身，不发起云端请求。

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

本地还提供低配 int8 档位，与旧 profile 并列：

- 名称：`MiniMax H3 FL 低配（本地）`（首帧/图生视频）、`MiniMax H3 Ref 低配（本地）`（双图参考）；后续 BF16 档位按同一规则以“高配（本地）”命名。显示名只带档位与（本地），量化、步数、帧率放在模型信息里。
- 绑定：`video_base` / `video_reference_base` 两族，只在提供绑定时注册；provider 为 `local-h3-base`、`local-h3-reference-base`，加载链为 UNETLoader + CLIPLoader(type=minimax) + 视频/音频 VAE，条件节点分别为 `MiniMaxH3ImageToVideo` / `MiniMaxH3ReferenceToVideo`。
- 参数：20 步、`res_multistep`、`simple`、24fps，强制不加 Turbo LoRA（旧设置里的 `turbo:true` 对低配不生效）；界面时长仍为整数秒，2 秒按既有换算在执行层得到 56 帧。
- 兼容：旧 `MiniMax H3 FL（本地）` / `Ref（本地）` 是各自独立的旧 profile（主模型、量化、步数与 LoRA 各自读取原配置），保持不动；默认仍是旧条目，已保存工作流的选择不迁移、不改写。
- 缺失：绑定缺失或哈希不符时，该条目在画布内报“不可用＋原因”，不回退到旧 profile、云端或其它档位。

## GPT Image（ComfyUI 账户）

GPT Image 2、2.5 Flare、2.5 Sunburst 使用官方 `OpenAIGPTImageNodeV2`。支持文生图和最多 16 张图片参考，每个任务生成一张图片；尺寸、质量和背景选项读取已安装节点。参考顺序及结构化 `Image N` 引用保持一致，结果通过 `SaveImage` 写入宿主输出目录并由共享任务服务校验。认证与中断处理复用上述 ComfyUI 账户通道，不需要单独配置 OpenAI 密钥。

## 2026-11-03 参考图实测要求

来源：Raft #Comfy-Canvas-Studio:e62eb3ab。以下定义本轮验收，不代表已执行或通过；
参数交互以 [P-M13 尺寸规则](product/P-M13-model-provider-management.md) 为准。

- Qwen-Image-2.1 Turbo：通过生成节点完成一次含参考图的真实生成，记录点击提交、开始执行、
  结果返回、节点显示图片的时间及完整耗时。可观察时分别记录排队、模型加载和推理；
  无独立时间来源时注明未能拆分，不能用估算冒充实测。结果须能查看和保存，留存原输出及请求身份。
- MiniMax H3 Ref：从多维表格发起两条任务，每条至少两张参考图，经生成节点完成真实生成。
  核对每行提示词、参考图身份与顺序均正确传递，分别记录完成情况、耗时及输出；
  不能只测独立生成节点或只用一张参考图。
- 技术成功与效果评价分别记录。效果结合原参考图观察主体特征、场景/风格、提示词符合程度，
  视频补看时间连续性与明显变形；给出具体可见问题，不以无报错等同效果符合预期。
- 交付实际图片/视频及对应参考图、时间记录、逐任务结果和限制。失败先核对原请求，
  不盲目重提，不改用其他模型，不用模拟结果替代真实生成。
- 用户要求先完成 Astronomical-Exps 当前任务再运行占显存的 Comfy 生成，由 Cindy 协调放行；
  这是运行顺序要求，非撤回上述生成授权。代码、文档与不占 GPU 的检查可先完成。
