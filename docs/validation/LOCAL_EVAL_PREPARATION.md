# 本地 Eval 输入与最终请求准备

这份准备固定了 10 个公开合成输入，并实际运行固定旧源码的请求构建函数截获最终 body / Comfy 图。没有启动模型、Ollama、宿主或提交推理，未访问 8000，也不构成 TC-SYS-036 通过证据。44 次成对推理、20 次先行冒烟及人工盲评仍按 `catalog/local-eval-plan.json` 执行。

## 已固定输入

权威输入是 `tests/fixtures/local-eval/samples.json`，媒体及来源哈希在同目录 `manifest.json`。图像由准备器确定性绘制，不包含用户照片、历史输出、工作流、任务回执、缓存或凭据。

| 样例 | 输入覆盖 | 每版次数 |
| --- | --- | ---: |
| LOCAL-TEXT-001 | 独立润色：重复文字、杯柄朝向、否定约束 | 3 |
| LOCAL-TEXT-002 | 表格第一行：动态文字引用与主体数量 | 3 |
| LOCAL-TEXT-003 | 表格第二行：行级覆盖、固定镜头、否定约束 | 3 |
| LOCAL-VISION-001 | 1536×1024 几何图：数量、颜色、左右关系，触发缩图 | 3 |
| LOCAL-VISION-002 | 768×512 几何图：上下关系、大小和遮挡 | 3 |
| LOCAL-IMAGE-001 | 两只蓝杯的高矮、方向与数量；seed 20261013 | 2 |
| LOCAL-IMAGE-002 | 小屋、树和山的数量与空间关系；seed 20261014 | 1 |
| LOCAL-H3-001 | 文生视频：红球移动、蓝块静止 | 1 |
| LOCAL-H3-002 | 首帧视频：固定主体与运动 | 1 |
| LOCAL-H3-003 | 首尾帧视频：有序参考与连续运动 | 2 |

独立文本和反推保持温度 0.4、8192 上下文、768 输出，不传 seed。表内保持 16384 上下文，本批快照固定 1024 输出，动态引用保护 nonce 也固定。表格快照由旧版 `freezeSnapshot` 构造，未手写最终模型 prompt。

生图固定 1024×1024、8 步、CFG 1、Euler/simple。H3 固定 512×288、输入 1.5 秒、20 步、非 turbo、seed 20261023；旧函数对齐为 39 帧、24 FPS，解码目标时长 1.625 秒。不存在已配置的 8 步 LoRA，因此没有准备额外 6 次补充推理。

固定权重采用 M0 实际重新哈希的清单：Qwen 图像模型、GGUF 编码器及对应 mmproj、BF16 VAE；H3 NVFP4 模型、NVFP4 AWQ 编码器、FP16 视频 VAE、FP32 音频 VAE；Ollama `qwen3.5:9b-q4_K_M` 的完整 manifest blobs。准备器只复核文件存在与大小，真实执行前仍须重新核验哈希并记录实际加载权重。不能以旧库存哈希冒充本轮模型加载证明。

## 运行只截获的准备器

先完成 `OLD_BASELINE.md` 中的固定归档准备，不需要启动旧宿主。用参考 ComfyUI Python 执行：

```powershell
python tools/evals/prepare_local_inputs.py
python -m unittest discover -s tests/evals -p 'test_*.py' -v
```

默认输出到新的 `.local/local-eval-preparation/<时间标识>/`。每次输出 10 个请求、图片反推的实际 JPEG 字节和 `preparation.json`；目录不能复用，已有证据不覆盖。公开 fixture 仅允许字节完全相同的复用，变化时应先记录输入版本变更并使旧证据失效。不要删除旧报告来规避该拒绝。

准备器校验旧业务归档固定 SHA-256，并将每个用到的源码文件同时对照归档内容和快照清单。只执行 AST 中完整的选定定义，绕过旧包注册入口。表格的纯 ESM 依赖闭包也逐文件校验。宿主图像处理源码与固定 Git 对象比较，仅允许 Windows checkout 的 CRLF/LF 表示差异，证据仍记录未经规范化的真实文件字节哈希。来源 commit、文件哈希以及历史原件哈希均留在 manifest；绝对路径和原始工作流留在忽略目录。

## 实际捕获点与停止位置

