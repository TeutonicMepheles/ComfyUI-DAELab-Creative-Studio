# 本地真实 Eval 执行器：实现与实测边界

`tools/evals/run_local_evaluation.py` 已实现可审阅的逐槽位执行器及临时 loopback
假宿主回归。本轮真实推理次数为 **0**，没有启动宿主、Ollama、GPU、下载器，
没有访问实际 8000、8225、8226 或 11434。本文不宣称 TC-SYS-036、M4 或完整产品验收通过。

## 执行入口

| 路径 | 旧版 | Studio | 恢复 |
| --- | --- | --- | --- |
| Qwen 图像 / H3 三模式 | `/daelab/libtv/table/submit`，固定旧包本地分支，`forceNew=true` | `/daelab/studio/generation/submit` | 原 `requestIds` 的 `status` |
| 独立润色 / 图片反推 | `/daelab/prompt-optimization/polish`，`model=qwen` | 同名公开路由，统一生成服务 | Studio 查询原账本；旧版查询 hook 持久化的原完整响应，缺回执仍保持 unknown |
| 表格两行优化 | 原公开 `estimate → lease → submit → permit → advance` | 同一成熟 DTO，经新 `OptimizationFacade` | `query` 原 `batchId` |

旧路由来自 `7ff56cb51ef6f7fc3bcf5707792d655037c61b30` 的
`nodes/libtv_bridge/table_generation_api.py` 和 `nodes/prompt_optimization/api.py`。
路径中保留 `libtv` 是旧版本地公开入口的既有名称，不启用旧 LibTV 或任何云执行。
新版没有 `/prompt` 或 `/api/prompt` 直放图入口；旧新版的执行都必须经过各自业务服务。
离线构造的图只用于事前比较，不能回放为新版应用链路通过证据。

执行器不提供 retry、取消、卸载或中断 API。表格的 estimate/lease/permit 都来自真实
服务响应，批次与行身份事前生成；不会伪造 quote/permit。原生任务、独立优化和表格
任务使用相同原身份只读查询，绝不把缺失回执或丢失响应解释为重发许可。

## 固定提交与输入

`prepare` 接收 `prepare_gpu_evaluation.py` 生成的 `prepared.json`、工程审阅文件
和二十个入口 case（十个样例 × 两版）。它只读版本和归档，不启动进程：

```powershell
python -m tools.evals.run_local_evaluation prepare `
  --prepared .local/<固定归档>/prepared.json `
  --approval .local/<工程审阅>/approval.json `
  --cases .local/<工程审阅>/cases.json `
  --destination .local/<全新批次目录>
```

目标必须是新库 `.local/` 下的全新目录，不能覆盖或嵌套隔离环境。验证固定旧两库和
GGUF SHA、完整 Studio SHA、实际 ComfyUI HEAD/干净状态、Git archive 哈希和全部
解包文件、白名单、独立 user/input/output/temp、`--offline` 和 `--cache-none`。
端点只接受显式 `http://127.0.0.1:<隔离端口>`，拒绝 8000、外部主机、认证 URL、
路径/query/fragment、重定向和环境代理。

工程审阅文件的字段：

| 字段 | 作用 |
| --- | --- |
| `schemaVersion: 1`, `reviewer` | 可审计的审阅者；工程差异可由 Codex/root 审阅 |
| `studioCommit`, `hostCommit` | 完整 40 位已审查 commit；不接受 branch/HEAD 别名 |
| `preparedSha256`, `casesSha256`, `planSha256` | 文件原始字节 SHA-256 |
| `runnerSha256`, `traceModuleSha256` | 本执行器及可选边界模块的原始字节 SHA-256 |
| `executionApproved` | 明确实际执行审核；准备可为 false，run/resume 必须为 true |
| `requestDifferences` | 按 sampleId 存放比较器规定的精确 JSON Pointer/两侧哈希/原因/reviewer |

工程差异说明不会豁免 effective、权重、seed、采样参数、提示词等模型语义变化。
相同字节的素材路径差异可由负责工程审查者据实际字节说明，无需制造新的产品决定。
人工语义/视觉盲评不能由此工程审阅替代。

`cases.json` 顶层只能是 `baseline`、`studio`，各含全部十个 sampleId。每个 case：

