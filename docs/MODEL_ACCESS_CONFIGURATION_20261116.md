# 模型接入模块配置表

核对日期：2026-11-16；代码基线：`47e597d`。本表落实 AIGC-1113-02 的现状盘点，覆盖当前目录的 18 个逻辑模型／档位，包含输入、参数、输出、调用映射和剩余事项。本轮仅补文档，不新增模型、修改路由或执行推理。可筛选副本见 [CSV](MODEL_ACCESS_CONFIGURATION_20261116.csv)；本文件为字段解释与状态依据。

## 状态与填写规则

- **已实现**：代码已有对应路径；不表示本机已安装、当前可用或所有模式实测通过。
- **字段待补**：需补充目标宿主能力快照、供应商资料或许可证依据；未知值不猜测。“宿主动态”说明已有读取机制，不等于该机制待开发。
- **能力待开发**：会议目标尚无完整实现；本表只登记，不承诺本轮开发。
- **历史验收**：引用原日期、模型和场景；不自动适用于当前提交或同族其他量化档位。本轮没有新增模型效果验收。

`kind` 为输出类型 `image/video/text/3d`。本地／API 是实际执行路由；`access=open/closed` 是开放属性，二者独立。当前目录只有 `provider` 等信息，没有 18 项统一的 `access/environments` 策略；所有项的开放属性均先标“待核实许可证／供应商依据”。不得把本地推断为 open，或把 API 推断为 closed。

会议要求 local 仅 open、external 可 open+closed；目前应分别记录“现有运行条件”和“待实现的策略”，不能把会议规则写成程序已强制执行。纯内网可运行本地路径的前提是依赖、权重及 Ollama 已部署；API 路径需要外部服务连通及 ComfyUI 账户授权，不能写成离线可用。

## 18 项模型总表

下列 ID 保持代码原值，云端 `Minimax H3` 的大小写也不改。参数组定义在后文；同组共享字段，不代表各模型的宿主选项、默认值或验收结果相同。

| 编号 | 逻辑模型 ID | kind／路由 | 执行 provider／配置 family 或 API model | 参数组 | 实现及字段状态 |
| --- | --- | --- | --- | --- | --- |
| I01 | Qwen-Image-2.1 Turbo（本地） | image／local | `local-qwen-image`；`image` | LI | 已实现；4 组件绑定；许可证及目标机安装状态待补 |
| I02 | Qwen-Image-2.1（本地） | image／local | `local-qwen-image-base`；`image_base` | LI | 已实现；3 组件绑定，25 步；许可证及目标机状态待补 |
| I03 | GPT Image 2 | image／API | `comfy-gpt-image`；`gpt-image-2` | CI | 已实现；宿主参数枚举／范围／默认值快照待补 |
| I04 | GPT Image 2.5 Flare | image／API | `comfy-gpt-image`；`gpt-image-2.5-flare` | CI | 已实现；同组字段逐模型读取，快照待补 |
| I05 | GPT Image 2.5 Sunburst | image／API | `comfy-gpt-image`；`gpt-image-2.5-sunburst` | CI | 已实现；同组字段逐模型读取，快照待补 |
| V01 | Seedance 2.5 | video／API | `comfy-seedance`；`Seedance 2.5` | CV | 已实现；各模式能力、范围及参考上限快照待补 |
| V02 | Seedance 2.0 | video／API | `comfy-seedance`；`Seedance 2.0` | CV | 已实现；同组字段逐模型／模式读取，快照待补 |
| V03 | Seedance 2.0 Fast | video／API | `comfy-seedance`；`Seedance 2.0 Fast` | CV | 已实现；同组字段逐模型／模式读取，快照待补 |
| V04 | Seedance 2.0 Mini | video／API | `comfy-seedance`；`Seedance 2.0 Mini` | CV | 已实现；同组字段逐模型／模式读取，快照待补 |
| V05 | Minimax H3 | video／API | `comfy-minimax`；`MiniMax H3` | CV | 已实现；不与本地档位混用，宿主快照待补 |
| V06 | MiniMax H3 FL 低配（本地） | video／local | `local-h3-base`；`video_base` | LF | 已实现；INT8 主模型／视频 VAE，必需 FL Flex LoRA |
| V07 | MiniMax H3 Ref 低配（本地） | video／local | `local-h3-reference-base`；`video_reference_base` | LR | 已实现；1–9 图，INT8 主模型／视频 VAE，必需 Ref Flex LoRA |
| V08 | MiniMax H3 FL 高配（本地） | video／local | `local-h3-high`；`video_high` | LF | 已实现；BF16 主模型／FP16 视频 VAE，必需 FL Flex LoRA |
| V09 | MiniMax H3 Ref 高配（本地） | video／local | `local-h3-reference-high`；`video_reference_high` | LR | 已实现；1–9 图，BF16 主模型／FP16 视频 VAE，必需 Ref Flex LoRA |
| T01 | qwen3.8-27b-w4a8 | text／local | `local-qwen-27b-text`；`text_27b` | T27 | 已实现；独立文本润色，禁止图像输入；不是表格单元格优化提供方 |
| T02 | qwen-image-2.1-pe | text／local | `local-qwen-pe-text`；`text_pe` | TPE | 已实现；逐请求一张图反推；不是纯文本润色提供方 |
| T03 | qwen3.5:9b-q4_K_M | text／local | `local-qwen-text`；`qwenBinding` | TO | 后端／目录已实现；独立文本面板过滤此项并将旧选择映射为 T01，不是该面板的当前可选项 |
| T04 | gpt-6-luna | text／API | `comfy-gpt-text`；`gpt-6-luna` | CT | 已实现；官方 Comfy Responses；不是独立 OpenAI Key 通道 |

