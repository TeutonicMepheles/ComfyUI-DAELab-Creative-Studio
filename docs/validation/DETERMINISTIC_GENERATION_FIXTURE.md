# 隔离宿主确定性生成夹具

这是可审查的无模型测试装配，不是产品 provider，也不构成 TC-SYS-005、TC-SYS-022、M3 或 M4 的真实 UI 验收。它只复用产品 GenerationService、JobLedger、AssetCatalog、优化 DTO 和结果校验；不接 native queue、不启动宿主、模型、浏览器或外部网络，不调用 Ollama 卸载。

## 接线归属

只在隔离测试安装 `tests/host_fixture` 时，由该包的现有 `__init__.py` 显式接线。产品根入口与发布包不导入这些文件。当前子任务没有修改现有 `__init__.py`；根代理负责安装次序和实际 UI 验收。

在产品已装配并提供 `server._creative_studio_services` 后：

```python
from .generation_fixture import assemble_generation_fixture, register_generation_fixture_routes
from .generation_fixture_nodes import register_generation_fixture_nodes

core = server._creative_studio_services
fixture = assemble_generation_fixture(core, enabled=True)
register_generation_fixture_routes(server, fixture)
nodes, names = register_generation_fixture_nodes(fixture)
NODE_CLASS_MAPPINGS.update(nodes)
NODE_DISPLAY_NAME_MAPPINGS.update(names)
```

若产品尚未先装配，不要另建 CoreServices 或第二份数据库来伪装成功；由测试包安装生命周期延后上述显式组装。类所属模块用于定位已安装产品的 backend 包，避免导入另一个工作区的顶层 backend。启动导入不调用 provider，组装后默认仍未 arm。

`StudioTest.GenerationFixture` 仅存在于独立测试包菜单。它读取证据，不通过原生执行触发任务。其 Web 入口为 `tests/host_fixture/web/generation_fixture.js`，依赖产品公开 `bindGenerationHttp(fetchApi, {prefix})`；该接口由业务前端 owner 提供。没有在加载时绑定服务、探测 fallback 或读取 app.graph。

在测试节点中先选场景并点击“应用场景”，再点击“启用本页测试服务”。第二步显式调用 `bindGenerationHttp`，prefix 为 `/studio-test/generation-fixture/api`。产品表格、表外生成和优化面板照常发出真实 UI 请求，只有当前页面的 generation/optimization 服务绑定进入夹具。禁用按钮释放绑定并刷新页面，回到正常产品装配。状态始终标识测试，不能解释成真实模型健康。

## HTTP 与 provider 协议

夹具只注册 25 个独立命名空间路由：

- `GET /studio-test/generation-fixture/state`：只读计数、稳定请求 ID、共享账本状态和源码指纹。
- `POST /studio-test/generation-fixture/control`：`arm`、`release`、`recover`、`restart`。
- 23 条产品路由逐一映射为 `/studio-test/generation-fixture/api` + 原完整路径。例：`/studio-test/generation-fixture/api/daelab/studio/generation/submit`。载荷和响应由原产品 handlers 处理。

所有夹具 HTTP 请求要求 loopback peer、loopback Host 和同源 Origin；跨站请求拒绝。请求 ID 控制仅允许带当前夹具版本标记的任务，不能借测试路由查询、恢复、取消其他 provider 的任务。route 注册冲突不覆盖既有 handler。

提供 `local-qwen-image` 和 `local-qwen-text` 两个明确的协议替身，内部 execution_kind=remote、protocol_only=True，因此无需 GPU admission。这里的 remote 只表示模拟可查询协议，绝不连接云端。图片模型仍按产品 Qwen image 参数合同验证输入；输出是每个 requestId 确定的有效 8×8 RGB PNG，真正经过共享完整媒体校验。不能把该尺寸或内容当作模型质量结果。H3 视频能力明确 unavailable，不用 PNG 冒充视频。

文字替身复用产品 Qwen 的纯请求构造和优化输入校验。输出为冻结文字加明确的 fixture 标记，保护引用 token 原样保留，经产品 suggestion 校验后供审阅。它不改前端输入；应用与过期拒绝必须经过产品 DocumentController ticket。它不声明真实 Qwen 推理或真实服务健康。