| 字段 | 内容 |
| --- | --- |
| `driver` | `native-image`、`native-video`、`polish` 或 `table` |
| `payload` | 真实服务 DTO：原生为 `input`（旧入口仍需 `project`），polish 为除 requestId 的 body，table 为冻结行 snapshot |
| `expected` | 保留准备器 capture 的 `sampleId/inputSha256/finalRequest/effective` 原值 |
| `sourceCapture: {path, sha256}` | 固定旧或 Studio 准备器输出文件；历史结果/执行过的 capture 被拒绝 |
| `weights` | 每个实际文件 `{path,bytes,sha256}`；Ollama 必须包含已绑定的完整 blobs |
| `samplerNodes` | 从该最终图定位的准确采样节点 ID；Ollama 为 `[]` |
| `runtimeDifferences` | 同一变体 capture 与实际 dispatch 间已审阅的非语义路径差异；默认无豁免 |
| `expectedPreprocessingSha256` | H3 首/尾参考的已审核有序 CPU float32 小端连续字节哈希 |

引用素材必须预先按受审查方案放入隔离 input，`payload.assets` 用该实例的本地 `/view`
引用；执行器不向旧用户目录写文件，不自动搬入历史任务或结果，不自动下载模型。
图片反推传原始公开合成图片的 data URL，最终实际 JPEG body 哈希仍在 dispatch gate 比较。
表格 snapshot 必须从对应版本真实纯 builder 生成，不能手写最终模型 prompt 或保护 nonce。

现有 `prepare_local_inputs.py` / `prepare_studio_inputs.py` 的十个 capture 为来源，
执行前应针对最终审查 commit 重新准备/核对源码闭包。执行器不能把一份旧 capture 的存在
当作新提交实现通过：业务入口后的实际最终 graph/body 还必须再次被独立 gate 检查。

## 本轮没有自动挂接的运行边界

`tests/host_fixture/local_eval_trace.py` 是独立可选模块。**现有 fixture `__init__.py`
没有导入或注册它**，正式包不依赖它，当前实际宿主没有被改变。

明确的组装 API 是：

```python
gate = BoundaryGate(new_evidence_root, reviewed_identity, hooks=installed_hooks,
                    read_roots=explicit_previous_trace_roots)
register_local_eval_trace(server, gate)
```

它提供 `/__creative_eval/v1/identity`、`/arm`、`/observations/{request_id}`、
`/events/{request_id}`。未提供所需 hook 时 `ready=false`，执行器在调用业务入口前阻塞。
这些 callable 必须来自另行审查的隔离启动组装，不能传 `lambda: True` 冒充真实环境；
回归中的布尔/指标替身仅属于假宿主测试。

| 必需 hook | 必须实际证明的边界 |
| --- | --- |
| `live-host-identity` | 读取正在运行进程的 commit、base/user/input/output/temp、端口、offline/cache 参数、队列与独占测试窗口 |
| `dispatch-gate` | 所有真实队列入队和 Ollama generate 路径都经过一次性 gate；未知/外来请求被拒绝 |
| `resolved-weight-rehash` | 返回实际 resolver 选择的文件，再逐文件重新哈希；不能只返回型号或 M0 库存字符串 |
| `network-deny-audit` | 已核对的 Python/provider HTTP 外连禁止与独立 Ollama 归属配置；审计范围和原生库不可见部分须明确记录 |
| `native-event-stream` | 转发实际 `PromptServer.send_sync` 事件；不能从 status、history 完成标记合成采样事件 |
| `ollama-final-response` | 收集实际 `/api/generate` 最终响应、done/stop、eval_count/eval_duration及原请求关联 |
| `h3-tensor-admission` | 有参考图时，在真实 tokenize 和 VAE encode 前记录/比较有序张量；错序或错字节立即拒绝 |

原生 wrapper 在实际入队前调用 `gate.before_dispatch(request_id, native_id, actual_capture)`；
Ollama wrapper 在真正发送 generate 前调用同一入口。`actual_capture` 必须从真正将被发送的
graph/body 独立投影，不能抄 `case.expected`。gate 重新比较并重新哈希实际权重，然后以
排他新文件持久消费身份，才允许 wrapper 转发原请求。它不构造或执行图，不是第二执行引擎。

原生事件交给 `gate.native_event(type, data)`；H3 有序张量哈希交给
`gate.h3_tensor_boundary(request_id, 'tokenize'|'vae', hashes)`；实际完成后以
`gate.finish(...)` 记录输出 receipt、真实 Ollama 响应、分段指标。未实测的指标为 null。
H3 tensor 事件不可被 finish 的总结数据替换。gate 存储 fsync 日志，拒绝重复 arm/dispatch；
新进程只能从显式匹配身份的旧 trace 根读取完成记录，不能重启同一请求。