身份来源：[前端目录](../frontend/src/features/models/model_catalog.mjs)、[后端路由](../backend/generation/service.py)、[本地装配](../backend/generation/assembly.py)、[宿主装配](../backend/integrations/comfyui/local_generation.py)。前端目录的 provider 为 `local/qwen/comfy` 路由元数据；上表 provider 为后端执行提供方，不能混成同一字段。

## 公共输入与输出

| 字段／控件 | 当前值与限制 | 调用或持久化映射 | 状态 |
| --- | --- | --- | --- |
| 模型选择／单选 | 保存上表逻辑 ID；可用性取能力探测 | 生成 `config.model`；文本 `model`，表格文本 `optimization.model` | 已实现；可见性还受面板过滤，不等于目录全部可选 |
| 提示词／多行与引用编辑 | 生成编译后非空，最多 100000 字符；结构化引用保留顺序 | 生成 `segments`；文本 `source/instruction` 或 `optimization` | 已实现；文本限制见各组 |
| 本地文件、Slot、素材组／表格 | 先冻结可核验素材，再按模型模式筛选；接上参考素材不等于自动绑定角色 | 生成 `media` 与冻结输入；文本按模式读取单图 | 已实现；类型／数量见各组 |
| 抽卡／次数选择 | 图片／视频共享生成配置 `attempts`，整数 1–4，默认 1；入口须由调用方开启 `allowAttempts`，独立节点非批量时开启 | 按具体记录提交时拆为独立任务；整列提交路径 `recordId=null` 的 attemptCount 固定 1；GPT Image 每任务 `n=1` | 已实现但不等于所有入口都展示／执行同样次数；会议图片上限 4 不改成供应商批量 `n=4`，文本无此字段 |
| 生成按钮／任务状态 | 配置通过后提交；未知结果不自动重发 | 共用任务账本、request ID、冻结配置和结果身份 | 已实现；供应商取消／查询能力不同 |
| 图片／视频输出 | 单任务写入宿主文件并校验，再由面板／表格消费；批量按任务和类型形成素材组 | 本地及 API 图像 `SaveImage`；视频 `SaveVideo` | 已实现；输出尺寸和时长为实际结果，不用参数估算替代 |
| 文本输出 | 返回完整正文／建议，审阅后应用；保留来源与任务身份 | provider `Observation.text`；本地原生文本另保留 raw/final/token 信息 | 已实现；不是未经确认直接覆盖原文 |

源码：[生成配置](../frontend/src/features/generation/table_generation_model.mjs)、[参数入口](../frontend/src/features/generation/table_generation_panel.mjs)、[输入角色](../frontend/src/features/generation/generation_input.ts)、[文本面板](../frontend/src/features/prompt/llm_io_panel.mjs)。

## 图片参数

