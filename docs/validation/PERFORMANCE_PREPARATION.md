# 性能夹具与只读观测准备

状态：夹具与观测工具已准备；后续已实际测量旧版S拖动/缩放与新版隔离ComfyUI混合调度，结果和限制见[2026-10-25实际观察](PERFORMANCE_OBSERVATIONS_20261025.md)。PERF-01～08尚无完整退出结论。以下描述准备工具的边界，不能代替实际证据；8000生产服务未被修改。

## 固定工作负载

`tests/fixtures/performance/manifest.json` 登记所有原生 JSON 与媒体字节哈希。每档有 `no-video` / `video` 两份工作流，差别只在预览媒体引用；节点、连线与表格规模不变。

| 夹具 | 节点 | 连线 | 表格 | 视频变体上限 |
| --- | ---: | ---: | --- | ---: |
| FX-PERF-S | 100 | 100 | 1 张 100×10 | 2 |
| FX-PERF-M | 300 | 400 | 2 张各 500×10 | 4 |
| FX-PERF-L | 1000 | 1500 | 10 张各 500×10 | 4，按可见范围分级观察 |

工作流只包含现有 `DAELAB.Table`、`DAELAB.TextInput`、`DAELAB.MediaUpload`、`DAELAB.LLMStylePreviewB`，没有测试节点或推理输出节点。所有表格/文字/媒体均为合成内容，没有历史回执、用户提示词、缓存或凭据。LLM 节点仅用于其真实面板与合法多输入连线负载，**不要点击生成或运行队列**。

连线从独立 TextInput 的输出 0 到 LLM 输入 0 / 3 / 4；这些输入在固定业务源码中分别为 STRING / STRING / *。一个输入最多一条连线，输出可分支；图无环，所有输入、输出和原生 link 表互相回指。34 / 134 / 500 个 LLM 接收节点提供所需容量，剩余节点为文本源和上述表格/预览。未为了凑连线使用错误类型、循环、未知节点或缺失引用。Table 保留旧序列化 widget socket 与 `source_table` 的形状，但没有对这两个槽位造连线。

`sources.json` 固定了旧 Canvas `3176b5a…` 与旧业务库 `7ff56cb…` 的相关源文件路径及 SHA-256。来源只用于核对接口，夹具没有复制私有工作流正文。节点结构经源模型与固定原件的序列化形状交叉核对；**仍需旧/新版隔离宿主真实打开、保存、重开后核对数量、槽位和可编辑性**，当前标记为 `prepared-not-opened`。

两份媒体为生成器自产：320×180 PNG 与 3 秒、24 FPS、72 帧、无声 H.264 MP4。视频预览分别引用同一固定文件，各实例独立解码，缓存条件必须一致。L 档不要求所有节点或媒体同时可见/解码，不把“已生成 5000 行 JSON”当成分级呈现或取消已实现。

```powershell
# 使用已有 Python 与 PyAV；不会安装包或下载媒体/模型。
python tools/performance/prepare_fixtures.py --encode-video

# 只准备独立观测包，不注册节点，也不触碰服务。
python tools/performance/prepare_observer.py --package-output .local/performance-observer-v1

# 在明确选择的、已有 ownership manifest 的隔离环境里复制固定媒体。
# 拒绝 port 8000、非隔离目录、越界/软链接路径和覆盖不同内容。
python tools/performance/prepare_observer.py --copy-media-to-isolation <isolated-environment-root>
```

独立观测包包含空 `NODE_CLASS_MAPPINGS` 和一个静态 JS 文件，可作为 `tools/host/prepare_isolated.py --fixture-package` 的显式测试包。旧版宿主也应显式装入相同字节的观测包并加入其测试白名单，不能同时加载新产品包或依赖新版 fixture 的节点/样式。安装、停服刷新与启动仍由宿主负责方执行；本准备任务没有替它执行。

PNG 的生成与 JSON 生成具有确定性。视频编码器版本变化可能改变 MP4 字节；变更后须更新哈希、同时向两版隔离环境提供同一新文件，并重建基线，不能拿不同媒体作比较。

## 可见观测界面与原始报告

`tests/host_fixture/web/performance.js` 加载后只显示折叠的“性能观测（仅隔离测试）”入口。打开界面，选择 PERF 编号、旧/新版、视频变体、缓存声明、固定 JSON 文件和构建 SHA-256；选择文件仅计算哈希，**不会加载宿主图**。操作者先通过宿主 UI 打开相同夹具、确认资源加载后勾选，再点击开始。

观测协议为先预热 10 秒，再连续 30 秒 × 5 段；界面提示当前段数。PERF-07 则预热后记录 120 段 × 30 秒，不能用普通五段代替一小时。开始/停止/选择结果区域/标记/下载都由可见按钮触发。采样不访问 `app.graph`，不改图，不包装产品函数，不派发编辑或键盘事件，不查询模型或任务服务。

固定操作建议如下，每轮保持相同轨迹与目标并保留实际坐标事件：