## 场景

| 场景 | 已知边界与观察 |
| --- | --- |
| success | create 一次，原 taskId query 返回可校验的合成结果。 |
| fail-429 | provider 明确拒绝，账本 failed；无结果文件。 |
| uncertain-500 | 接收后响应不确定，账本 unknown 且保存原 taskId；recover 只查询，不再 create。 |
| uncertain-no-id | 没有 provider 回执，lookup 返回空；不得从输入快照编造成功。 |
| delayed | 原任务维持 running，操作者选择 ID 手动释放。 |
| overlapping | 同时提交两张图的任务，分别手动释放，可反向完成；不共用任务目标。 |

`arm` 只影响后续冻结任务。每个任务的 scenario 写入共享账本的 prepared snapshot，后续修改场景不会改变旧任务语义。

下一次真实 UI 提交可额外选择一次性 HTTP 故障：preflight-429、before-submit-500、after-submit-500、input-error、version-mismatch。前四类中的接收前故障明确 `submitted:false`；after-submit-500 在原 handler 已接受后丢弃响应，不能声称未提交。版本故障返回期望版本和刷新/比较构建指纹动作。HTTP 故障注入与 provider 状态故障分开记录，不能混称实际远端错误。

## 重启、恢复与隔离观察

“模拟服务重启”先取消并等待本夹具全部 worker 停止，再调用唯一账本的 restart reconciliation 并重建同一 GenerationService。若共享账本仍有非夹具活动任务，操作拒绝，避免冒认其他 worker 已停止。它不是宿主进程重启，也不声称证明 OS 崩溃恢复。

重建后没有自动 dispatch。待发任务仍 pending，已知在途任务需要 query/recover。仅查询恢复按钮使用原 requestId；create 计数和 durable attempts 可前后对照。另有单元测试以新控制器读取同一数据库，证明已保存回执可查询且新控制器 create=0。统计事件只保留最近 1000 条，累计计数不受截断影响。

TC-SYS-005 的实际 UI 步骤由根代理执行：图 A 提交 delayed；切 Graph/画布并打开稳定 ID 不同的图 B；从夹具释放 A；检查 B 的内容、选中和布局未变，A 的账本仍可读；回到有效会话才能应用建议。两实例、停用模式、保存重开与 undo 仍须使用真实产品界面观察，不能由后端 source 字段断言通过。

TC-SYS-022 使用 429、500、输入与版本故障，比较页面显示、诊断和可采取动作；记录前端 fixture 源码 SHA256、后端服务模块指纹以及产品正式构建指纹（后者由现有产品诊断提供）。重复 query/recover 后核对 create 和 durable attempts 不增长。

## 本轮检查

Comfy Python 3.12 下 13 项契约测试通过：有效 PNG 全解码、两文档反向完成、拒绝/未知区分、无 ID 不伪造结果、worker 停止后的重启、fresh controller 恢复、owned cancel、foreign restart 拒绝、HTTP 一次性故障、同源边界、优化保护引用和测试注册隔离。Node 纯规则检查验证命名空间映射与模块导入不绑定/不请求。

运行命令：

```text
python -m unittest discover -s tests/host_fixture_tests -p test_*.py -v
node tests/host_fixture_tests/test_generation_fixture_frontend.mjs
```

本轮未启动 ComfyUI、GPU、浏览器或真实 provider；实际 UI 验收由根代理后续记录。首次上述契约运行全部通过，没有隐藏或删除失败记录。


原身份封存复验：HTTP `preflight-429` 可使第一次提交尚无账本条目，但查询 404 只能显示待核对。通过产品“封存原请求”明确创建同 ID 不可执行 barrier，取得 `replacementAllowed` 后才可再次点击重新生成。旧 ID 的迟到提交仍不能执行。夹具为自己创建的 barrier 注入独立 namespace 标记，所有查询、封存及优化 reference IDs 仍检查归属，不能借此读取或取消生产记录。本轮增加源码/后端回归，实际新宿主 UI 验收待统一构建。
