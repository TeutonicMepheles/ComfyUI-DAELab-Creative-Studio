# 本地模型显式装配

`backend/integrations/comfyui/local_generation.py` 只读取当前 ComfyUI user 目录下的 `daelab/creative-studio/local-generation.json`。文件不存在或 `enabled: false` 时，生成 HTTP 服务和任务账本仍可用，但没有可提交的模型提供方。装配不会探测替代权重、自动启动 Ollama、下载模型或发送推理请求。

启用配置的字段为 `schemaVersion: 1`、`enabled: true`、`resourceLock`、`modelBindings` 和可选的 `qwenBinding`。只接受列明字段，文件最多 256 KiB，拒绝凭据或云端 transport 字段。路径必须是明确的本地绝对路径，资源锁必须是专用 `.lock` 文件。运行配置留在 user 目录，不提交实际机器路径或运行数据。

`modelBindings.image` 可声明 `diffusion_models`、`text_encoders`、`mmproj`、`vae`；`modelBindings.video` 可声明 `diffusion_models`、`text_encoders`、`video_vae`、`audio_vae`、`loras`。每项只含 `name`、`path`、64 位小写 `sha256`。配置解析不代表模型完整可运行；提供方 admission 会检查所需节点、类别、实际文件和完整 SHA-256，缺失条件明确阻止执行。

`qwenBinding` 包含 `manifestPath`、`installedManifestPath`、`blobsRoot`、`manifestSha256` 和 `blobs`。每个 blob 只含 `role`、正整数 `bytes`、`sha256`；必须完整且唯一声明 model/projector/config/template/license/params 六个角色。执行前验证固定清单、Ollama 已安装清单、实际 blob 字节和 `/api/tags` digest。只使用已经配置的 loopback Ollama，模型残留或资源归属不明确时拒绝继续；不会卸载其他请求持有的模型。

宿主显式注入原生队列、节点映射、模型路径解析、拥有任务的中断端口与本包模型释放钩子。前端不能提供这些执行能力。非法配置使所有提供方保持未启用，保留基础编辑和诊断，公开错误不回显配置内容。固定评测仍须使用已审查的完整提交、隔离目录、独占 GPU 条件、权重复核和 sampler 实际执行证据；配置成功不是 Eval 通过。