| 组／字段 | 输入与控件 | 默认、范围与条件 | 原生／API 字段映射 |
| --- | --- | --- | --- |
| LI／模式 | 文生图或单图编辑选择 | `text2image` 0 图；`image2image` 恰好 1 图，且需 LoadImage/ImageScale 节点 | `config.mode`；参考图 `LoadImage.image` → ImageScale → `TextEncodeQwenImage21.images.image_1` |
| LI／比例 | 自动／可视化单选 | `auto`、1:1、16:9、9:16、4:3、3:4、3:2、2:3；auto 有参考图取其比例，无图取 1024 方图；无法读取图像尺寸则拒绝 | `settings.ratio` → `image_dimensions()` → width/height；旧显式宽高保留 |
| LI／宽高 | 新界面比例控件；保留旧显式值 | 默认 1024×1024；每边 256–2048、32 倍数；总像素 ≤2097152 | `EmptyLatentImage.width/height`；有图时 ImageScale 及编码潜空间 |
| LI／种子 | 高级整数参数 | 默认 -1 随机；-1–9007199254740991；提交时冻结随机值 | `KSampler.seed` |
| LI／固定采样 | 非自由参数控件 | I01 8 步，I02 25 步；CFG=1、euler/simple、batch_size=1 | `KSampler`；I01 CLIPLoaderGGUF，I02 CLIPLoader；负提示词固定空 |
| CI／模式及参考 | 文生图／图生图；图片选择 | 文生图 0 图，图生图 1–16 图；不接视频 | `OpenAIGPTImageNodeV2`，`prompt`；`model.images.image_1` 起逐图映射 |
| CI／模型 | 模型单选 | I03–I05 的真实 API model 见总表 | `model`；不凭显示名拼接字段 |
| CI／尺寸、质量、背景 | 由 schema 决定选择器／数值控件 | `size/quality/background/custom_width/custom_height` 的枚举、default/min/max/step 来自宿主官方节点；尚未冻结目标宿主数值 | `settings.<name>` → `model.<name>`；自定义宽高字段仅在宿主声明时存在 |
| CI／数量、种子、输出 | 应用层次数；种子不另设供应商控件 | `n=1`；种子由 request ID SHA-256 前 8 位按 2147483648 取模 | `n`、`seed`；输出 `SaveImage`，每任务一张 |

LI 已实现上述字段；待补的是逐组件开放属性、目标机器安装／探测及当前模式验收。CI 已实现节点 schema 读取和字段映射；每个模型的实际选项快照、宿主版本和供应商字段说明待补，不将版本相关数值写死。

来源：[本地参数](../backend/providers/parameters.py)、[尺寸换算](../backend/providers/image_dimensions.py)、[本地能力](../backend/providers/native.py)、[Comfy 图片](../backend/providers/comfy_image.py)。

## 视频参数

