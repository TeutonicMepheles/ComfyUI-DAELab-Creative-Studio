# 隔离本地 Eval 运行挂接

`tools/evals/local_runtime_hooks.py` 是显式启用的测试启动器，不是产品包的执行引擎。
本轮只实现、只读核对源码，并运行临时 Git 仓库、临时文件与随机 loopback 假服务测试。
真实 ComfyUI、Ollama、GPU、推理、云请求次数均为 **0**；没有改变 8000、8225、8226、8227，
没有给现有 fixture `__init__.py` 添加导入，也没有添加 custom node。
这些检查不等于 TC-SYS-036、M4、M5 或 M6 产品验收通过。

## 固定来源与显式组装

准备器 `tools/host/prepare_gpu_evaluation.py --instrumentation` 只从已审核 Studio commit
归档以下六个文件到隔离根的 `instrumentation/`。该目录在 `custom_nodes/` 外：

- `tools/evals/local_runtime_hooks.py`
- `tools/evals/run_local_evaluation.py`
- `tools/evals/request_contract.py`
- `tools/host/prepare_baseline.py`
- `tools/host/prepare_gpu_evaluation.py`
- `tests/host_fixture/local_eval_trace.py`

每个文件记录 Git blob 的精确字节数和 SHA-256；归档、解包和启动前重新核对。
Studio 仓库已有 `.gitattributes` 的 LF 规则；换行转换导致字节不同也会拒绝，不忽略差异。
旧包仍是 Canvas `3176b5a67dbcd0b66f795976e5a81bcdfe346093`、business
`7ff56cb51ef6f7fc3bcf5707792d655037c61b30`，GGUF
`373048b8403a7820620065210a691263d4da0a61`；宿主必须为实际干净的固定 HEAD
`3c1b7a17fdf239d35ce98cc777756f572d089795`。旧两包完整存在仅作为隔离基线夹具。

先按 [runner 合同](LOCAL_EVAL_RUNNER.md) 生成全新 `run.json`，准备十个样例 × 两版本的
实际业务 DTO、固定来源 capture、权重及引用。然后只生成启动审查材料：

```powershell
python -B -m tools.evals.local_runtime_hooks manifest `
  --prepared .local/<固定归档>/prepared.json `
  --run-directory .local/<本次运行定义> `
  --variant studio `
  --fixture-root tests/fixtures/local-eval `
  --destination .local/<固定归档>/studio-launch.json
```

实际 fixture 路径须指向已有且哈希一致的 `manifest.json`；示例路径不是自动创建的输入。
`manifest` 不连接网络、不启动进程或模型；对 Studio 只在隔离 user 目录新建明确的
`local-generation.json`，映射受审查的本地权重和独立资源锁。已有文件一律保留并拒绝覆盖。
这份配置的哈希也进入启动清单。缺 Qwen 归属资料时不配置 Qwen。

单独的启动审查 JSON 必须包含：

```json
{
  "schemaVersion": 1,
  "reviewer": "实际工程审阅者",
  "launchApproved": true,
  "exclusiveWindowReviewed": true,
  "manifestSha256": "启动清单原始字节的64位小写SHA256",
  "traceRoot": "隔离环境/evidence/下尚不存在的绝对目录"
}
```

后续明确批准真实执行时，必须使用归档内的启动器及审核解释器：

```powershell
& <审核的python.exe> -B -s <固定归档>/instrumentation/tools/evals/local_runtime_hooks.py launch `
  --manifest <精确启动清单> --approval <精确启动审查JSON> --execute-reviewed
```

上述命令是后续运行说明，本轮没有执行。没有标志、审核、完整源哈希或独立端口时，
检查在导入宿主/资源采样前拒绝。启动器拒绝 8000、8224、8225、8226、8227，使用原
`main.py`、原 native queue、`-B -s`、`--offline --cache-none` 和原包白名单。
`SourceFileLoader.exec_module` 挂接覆盖宿主 `spec_from_file_location` 导入路径，按完整
文件哈希、AST 参数表及加载后签名再次核对。`runpy` 运行同一宿主入口；不创建第二队列。
同一准备根旧新版使用排他窗口锁；不清除未知残留锁、不结束外来进程。