独立 instrumentation 启动器已实现，详见 [运行挂接](LOCAL_EVAL_RUNTIME_HOOKS.md)。
准备器显式归档六个测试文件到 custom_nodes 之外，正式节点白名单保持原样；启动使用
`-B -s` 并核对精确源字节、签名和审核清单。严格快照重检继续拒绝额外 `__pycache__`。
该实现已做离线回归，实际隔离启动和44次推理仍未执行。

## 身份、恢复与证据

每批事前生成 44 组唯一 requestId/batchId/clientId/attemptId，前 20 槽位恰好为每样例
每版一次，计入总数。后续重复只能在前序完整采集后逐项执行。当前实现仅标准 44 次；
任何非空 LoRA 配置明确阻塞，额外 6 次条件批次还未实现。

```powershell
# 仅在上述真实 hook/独占窗口/明确审核齐备后，由负责人单独调用。
python -m tools.evals.run_local_evaluation run --directory .local/<批次> --slot 1 --execute-reviewed
python -m tools.evals.run_local_evaluation resume --directory .local/<批次> --slot 1 --execute-reviewed
```

run 在业务调用前保存身份和 dispatch intent。任何响应不明都保留该身份并阻塞，重跑 run
会被拒绝；resume 只调用 status/query，比较前后真实 dispatch 数和 execution_start 数，
不 arm、不 submit/advance/retry、不换 ID。旧独立 polish 使用挂接器保存的原业务完整响应；
缺少该原始记录、原 trace 不完整或服务重启后原记录不可读均保持 blocked。
首次失败和每次 recovery 子目录原样保留。

每个槽位保存工程版本/输入哈希、权重重哈希、实际入口响应、gate 观察、WS 原始事件、
输出副本、分段时间/内存及完整缺项；文件哈希/大小进入 artifact 清单。
任务→F→AC→UC→TC-SYS-036→EV-LOCAL 引用从权威 traceability 绑定，M5 完整流程
仍指向 TC-SYS-032，不能由本运行器自动关闭。

原生必须观察同一 providerTaskId 的一次 execution_start、每个 sampler 恰好一次
executing、一次 execution_success；任何 cache 节点、ledger 复用、缺事件都阻塞。
WebSocket 的墙钟持续时间不能证明冷暖状态、峰值 RSS/GPU 或加载/编码/采样/输出分段，
缺少独立测量时对应字段保留 null/blocked。

Pillow 解码完整图片；PyAV 解码全部视频帧和存在的音频流；检查尺寸、帧数、帧率、时长、
receipt hash和复制前后文件稳定性。H3 为 39 帧/24fps/1.625 秒，不误判必须 1.5 秒。
原先已存在的输出路径拒绝作为新结果，即使其字节或时间被改写。结果复制到本批新目录，
不会删除或覆盖宿主输出。

`status=captured` 仅表示该槽位技术证据齐备，`productAcceptance=false` 恒为 false，
`qualityScores=null`。它不是严格 `evidence.schema.json` 的 passed 记录，也不直接写阶段门禁。
全部 44 次、配对参数/性能门禁、恢复证明、真人盲评以及 `local_batch.mjs` 的整批验证仍须完成；
不得把工具测试数字或一张可解码图片替代这些条件。

## 本轮工具回归

执行命令：

```powershell
python -m unittest discover -s tests/evals -p test_local_evaluation_runner.py -v
```

回归只建立随机空闲端口的临时 loopback 假宿主、临时 Git 仓库和合成文件，
以及 CPU 合成 39 帧视频。包括完整多步表格入口、旧版 forceNew、新版业务入口、WS事件、
丢响应原身份恢复、拒绝重复、缓存/缺指标阻断、提交/模型/捕获漂移、目录不可覆盖、来源归档
变化、H3参考换序、重启只读 trace 和全解码。没有真实提供方调用。

首次 19 项工具检查通过；增加用例时有一次测试代码插入位置错误（NameError），首失败
保留在 `.local/review-20261025/local-eval-runner-second-tests.log`，未改产品代码来绕过。
修正测试后定向 25 项通过，Eval 工具整组 47 项通过、0 失败/跳过；最终日志为
`.local/review-20261025/local-eval-runner-final-evals-tests.log`。四个文件 SHA 见同目录
`local-eval-runner-handoff.json`，这些数字不代表产品通过。