| 组／字段 | 输入与控件 | 默认、范围与条件 | 原生／API 字段映射 |
| --- | --- | --- | --- |
| LF／模式 | 文本或首尾帧角色选择 | `text2video` 0 图；`singleImage2video` 首帧 1 图；`lastImage2video` 尾帧 1 图；`frames2video` 2 图；后端声明与构图已实现，具体 UI 可见模式由面板归一化 | `MiniMaxH3ImageToVideo`；`first_frame/last_frame`；不能把 Ref 图片当首尾帧 |
| LR／模式 | 多图参考选择 | `image2video` 1–9 张图片，顺序保留；不接视频／音频参考 | `MiniMaxH3ReferenceToVideo`；`ref_images.ref_image_0` 起；提示词引用转换为 `<Picture N>` |
| LF/LR／宽高 | 共享尺寸／比例界面及旧显式值 | 默认 512×288；能力 schema 每边 32–16384、step=32；后端数值校验仅检查整数范围，未强制 32 倍数 | condition 的 `width/height`；这是已发现的校验差异，不假装上下层完全一致 |
| LF/LR／时长 | 秒数选择，旧小数值保留 | 后端默认 2，允许 0.2–15 秒；UI 整数档不等于后端禁止小数 | `length=max(5,round(duration×24))`，再向上对齐到 `length % 17 == 5`；fps=24，实际秒数可与请求不同 |
| LF/LR／种子 | 高级参数 | 默认 -1；范围同 LI，冻结后复用 | `RandomNoise.noise_seed` |
| LF/LR／采样和声音 | 档位固定，无额外 Turbo 开关 | 四个当前档位都是必需匹配 Flex、strength=1、LCM 6 区间、固定 ManualSigmas；音视频构图已接线，无统一关音频参数 | `LoraLoaderModelOnly`、`KSamplerSelect`、`ManualSigmas`、`CreateVideo.audio`；不能写成旧 8 步 Turbo |
| CV／模式 | 按宿主能力的模式选择 | 适配器支持文生、首帧、首尾帧、全能参考；实际只提供宿主声明模式；全能参考需至少一个图片／视频，不接音频参考 | Seedance：ByteDance2TextToVideoNode / ByteDance2FirstLastFrameNode / ByteDance2ReferenceNodeV2；H3：MinimaxHailuo03TextToVideoNode / MinimaxHailuo03FirstLastFrameNode / MinimaxHailuo03ReferenceNode |
| CV／参考数量 | 帧选择或全能参考素材 | 首帧恰好 1 图，首尾帧恰好 2 图；全能参考图／视频各自上限读宿主 template.names；待逐模型记录 | 首尾帧 `first_frame/last_frame`；参考 `model.reference_images.image_N`、`model.reference_videos.video_N`；文字引用转 Image N / Video N |
| CV／提示词、种子、水印 | 文本及内部固定项 | seed 从 request ID 派生；watermark=false；首尾帧模式拒绝正文素材引用 | `model.prompt`、`seed`、`watermark` |
| CV／比例、分辨率、时长、声音 | 模式相关的选择／数值／开关 | ratio/resolution/duration 的 default/min/max/step/enum 来自宿主；若存在 generate_audio，适配器默认 true，on/off 转布尔；字段不存在不补造 | `settings.ratio/resolution/duration` → `model.<name>`；`settings.enableSound` → `model.generate_audio` |
| CV／其他官方选项 | 当前构图读取默认或已有设置，不全部暴露为普通 UI 控件 | output_format/task_type/auto_downscale/auto_upscale 仅宿主存在时传入；具体范围待补 | `model.output_format/task_type/auto_downscale/auto_upscale` |
| CV／Seedance 参考图适配 | 冻结后的独立图片副本 | 每边 300–6000，比例 0.4–2.5；超限等比缩放补黑边，不改原图；不是所有模型通用规则 | [stage_seedance_input](../backend/integrations/comfyui/comfy_video.py)；视频不走此图片处理 |

LF/LR 来源：[本地能力](../backend/providers/native.py)、[Flex 档位](../backend/providers/high_video.py)、[原生图](../backend/providers/parameters.py)。CV 来源：[视频适配器](../backend/providers/comfy_video.py)。全部通过宿主 SaveVideo 输出；CV 请求取消不保证供应商已停止或退款。

## 文本参数

| 组 | 输入与界面范围 | 参数／默认与限制 | 字段和输出映射 | 待补或未支持 |
| --- | --- | --- | --- | --- |
| T27 | 独立文本生成节点的 polish；可按上游任务逐请求处理文本，无图片 | 非空 source≤12000 字符、instruction≤4000；普通 max_length=1024，rewrite=3072；非思考模板，MTP off | `CLIPLoader(type=qwen_image)` → `DAELAB.NativeText(prompt,max_length,profile=qwen27b)` → 完整正文／审阅建议 | 表格单元格的独立优化合同、反推不在本提供方实现范围；不能把“表格作为上游”与“单元格优化”混同 |
| TPE | 独立文本生成 reverse，逐请求恰好 1 张图；可按表格上游逐行读图 | source≤12000、instruction≤4000；max_length=2048；默认模型模板、非思考、禁采样 | CLIPLoader + LoadImage → DAELAB.NativeText.image；清除思考／控制 token，截断或空正文失败，不形成可应用建议 | 多图单请求、纯文本 polish、受保护文本单元格优化不支持；原始 PE 交接记录不覆盖后来上游按行入口 |
| TO | 后端 polish/reverse 和受保护表格优化；reverse 恰好单图 | 独立 source≤12000、instruction≤4000；普通 num_ctx=8192、num_predict=768；rewrite 16384/3072；表格 ctx=16384、输出预算来自冻结快照 | Ollama `POST /api/generate`：model/system/prompt/images/options；stream=false、think=false、keep_alive=0、temperature=0.4；输出 response | capability 的 maxOutputTokens=1024 与独立普通请求 768 不同；应记录场景值，不能合并成一个全局上限。独立面板隐藏／旧 ID 映射行为待产品确认 |
| CT | 独立 polish/reverse 单图；表格受保护文本优化不传图片像素 | 复用 qwen_request 的输入限制和输出预算；能力上限标注 4096，不等于每请求都用 4096 | Comfy OpenAIChatNode 支持检查；Responses body：model/input/max_output_tokens、reasoning.effort=none、store=true、stream=false、truncation=disabled；输出 output_text 与 usage | 目标宿主 GPT-6 Luna 能力及计费信息快照待补；失去远端原响应 ID 不自动重新计费提交；不支持本提供方取消 |

