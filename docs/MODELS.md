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