| 入口 | 实际运行的固定旧函数 | 截获位置 |
| --- | --- | --- |
| 独立润色 / 图片反推 | `canvas.polish` → `local_qwen.generate` → `_generate` | `request('/api/generate', body)` 调用替身抛出捕获异常，未连接 Ollama |
| 表格两行优化 | `freezeSnapshot` → `QwenTransport.create` → 同一 `_generate` | 捕获真实系统指令、JSON 文本、保护标记、上下文及输出预算 |
| 文生图 | `LocalImage.build_prompt` | 返回真实原生图后停止，未调用 `LocalExecution.generate/enqueue` |
| H3 三模式 | `compile_segments` → `LocalVideo.validate_request/build_prompt` | 返回包含结构化 Picture 引用的真实原生图后停止 |

Qwen 的 admission、队列、卸载与 quarantine 使用内存/独立文件替身。内存 server 的 `port=8000` 仅用于跳过旧源码跨实例查询分支，不代表存在对该端口的连接。Python 层拒绝 socket connect/DNS/sendto 和子进程；Node 冻结器拒绝网络和子进程。没有实例化真实 ComfyUI 队列、加载器或模型管理模块。模型存在性与节点映射替身只能帮助构造图，不能证明当前宿主可执行，也不能证明 GPU 协调安全。

## 预处理哈希及尚未关闭的条件

Qwen 图片反推已经调用旧 `image_payload`：EXIF 转置、RGB、最长边 1024 缩图、JPEG quality 90。捕获并哈希的是真正送入 body 的 JPEG 字节，原 PNG 哈希另存，不互相替代。

H3 的参考图预处理发生在宿主 `LoadImage.load_image` / `VideoFromFile.get_components` 之后，以及 `MiniMaxH3ImageToVideo.execute` 内部。首帧使用 Lanczos stretch（`crop='disabled'`），尾帧使用 Lanczos center-crop。准备器只记录源 PNG 哈希；`LOCAL-H3-002/003` 的 `preprocessingStatus` 明确为 `runtime-boundary-capture-required`，预处理哈希列表为空，不能提交为 live Eval 的完整请求证据。

受控执行阶段应在 `execute` 调用 `clip.tokenize(prompt, images=images)` 前记录按引用顺序的张量 shape、dtype、连续 CPU float32 小端字节 SHA-256；同时在随后的 `vae.encode` 输入确认相同张量身份。若仅做预处理演练，可用抛出捕获异常的 clip 替身在 tokenize 调用处停止，并将 `_empty_av_latent` 改为测试替身以避免 GPU 分配；此演练依然不是采样证据。真实执行报告必须关联实际宿主、源图哈希、处理代码哈希和最后输入张量哈希。

后续仍需 Studio 对应实际入口的请求捕获、共享 GPU admission、权重再核验、完整网络审计、非缓存采样 trace、同冷热状态的分段耗时与峰值内存、全部输出可解码检查、恢复零重采样以及人工盲评。准备器没有生成这些结果，也不会提升任何用例状态。

## 比较规则

```powershell
python tools/evals/request_contract.py .local/baseline-request.json .local/studio-request.json
python tools/evals/request_contract.py .local/baseline-request.json .local/studio-request.json --explanations .local/reviewed-differences.json
```

比较器逐字比较系统指令、展开文本、引用顺序、预处理哈希、权重与参数。数组顺序、空白、缺失字段、null、布尔与数字均保留区别。只忽略明确运行 ID / 输出前缀，以及原生图的 `save.inputs.filename_prefix`；其他层级碰巧同名的字段不会被忽略。比较结果只输出差异路径和两侧值哈希，不回显正文。

每个其他 wire 差异必须有唯一 JSON Pointer、两侧值 SHA-256、具体原因与审阅人；说明与值不匹配、重复、过期或没有真实差异均阻塞。`effective` 中的参数、正文、引用与权重不能靠说明放行；原始模型请求中的 seed、提示词、权重文件、采样配置等字段变化也会直接阻塞，不能以保持旧 `effective` 元数据来掩盖。比较器检查请求一致性，不授予推理验收；现有 `local_batch.mjs` 仍负责 44/50 次整批证据门禁。

已知历史 H3 展开文本含数字化镜头措辞。原件哈希保留，比较器不会将其改成更合理的文字，也不会做文本标准化。此轮公开样例重新合成，不宣称复现或修复所有历史缺陷；原始工作流的兼容回归仍需独立执行。

## 本次工具证据