TO/CT 反推图像按共享处理：PNG/JPEG/WEBP，≤8 MiB，最长边≤8192、总像素≤20000000；EXIF 校正后转 RGB，缩至最长边 1024 并编码 JPEG quality=90。这是该共享请求函数的限制，不能直接套给 TPE 的原生 LoadImage 路径。

四个改写模板对应目标图片／MiniMax 视频 × faithful/expand；它们是提示词合同，不新增模型。`rewrite={version:1,strength,task,duration?}`，时长若给定需 0<duration≤120；首尾帧／尾帧改写要求时长。此 120 秒是改写描述限制，不代表视频生成支持 120 秒。

来源：[27B](../backend/providers/native_27b.py)、[PE](../backend/providers/native_text.py)、[Ollama](../backend/providers/qwen.py)、[Comfy 文本](../backend/providers/comfy_text.py)、[原生传输](../backend/integrations/comfyui/comfy_text_transport.py)、[改写合同](../backend/providers/prompt_rewrite.py)、[文本 UI](../frontend/src/features/prompt/llm_io_panel.mjs)。

## 本地部署组件

组件身份的文件名、字节数和 SHA-256 以 [model_manifest.json](../backend/integrations/comfyui/model_manifest.json) 为准，不在文档复制哈希。配置使用 `local-generation.json` 的 family 及 `name/path/sha256`，绝对路径留在目标机，不进入公共表。

| 模型／family | 必需组件与差异 |
| --- | --- |
| I01／image | qwen_image_2.1_turbo_int8_convrot.safetensors；GGUF 编码器与 mmproj；qwen_image_2.1_vae_bf16.safetensors；需 ComfyUI-GGUF 对应加载器 |
| I02／image_base | qwen_image_2.1_bf16.safetensors、qwen3vl_8b_int8_convrot.safetensors、相同 BF16 图像 VAE；不使用 mmproj |
| V06／video_base | minimax_h3_fl2va_pruned_int8_convrot.safetensors、minimax_h3_video_vae_int8_convrot.safetensors、pika_h3_flex_fl2va_v1_bf16.safetensors，加共用编码器／音频 VAE |
| V07／video_reference_base | minimax_h3_ref2va_pruned_int8_convrot.safetensors、INT8 视频 VAE、pika_h3_flex_ref2va_v1_bf16.safetensors，加共用组件 |
| V08／video_high | minimax_h3_fl2va_pruned_bf16.safetensors、minimax_h3_video_vae_fp16.safetensors、FL Flex LoRA，加共用组件 |
| V09／video_reference_high | minimax_h3_ref2va_pruned_bf16.safetensors、FP16 视频 VAE、Ref Flex LoRA，加共用组件 |
| T01／text_27b | qwen3.8_27b_w4a8.safetensors；原生 CLIPLoader/TextGenerate 及 DAELAB.NativeText |
| T02／text_pe | qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors；同一原生文本执行边界 |
| T03／qwenBinding | Ollama qwen3.5:9b-q4_K_M；manifest 和 model/projector/config/template/license/params 六角色 blob 的 bytes/sha256；回环 127.0.0.1:11434，不由 Studio 启动或下载 |

