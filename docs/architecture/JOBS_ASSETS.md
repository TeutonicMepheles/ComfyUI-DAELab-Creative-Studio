# 统一账本与资产服务

Jobs/Assets 是宿主独立的持久化服务，由 `integrations/comfyui/services.py` 注入同一个产品 SQLite 数据库。宿主已接入资产目录与收藏 HTTP 路由；生成服务通过同一账本管理请求、冻结输入和结果。导入或装配服务不会启动 worker、提交原生队列或加载模型。真实模型、完整前端和阶段验收状态以 `docs/validation/STATUS.md` 为准。

## 组装入口

```python
from .backend.assets import AssetCatalog
from .backend.jobs import JobLedger

# 路径由 integrations/comfyui 从隔离 user/input/output/temp 目录提供。
database = product_user_dir / "studio.sqlite3"
assets = AssetCatalog(
    database,
    roots={"input": input_dir, "output": output_dir, "temp": temp_dir},
    frozen_root=product_user_dir / "frozen-assets",
)
jobs = JobLedger(database, result_validator=assets.validate_result_receipt)
```

Jobs 与 Assets 必须接同一个产品数据库。运行数据置于 ComfyUI 用户目录的产品命名空间，不放代码仓库。数据库使用 SQLite `application_id`、`user_version`、WAL、FULL 同步、外键与 `BEGIN IMMEDIATE`；当前版本为 3，包含收藏移除记录。迁移与版本号修改在同一事务中，未知未来版本和无身份的非空库拒绝采用，保留原数据。`Database.backup()` 使用 SQLite 在线备份并拒绝覆盖已有目标。

公共 Python 类型入口为 `backend/contracts/ports.py`。只用 Python 标准库；缺少模型、云凭据或 ComfyTV 不会影响这两个服务导入。连接管理与凭据留在调用侧；输入、来源、事件及结果 JSON 检查会拒绝凭据字段，错误不回显正文。诊断导出使用 `jobs.diagnostics(request_id)`，不要把 `get()` 的输入快照或原始结果当作公开诊断。

## 提交和恢复

1. 从稳定工作流、节点、record/field 身份构造 `source`；将本地输入媒体先经 `assets.freeze(reference_id)` 固定内容，完整模型请求放入 `snapshot`。
2. `create_or_get(request_id, provider=..., execution_kind=..., snapshot=..., source=...)` 返回 `(job, created)`。同 ID 同输入复用；不同输入、provider 或来源范围冲突，不能重写。不同 ID 的明确新操作可以创建新任务。
3. 执行侧必须先调用 `begin_submission(request_id, expected_version=job['version'])`。它原子持久化 `submitting` 与唯一 attempt；只有拿到该调用成功的进程才有权进行一次外部提交。`create_or_get` 返回已有记录不意味着可以提交。
4. 原生 prompt ID 或提供方任务 ID 返回后立即 `mark_submitted`，随后通过 `transition` 写入真实状态和事件。每次使用最新 `version`，重复 `event_id` 且相同内容无副作用；不同内容冲突。已绑定 provider ID 不可替换或归给另一 request。
5. 服务重启、确认旧 worker 全部停止后调用 `reconcile_restart()`。有原执行 ID 的活跃项变为 `needs_recovery`，没有确认 ID 的提交变为 `unknown`。该函数不执行网络或队列操作，不能在还有旧 worker 正常运行时调用。
6. `recovery_action` 只返回 `query_original`、`lookup_original_request`、`manual_reconciliation`、`read_result` 等动作，绝不返回 create。`claim_recovery` 用持久计数限制重试；达到预算需显示人工处理原因，不能换 request ID 自动再发。

账本状态为 pending、submitting、submitted、running、fetching、succeeded、failed、needs_recovery、unknown、cancelled。终态不可回退。输入快照及 source 不提供修改接口，撤销/重做不能访问任务事实写入口。

`transition(..., state='succeeded')` 接受非空文本回执，或经注入资产验证器核实的媒体回执。媒体完成前先 `assets.result_receipt(reference_ids)`；只接受 output/frozen 根下存在且大小、SHA-256 与原引用一致的文件。显示或复用历史结果时仍需重新验证引用：任务曾完成这一事实与结果文件当前仍可用是不同信息，文件后来丢失不应使账本回到执行中或自动重跑。

