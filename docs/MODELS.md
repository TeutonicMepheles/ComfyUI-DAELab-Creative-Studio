# 本地模型配置

表格编辑不需要模型。本仓库的真实模型验收限定为 `qwen3.5:9b-q4_K_M`、Qwen-Image-2.1 Turbo 和 MiniMax H3 FL；不自动下载替代模型，不以云端回退验证本次重构。界面列出其他配置项不代表本环境已经具备执行能力。

宿主从其 **user 目录**下的 `daelab/creative-studio/local-generation.json` 读取显式配置。文件缺失或 `enabled=false` 时不装配本地生成。配置字段的权威实现是 [local_generation.py](../backend/integrations/comfyui/local_generation.py)：

| 字段 | 要求 |
| --- | --- |
| `schemaVersion` | 整数 `1` |
| `enabled` | 布尔值 |
| `resourceLock` | 专用 `.lock` 文件的绝对路径；本地准入协调使用 |
| `modelBindings.image` | 可声明 `diffusion_models`、`text_encoders`、`mmproj`、`vae` |
| `modelBindings.video` | 可声明 `diffusion_models`、`text_encoders`、`video_vae`、`audio_vae`、`loras` |
| 每个模型绑定 | 仅有 `name`、`path`、`sha256`；路径为绝对路径，哈希为 64 位小写十六进制；名称须与宿主解析结果一致 |
| `qwenBinding` | `manifestPath`、`installedManifestPath`、`blobsRoot`、`manifestSha256`、`blobs` |
| Qwen 的 `blobs` | 六个不重复角色：`model`、`projector`、`config`、`template`、`license`、`params`；每项含 `role`、正整数 `bytes`、`sha256` |

Qwen 使用本机 Ollama 回环接口 `127.0.0.1:11434`。注册清单、已安装清单和六个 blob 必须符合固定绑定；服务可连接不代表模型身份验证通过。原生图片/视频模型还会核对节点类型、文件哈希及 ComfyUI 解析到的实际路径。

本指南不提供虚构路径或通用哈希模板。为目标机器准备实际清单并重启独立宿主后，在设置界面重新读取模型选项；缺失节点、权重或哈希不匹配须先解决。配置中无需写入云端密钥。机器路径、清单和权重留在宿主 user 或本地数据目录，不提交源码仓库。

配置读取、能力查询和界面设置不等于推理验收。当前本地模型执行记录、首失败和未覆盖项见 [验证状态](validation/STATUS.md)。

## Seedance（ComfyUI 账户）

生成节点通过已安装的官方 `ByteDance2TextToVideoNode`、`ByteDance2FirstLastFrameNode`、`ByteDance2ReferenceNodeV2` 接入 Seedance 2.5、2.0、2.0 Fast、2.0 Mini。启用 ComfyUI API 节点并登录 ComfyUI 账户（或配置其 API Key）后，重启服务、刷新页面即可读取模式；选项取自当前安装的官方节点，不依赖本地模型配置。实际生成使用 ComfyUI 账户积分。

支持文生视频、首帧、首尾帧和全能参考。图片／视频经冻结文件传入官方节点；全能参考按素材类型分别编号，结构化文字引用转换为 `Image N`／`Video N`。认证仅传入原生队列的敏感字段，不写入工作流或任务账本。

Seedance 参考图在提交前适配官方尺寸限制：宽高比 0.4–2.5、每边 300–6000 像素。超限图片等比缩放并居中补黑边，不裁剪；合规图片保持原文件字节。处理结果单独保存，原图及冻结输入不修改。此处理不改变视频素材。

排队中可取消；已发往云端的任务不能通过本地中断确认取消或退款，继续保留原任务记录。断线或宿主中断后结果不明时不自动重发。本次接线验证覆盖官方节点结构、请求和任务生命周期；未执行付费云端推理。

## MiniMax H3（ComfyUI 账户）

界面的 `Minimax H3` 接入官方 `MinimaxHailuo03TextToVideoNode`、`MinimaxHailuo03FirstLastFrameNode` 和 `MinimaxHailuo03ReferenceNode`，保留已有工作流模型名称，并在接口边界映射为官方 `MiniMax H3`。支持文生视频、首帧、首尾帧及图片／视频全能参考；模式和参数读取已安装节点的实际定义。与 Seedance 共用登录、文件冻结和任务恢复通道，取消及付费验证限制同上。

云端 H3 与 `MiniMax H3 FL（本地）` 分别路由；本地版仍只支持文生视频和图片首尾帧，不会自动回退到云端。