四个视频档位共用 `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` 和 `minimax_h3_audio_vae_fp32.safetensors`。显存、耗时不能由“高低配”名称推断；目标机路径、组件完整性、许可证及实测资源数据待接收方填写。旧 `video/video_reference` 兼容路由不扩充到本次 18 项，也不覆盖当前四个 Flex 档位配置。

## 历史验收与本轮边界

| 项目 | 可引用证据 | 不能据此声称 |
| --- | --- | --- |
| I01 | [2026-10-29 本地生成](validation/LOCAL_GENERATION_20261029.md)记录独立／表格文生图；参考尺寸构图另有单元测试 | 当前提交所有比例／参考图／保存恢复重新验收 |
| I02 | [基础版交接](validation/BASE_QWEN_PROFILE_20261104.md)区分源码与加载；[会议记录](validation/MEETING_ITEMS_ACCEPTANCE_20261104.md)补记当时独立及两行实测 | 所有目标机配置可用 |
| I03–I05、V01–V05 | [2026-10-30 积分实测](validation/COMFY_CREDITS_20261030.md)：I03/I05 文生图，I04 双图；V01 文生，V02 首尾帧，V03 首帧，V04/V05 双图参考 | 18 项或所有模型×模式均实测；本轮新增付费验收 |
| V06–V09 | [Flex 源码记录](validation/HIGH_VIDEO_SOURCE_20261105.md)；当前 high_video.py 及定向测试 | 旧 FL/Ref 20／8 步结果等于当前四档 LCM/Flex 结果 |
| T01/T02 | [27B](validation/NATIVE_27B_SOURCE_20261105.md)、[PE](validation/PE_NATIVE_TEXT_SOURCE_20261105.md)记录实现、失败与限制；[改写记录](validation/PROMPT_REWRITE_20261113.md)含替身 UI | 本轮真实 27B/PE 改写质量通过 |
| T03/T04 | [实验状态](validation/STATUS.md)、[文本通道说明](MODELS.md)；provider 和单元测试可核对 | 目录存在等于独立面板可选；模拟传输等于真实积分文本实测 |

本轮只执行文档一致性、目录覆盖与本地链接检查，不探测宿主、加载权重、下载模型或提交生成。噪点/VAE 和中文文字清晰度评估继续暂缓。

## 待补字段与待开发能力

| 编号 | 类型／范围 | 缺口与完成条件 |
| --- | --- | --- |
| F01 | 字段待补／18 项 | access、许可证名称／版本／来源、适用限制；逐项有可核对依据后再填 open/closed |
| F02 | 字段待补／I03–I05、V01–V05 | 目标宿主版本、官方节点定义、各模型×模式的 enum/default/min/max/step、参考数量；保存能力快照及日期，不虚构统一范围 |
| F03 | 字段待补／T04 | 目标宿主模型支持、计费及可用性快照；请求字段已实现，不需重写 API 接线 |
| F04 | 字段待补／9 项本地 | 目标机组件完整性、配置及权限、历史实测适用范围；机器路径与原件留在私有数据中 |
| D01 | 能力待开发／四类配置合同 | 将 kind/access/environments/input/parameters/output 统一成可消费 schema；当前已有共享目录和参数能力，不是从零开始 |
| D02 | 能力待开发／环境策略 | local 仅 open、external 允许 open+closed 的可核实过滤与提交校验；“本地/API”来源胶囊不能替代 |
| D03 | 能力待开发／3D | 尚未进入当前 Studio 目录；会议要求模型／厂商、文件上传、多视角 2–4 张且正面必填等先列需求，实际模型待定；本轮不新增 |
| D04 | 待产品确认／T03 | 独立面板隐藏旧 Qwen3.5 并映射到 27B，与“保留逻辑 ID、不自动切换”的目标有差异；先登记，不在本轮改行为 |
| D05 | 能力待修正／LF/LR | 能力 schema 宣告宽高 step=32，后端实际只校验整数范围；统一验收口径后补边界校验，不能在表中消除差异 |
| D06 | 待验收／18 项 | 根据目标机及模型×模式逐项补运行证据；技术成功、效果评价分开。文档完成不关闭 M6 |

供应商参数文档、许可证与目标机配置为字段信息来源；软件侧目录、控件、字段映射和状态由我方维护。没有依据的双方责任分配保持待确认，不以本表臆定对方负责的模型。