## 实际证据边界

| 固定入口 | 实际观察与拒绝条件 |
| --- | --- |
| 旧 `LocalExecution.generate/enqueue`、新 `ComfyNativeQueue.enqueue` | 关联原 request 与 native prompt ID；重复/外来身份拒绝 |
| `PromptQueue.put` | 从真正入队 graph 独立投影 prompt、seed、尺寸、采样、引用和权重；比较通过后才转发 |
| `folder_paths`、`comfy.utils.load_torch_file`、GGUF loader | 真实 resolver 路径和 mmproj 唯一匹配；入队前及真正读权重前复核文件哈希 |
| `PromptServer.send_sync` | 原生 start/cached/executing/success 事件原样观察；不由 history 合成 sampler 事件；二进制预览继续原生转发 |
| `MiniMaxH3ImageToVideo.execute` | 真实 CLIP tokenize 与 VAE encode 前有序 float32 小端张量哈希；错序或字节变化在模型边界前拒绝 |
| 旧 Qwen `request/polish/QwenTransport.create`、新 `LoopbackOllama.request/QwenProvider.create` | 实际 `/api/generate` JSON body、响应和原请求关联；不复制 expected capture |
| 原生 `task_done` 后的业务服务 | 新版只读 `GenerationService.public`，旧版只读原 receipt 或优化 ledger；业务终态失败不能由 sampler success 掩盖 |

为了让固定宿主发出真实原生事件，仅给 native queue 的运行元数据添加本次 `client_id`。
graph、模型参数、连线、seed 均不改。目录/文件名等非语义差异仍需 runner 工程审阅规则。
实际捕获不读取 `case.expected`；一次性 gate 才拿真实捕获与 expected 比较。

新版原生/Qwen 必须有统一服务成功 receipt；旧 native 必须有原成功 receipt，旧表格必须有
原 ledger 成功行与原 `remoteResponseId`。独立旧 polish 没有查询 API，但**完整正常返回不会
因此被阻塞**：hook 保存首次实际 Ollama 响应和原业务 `polish` 返回。
`GET /__creative_eval/v1/responses/{request_id}` 只读该原始完成事实。
响应丢失且仍没有完整原事实时保持 unknown/blocked，绝不重发。Ollama 的
`qwen-<requestId>` 是本地关联 ID，不声称 Ollama 提供远端任务队列；旧表格真实返回 ID 另存于原 receipt。

runner 额外要求 `serviceReceipt.complete/readOnly/requestId/value` 和原生实际加载权重集合。
所有请求仍是同一业务入口 → 原生队列或本地 provider → 业务回执；直接回放 graph 不能通过。

## 独立 Ollama 与零云范围

需要 Qwen 时，`manifest --ollama-ownership <JSON>` 只接纳明确的独立进程资料：
`url`、`pid`、`exe`、`exeSha256`、`createTime`、`modelsRoot`、`manifestSha256`。
不能使用 11434 或现有宿主端口。启动器不启动 Ollama、不下载、不 pull。
启动及每次 provider HTTP 前读取真实进程 exe/hash/启动时间、监听 PID/端口和环境：
`OLLAMA_HOST=127.0.0.1:<独立端口>`、`OLLAMA_NO_CLOUD=1`、`OLLAMA_NUM_PARALLEL=1`、
`OLLAMA_MAX_LOADED_MODELS=1`、`OLLAMA_KEEP_ALIVE=0`、明确的 `OLLAMA_MODELS`。
原 registry、该模型根的 installed manifest 和 tags digest 必须一致；完整六类 blob
的角色、大小、SHA-256 与 manifest 成员均核对，每请求重新哈希实际 blob。