## 取消与显式新执行

`request_cancel` 对 pending 项直接持久化 cancelled，之后无法取得提交 claim。对已提交/运行项只记录 `cancel_requested`；不能将隐藏面板、暂停轮询或用户点击视为远端取消成功。无远端取消能力时继续跟踪原身份。

本地中断由宿主适配器确认具体拥有的 native ID，再调用 `confirm_cancelled(..., provider_task_id=原ID, confirmation='owned_native_execution_stopped')`。远端取消使用 `provider_cancelled`。错误 ID 或尚无确认时拒绝终结；本服务没有全局 interrupt 操作。

明确的新本地重跑可使用 `retry_local_as_new(old_request_id, new_request_id)`。只允许已确认 failed/cancelled 的本地任务，保留原终态，创建新的待派发身份，并通过 `source.previous_request_id` 保持关联；它不提交新任务。恢复原任务则保持原身份，不调用这个入口。

## 资产与收藏

- 文件资产身份由类型与内容 SHA-256 派生，文本身份由不可变文本快照派生。两个节点引用同一资产仍是两个工作流实例，节点身份不由资产身份代替。
- 引用保存 root/相对路径、文件哈希、大小与可用状态。拒绝越界绝对路径、`..`、Windows 盘符/ADS、根外软链接、空文件及超限文件。相同内容的多个路径保留多个引用，相同路径的多个来源保留多个 provenance。
- `freeze` 在配置根内写临时文件、校验完整哈希后原子不覆盖地安装内容寻址文件，冻结后才建立引用。源文件随后替换不改变已创建任务快照。失败可能留下不可被识别为完成结果的孤立临时文件，不能把它们显示为结果。
- `import_legacy_favorites(origin=..., entries=...)` 接受兼容层规范化的显式导入，按 origin/legacy ID 追踪原件及版本。条目字段为 legacy_id、kind、text 或 root/filename、display_name、provenance 和可选 `legacy_raw`。未知旧字段放在 legacy_raw 保留；凭据仍不得导入。
- 同内容跨 origin 去重收藏，不合并不同文本快照；缺失媒体建立可见 missing 记录，不创建空图节点。重复导入不增加实体；同来源身份内容改变时整批拒绝，需明确新来源版本。
- `search` 只查询目录和文本，不解码媒体，支持 kind、分页、中文和字面 `%` / `_`。`export_favorites` 保留原导入来源及数据，在线备份支持恢复。

文件资产层验证引用、边界、大小与内容完整性，不承担媒体转码。生成成功由注入的 `MediaResultValidator` 解码和检查属性；仅扩展名和哈希成功不能作为有效生成输出的产品证据。`temp` 仅在宿主显式配置时可读取，任务输入必须先冻结，临时引用不能充当完成结果。收藏删除保留 tombstone，重复导入不会复活已移除项；旧 localStorage 只作为显式导入的只读来源。迁移与回滚工具另见 `docs/validation/MIGRATION_TOOLING.md`，工具测试不等于实际切换验收。

## 已运行检查与剩余门槛

`python -m unittest discover -s tests/backend -p 'test_*.py' -v` 使用临时数据库和合成内容验证：六进程竞争只有一个 submission claim/假 create；进程在假提供方接受后强退，重启仍 unknown 且无第二次 create；原任务恢复、重复/过期事件、终态、取消归属、输入凭据拒绝、诊断脱敏、SQLite 事务与 schema 迁移故障、冻结失败、缺失/篡改结果拒绝、跨 origin 收藏和备份。

早期 21 项服务测试在实际 ComfyUI Python 3.12.11 解释器通过；后来新增的断言和运行记录保存在对应 `tests/backend`、`tests/unit`、`tests/generation` 与本地 evidence 中。首轮 Windows 测试连接未关闭导致的两项清理失败与修复运行记录留在 `.local/evidence/jobs-assets/`。这些自动测试不调用真实提供方。

关联要求包括 F-SYS-007/008/011/019/020、F-BIZ-029/030/031/032/038，候选 TC 包括 TC-BIZ-021/033/035/036/037、TC-SYS-010/016/017/018/020/021/035。这里只覆盖服务断言，未将整个 TC、M1 或 M4 标为通过。仍需完整前端状态投影复验、实际迁移、人工评审与真实模型验收。