- PERF-01：S 档，在画布空白处按同一路径平移，再围绕同一中心缩放；依次重复每 30 秒段。
- PERF-02：M 档，分别无视频与实际播放可见短视频；保持相同平移/缩放顺序，在第一张表的固定前五行、同一列输入合成内容。旧/新版输入次数与目标稳定身份一致。
- PERF-03：M 档，冷/热缓存分别记录。五次真实保存与重开前后核对数据；本观测器的人工开始/结束标记包含操作反应时间，不能当作原生序列化耗时。
- PERF-04：L 档，先打开并浏览可见范围，再使用产品**确实提供**的可取消批量操作，观察处理中与取消后数据。没有对应能力时记录缺口，禁止由测试界面伪造取消。
- PERF-05：M 档做 20 轮真实进入/退出、创建/销毁和模式切换；每轮使用可见标记按钮采样资源。订阅/计时器所有权与受控 GC 另补，不能拿 DOM 数量替代。
- PERF-06：`fake-job-plan.json` 固定 100 个混合假任务，含 fake-local / fake-cloud / fake-transcode。显式v3测试包已接入真实产品调度服务；每轮使用100个新身份，保留实际资源原子计数、队列等待、健康查询和无饥饿证据，不运行真实提供方。执行方式见`tests/performance_fixture/README.md`。
- PERF-07：M 档加假任务按真实编辑/保存/任务/切换/销毁顺序循环一小时，另做编辑值、请求身份与任务投影完整性核对。
- PERF-08：复用 `tests/fixtures/asset-library/search-2000.json`，按 `search-sequence.json` 输入固定查询，五次完整序列；测试界面可以选择实际结果 DOM 区域以观察变化，但不代替“结果已正确显示”的核对。

每个报告保留所有 rAF 间隔、真实可信输入时间、拖动/滚轮坐标、Event Timing、Long Task、可见 DOM 变化、资源请求摘要、DOM/媒体计数、非标准堆遥测、可见性变化与人工标记。不会记录输入正文、节点标题、资源 URL、文件原名或凭据。隐藏标签、提前停止、缺样本、非 DPR=1、非 1920×1080 或缺指纹均显式记录为证据不足，不丢弃失败段。原始样本达到容量边界时停止并标记，不能算完整长跑。

停止会释放采样事件、MutationObserver、PerformanceObserver、计时器和 rAF；界面控件仍可下载报告。离页时释放界面资源。下一批开始前要求先请求下载已有全部原始报告；浏览器文件是否实际保存仍须确认。刷新/重开前应下载，观测器不会把数据暗写进工作流或浏览器收藏。

```powershell
node tools/performance/analyze.mjs <raw-report.json> <new-summary.json>
```

分析器重新计算每段 p50/p95/max，使用 nearest-rank；缺样本是 `null`，不是 0。它核对固定夹具哈希、构建指纹与媒体观测状态，不接受报告中自带的“通过”字段。输出只可能是 `insufficient_evidence` / `requires_review`，`productAcceptance` 始终为 false。摘要保存原始文件 SHA-256，拒绝覆盖原报告或旧摘要。

## 能力边界

| 指标 | 本工具可提供 | 尚需补齐 |
| --- | --- | --- |
| 帧间隔与 >200ms 交互停顿 | 真实交互附近的 rAF 原始间隔与 p50/p95/max | rAF 不是 GPU compositor trace；检查轨迹一致、前台与采样开销 |
| 输入→显示、资产搜索 | Event Timing、输入→下一 rAF、所选可见区域首次变化代理 | 语义目标完成必须另有真实 DOM/宿主提交标记或 trace；Event Timing 有 16ms 采样阈值与量化 |
| 保存/加载 | 人工边界、网络资源时序、页面可见性 | 原生 serialize 起止与可编辑完成事件；页面重开会释放本观察器 |
| 生命周期 | DOM、媒体、播放器解码状态及本采样器自身资源数 | 产品实例的订阅/计时器所有权不可通过未插桩 DOM 完整获知；受控 GC 不可用 |
| JS 堆 | 浏览器支持 `performance.memory` 时的可选遥测，否则 null | 非标准 API，未执行 GC，不能用于 PERF-05 的 15% / 20MiB 判定 |
| 后端 RSS/CPU、GPU | 可选 `sample_host.py` 只读指定 PID；机器级 nvidia-smi 独立记录 | 不把全机 GPU 内存归因于本页面/解码器；PID、时间对齐、外部负载需固定 |
| 后端并发/任务完整性 | 固定假任务计划 | 实际调度器、健康请求、无饥饿、无重复提交和恢复验证 |

`sample_host.py --pid <isolated-host-pid> --output <new-private.jsonl> --duration 160 --gpu` 可与可见浏览器采样同时运行；它不启动/停止进程，不改模型或服务，只读取显式 PID 和可选全机 GPU 统计。没有 psutil 或 nvidia-smi 时明确缺测，不安装替代物。原始采样逐行刷新、拒绝覆盖，捕获 PID 重用与中断。该工具尚未在真实性能场景执行；其遥测不能独自通过任何 PERF 条目。

硬件/宿主版本沿用 `BASELINE_ENVIRONMENT.md` 的已核实参考；每次实际报告仍须重新记录浏览器、CPU/GPU/内存、包构建指纹、宿主版本、可选插件和后台负载。不能把旧日期的环境发现当成本次测量条件。

## 本轮验证

`python -m unittest discover -s tests/performance -p "test_*.py" -v` 验证六份 JSON 的确定性、数量/槽位/回指/无环、媒体完整解码与哈希、独立观测包零节点、隔离复制拒绝越界/覆盖。`node --test tests/performance/*.test.mjs` 验证缺样本/隐藏/DPR/重复次数门禁、全样本分位数、停顿保留、原报告复核，以及可见观察器开始/停止/销毁的资源释放。它们均为准备器/观测器回归，不是性能成绩。

实际打开、两版对比、浏览器验收、五轮与一小时原始报告均待执行；M5 性能门禁仍保持开放。
