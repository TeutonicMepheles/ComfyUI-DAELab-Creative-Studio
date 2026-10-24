# 本地模型显式装配

`backend/integrations/comfyui/local_generation.py` 只读取当前 ComfyUI user 目录下的 `daelab/creative-studio/local-generation.json`。文件不存在或 `enabled: false` 时，生成 HTTP 服务和任务账本仍可用，但没有可提交的模型提供方。装配不会探测替代权重、自动启动 Ollama、下载模型或发送推理请求。

启用配置的字段为 `schemaVersion: 1`、`enabled: true`、`resourceLock`、`modelBindings` 和可选的 `qwenBinding`。只接受列明字段，文件最多 256 KiB，拒绝凭据或云端 transport 字段。路径必须是明确的本地绝对路径，资源锁必须是专用 `.lock` 文件。运行配置留在 user 目录，不提交实际机器路径或运行数据。

`modelBindings.image` 可声明 `diffusion_models`、`text_encoders`、`mmproj`、`vae`；`modelBindings.video` 可声明 `diffusion_models`、`text_encoders`、`video_vae`、`audio_vae`、`loras`。每项只含 `name`、`path`、64 位小写 `sha256`。配置解析不代表模型完整可运行；提供方 admission 会检查所需节点、类别、实际文件和完整 SHA-256，缺失条件明确阻止执行。

`qwenBinding` 包含 `manifestPath`、`installedManifestPath`、`blobsRoot`、`manifestSha256` 和 `blobs`。每个 blob 只含 `role`、正整数 `bytes`、`sha256`；必须完整且唯一声明 model/projector/config/template/license/params 六个角色。执行前验证固定清单、Ollama 已安装清单、实际 blob 字节和 `/api/tags` digest。只使用已经配置的 loopback Ollama，模型残留或资源归属不明确时拒绝继续；不会卸载其他请求持有的模型。

宿主显式注入原生队列、节点映射、模型路径解析、拥有任务的中断端口与本包模型释放钩子。前端不能提供这些执行能力。非法配置使所有提供方保持未启用，保留基础编辑和诊断，公开错误不回显配置内容。固定评测仍须使用已审查的完整提交、隔离目录、独占 GPU 条件、权重复核和 sampler 实际执行证据；配置成功不是 Eval 通过。


## 共享资源配额与异步边界

每个宿主 `CoreServices` 持有唯一 `resources: ResourceAdmission`，默认 GPU 1、云端协议提供方 3、转码 2；测试或宿主显式装配可传 `resource_limits`，GPU 必须保持 1。`native` 与 `ollama` 共用 GPU 容量，GPU 的跨进程文件锁、原生队列归属检查及 Ollama 卸载隔离仍由 `LocalAdmission` 负责。容量门不维护额外执行线程池、第二份任务账本或模型服务。当前云端仍只允许明确标注的确定性协议替身，配置容量不是启用真实云端的授权。

生成异步任务使用 `resources.lease(resource, request_id=...)`；原生 VideoEdit 在宿主支持的 async V3 入口捕获 `CurrentNodeContext`，经默认线程池调用同步 ExportService；该同步阶段使用同一个对象的 `lease_sync('transcode', ...)`，HTTP 预览也取得转码容量。FIFO 指实际进入资源等待队列的顺序；并发数据库读取完成顺序不保证与提交数组顺序相同。异步等待不占用线程池，取消等待不会调用 provider。同步入口拒绝在任何事件循环中阻塞等待；固定宿主本身也在原生执行线程内运行事件循环，因此节点适配必须先显式转交同步阶段，原生队列仍拥有整个执行流程。

远端或协议转码的提交结果未知、查询失联和恢复中状态都保留 permit。上下文结束本身不是资源释放证明；只有原账本的终态或本轮尚未开始提交才释放。新资源对象首次执行前从同一 JobLedger 的单条 SELECT 一致性快照重建未决远端占用，不修改任务事实；不能按状态或 offset 分次扫描，否则恢复中的非终态任务可能移到已经扫描过的状态而遗漏。重建提交与终态释放使用同一互斥锁；初始化期间的释放标记阻止过期扫描结果重新占用容量，初始化提交后清除这些临时标记。已进入原生队列但尚未开始的导出不占转码容量；原生执行只有在完整核对原请求指纹与宿主执行身份后，才可接管属于同一请求的保守恢复占用。状态查询不启动恢复、清理占用或模型。

生成与优化 HTTP 路径的账本访问、媒体校验及结果构建放入工作线程；批量优化查询在一次工作线程调用中处理一组行。租约、报价、一次性许可、暂停控制仍由事件循环维护。持久提交声明返回后、provider 调用之前再核对取消与控制许可，以覆盖数据库等待期间发生的停止。Comfy 模型释放仅在显式 GPU lease 内执行，实际同步卸载操作迁至工作线程。已经启动的 SQLite、回执或 codec 工作通过 `complete_blocking` / `complete_task` 等待实际完成后才传播调用方取消，循环处理重复 `cancel()`；终态读取与容量释放在同一不可拆分的清理回调内进行。未知 provider 执行不会因为 HTTP 请求取消而被标记停止或释放。

这些容量属于同一宿主装配实例；GPU 文件锁另提供物理进程互斥，不把多个独立宿主的云端请求当作一个分布式全局队列。独立 100 任务测试采用真实服务、SQLite 和容量门，provider 为确定性替身；该证据不替代真实 ComfyUI、真实模型、长时间压力或浏览器性能验收。


取消确认与正常观察可能同时推进同一账本版本。确认端在工作线程中对同一 provider 和 providerTaskId 重读并有限 CAS 重试，不重复外部 cancel；已提交的成功/失败/取消终态优先保留。连续争用超出重试界限时只返回原持久取消意图并保持未决资源占用，由原观察/恢复继续核对，不伪造取消或新请求。