旧默认 `BASE` 和新 adapter 的固定 11434 URL 只在独立测试进程内明确改向已审核端口；
不修改归档源码，不改变实际请求 body。每次生成要求 `/api/ps` 无已驻留模型。
正常 finally 卸载只允许本请求已观察到真实完成响应的 Qwen，且 ps 没有外来模型；
未知提交/无实际响应不能获得卸载权，不调用生产 unload/free/interrupt。

Python socket/DNS/subprocess 审计在宿主运行前安装；外部地址/域名、未审核子进程被拒绝。
provider HTTP 仅允许独立 Ollama tags/ps/generate，以及旧代码既有 **GET 8000 `/queue`**。
该生产读取保留原语义，不允许向 8000 提交、interrupt、free、unload 或带 query 的请求。
拒绝 credentials、代理目标和重定向，不记录认证头或命令全文。
Python 写入检查保留宿主、归档、instrumentation 和权重目录只读；证据仅写隔离新目录。

审计覆盖已检查的业务/provider HTTP、Python socket/DNS/subprocess 以及归属 Ollama
进程的本地模型配置。它不是 OS 级全机网络证明，不声称观察了所有原生 DLL 内部网络。
`nativeLibraryNetworkInspection=null`，`firewallRulesChanged=false`；未创建 firewall 规则，
未影响共享 Python 或其他进程。此已声明限制不额外制造新的产品授权门槛。

## 时间、内存与冷暖

原生冷暖取自真实 `current_loaded_models`：无已加载模型为 cold；与本 hook 上一成功请求
相同的保留对象及同权重集合才为 warm；其他状态为 null。Ollama 冷暖取实际 ps，当前
keep_alive=0 且无驻留的受控请求应报告 cold，不把重复次数当作 warm。

分段 wall time 来自入口、dispatch、原生 executing 节点事件以及业务回执落定。
Ollama 原始 load/prompt_eval/eval/total 纳秒计数单独保存，不用它们伪造缺失 wall 分段。
独立后台采样线程每 100ms 读取本 Python/归属 Ollama 进程树 RSS 与 NVML device used、
GPU PID/进程内存；保留全部采样值。设备使用量可能含其他进程，因此明确命名为 device
used，不伪称 owned allocation。peak 是**采样下界**，不是硬件真实瞬时峰值。
缺 NVML、权限、进程数据或冷暖依据时相应字段为 null，runner 保持 blocked，不补零或估计值。

## 回归与仍待真实执行的项目

测试覆盖固定 archive 与独立 instrumentation、改字节拒绝、精确签名、真正动态导入、
临时 loopback HTTP/socket、生产只读策略、外部 DNS/连接拒绝、已归属卸载、真实 body 投影、
H3 有序边界、二进制预览不变、业务落账延迟/失败、缺指标保留 null、新目录及原文件保留。
所有 socket 测试只连接随机 loopback 端口，不访问实际服务。

首轮 14 个 hooks 测试通过。扩大归档夹具后首次失败是夹具缺 LF `.gitattributes`，
日志保留在 `.local/review-20261025/local-runtime-hooks-second-tests.log`；修夹具后通过，
没有放宽归档字节校验。13 个本机真实 owning 文件的符号签名只读核对记录在
`.local/review-20261025/local-runtime-hook-source-contracts.json`。
最终 hooks 定向 20/20、整个 `tests/evals` 67/67、GPU preparation 7/7 通过。
采样已从真实业务入口开始，保留各样本所属 phase；该最后收口后定向 20/20 再次通过。
日志为 `local-runtime-hooks-final-all-evals.log`、`local-runtime-hooks-frozen-focused.log`
和 `local-runtime-gpu-preparation-tests.log`，均在同一只读交接证据目录。

仍待后续明确审核并执行：固定完整 Studio commit 归档、实际隔离启动、实际依赖初始化、
真实 GPU/模型/服务边界及全部 44 槽位（先 20）、输出完整解码、真实峰值/冷暖与人工质量盲评。
本工具完成与假服务回归均不提前关闭这些验收项。