实际 Python 3.12 已完成 10 请求准备，首次报告目录为 `.local/local-eval-preparation/1792859123744884800/`；`submitted=0`、`inferences=0`。首次准备与测试日志分别为 `.local/baseline/local-eval-preparation-first.log`、`local-eval-preparation-tests-first.log`。12 项工具回归覆盖差异说明、参数不可豁免、引用换序、历史文本不改写、凭据拒绝、无网络、无子进程、来源函数选择、固定参数与不可覆盖证据。这些都是准备工具证据，不是模型或界面通过记录。

加入宿主 Git 字节检查后的首轮拒绝记录在 `local-eval-preparation-final.log`：原因是 Windows CRLF checkout 与 Git LF 对象字节不同。确认仅行尾表示变化后，校验器允许这一项 Git 表示差异；原始文件哈希未变，失败日志和当次部分输出均保留。

最终准备目录为 `.local/local-eval-preparation/1792859439799950800/`，完整 10 个请求与首次捕获逐项一致，重复性报告为 `local-eval-repeatability.log`。另补了“原始请求 seed 改变但保留旧 effective 元数据”的失败回归，首失败保存在 `local-eval-wire-drift-first-failure.log`；修复后共 13 项工具测试通过。

补齐准备器/比较器源码指纹与实际 Python、Pillow、Node 版本后的最新报告为 `.local/local-eval-preparation/1792859601674585100/`。日志为 `local-eval-preparation-tool-fingerprint.log`；`preparation.json.tooling` 将捕获结果绑定到执行工具字节，后续工具变化不能冒用当前报告。

## H3 CPU 预处理边界演练

`tools/evals/capture_h3_preprocessing.py` 已运行固定宿主的完整 `LoadImage`、
`VideoFromFile`、`common_upscale`、`_resize` 和 `MiniMaxH3ImageToVideo.execute` 定义。
仅潜变量分配、文本编码、VAE 编码和输出包装使用显式替身；不导入宿主注册入口，
不建立队列，网络和子进程在捕获期间被拒绝。Torch CUDA 未初始化。

三个 H3 样例已捕获原始 PNG、实际加载张量、tokenize 和 VAE 边界哈希；
后两处收到相同有序张量对象及相同字节。输出为 CPU float32 小端连续字节，
首帧和尾帧均为 `[1,288,512,3]`，尾帧按原源码进行中心裁剪。
最新报告在 `.local/h3-preprocessing/1792860459385683600/preprocessing.json`，
初次运行保留在 `1792860413515373600`；两个日志均在 `.local/baseline/`。

这是固定图像预处理的准备证据，不是实际模型输入或采样验收。
真实执行仍需在相同边界再次捕获，并与本报告以及对应旧/新版请求关联。
新增三项夹具校验回归拒绝图片或参数改变后冒用原清单；Eval 工具测试目前共 16 项通过。

## 固定提交的 GPU 环境准备器

`python -m tools.host.prepare_gpu_evaluation` 仅准备、不启动服务。它要求完整的
Studio 提交 SHA、已固定的旧 Canvas/业务/GGUF 提交和干净的固定 ComfyUI 宿主；
输出必须在新库忽略目录 `.local/` 内且尚不存在。旧新版各自有 user/input/output/temp、
端口和 Git archive 快照，模型以明确路径表只读引用。来源未提交改动不会被复制或修改。

准备出的命令包含 `--cache-none`，使独立推理具备禁用节点缓存的运行条件；
实际采样节点是否执行仍须以 websocket/执行 trace 核验，不能凭参数直接计数。
模型文件在此仅核对存在、尺寸和已记录的哈希格式；推理准入必须重新验证字节与
宿主实际解析路径。准备报告明确 `modelsRehashedAtPreparation=false`、
`activationAllowed=false`、`samplerExecutions=0`。没有云端、下载或替代模型路径。

五项真实临时 Git 仓库回归验证固定提交快照、保留未提交改动、两个数据目录、
禁止生产端口/外部目录/移动 ref、配置篡改、模型尺寸变化和宿主改动。
日志为 `.local/baseline/gpu-preparation-first-tests.log` 和 `gpu-preparation-final-tests.log`。
完整 Studio 实现提交尚未固定，因此当前还没有由此工具准备或启动实际 GPU 宿主。

独立审查复现了“固定提交仍在 Git 历史中，但 live host 已切到另一干净提交”的缺口。
准备器现要求宿主实际 HEAD 与固定 SHA 相等；回归保留两个真实提交，验证第二个
干净 HEAD 被拒绝。首次复现位于 `.local/review-20261025/boundary-repros.json`，
修复后五项通过记录在 `.local/baseline/gpu-preparation-host-drift-regression.log`。
