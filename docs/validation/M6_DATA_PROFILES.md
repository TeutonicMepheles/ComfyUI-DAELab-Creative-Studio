# M6 隔离数据 profile 合同

工具准备并选择带所有权标记的完整 `user/input/output` 数据根。`profile_selected` 是供操作者读取的启动描述符，**不表示运行宿主已经切换或验收通过**。工具不启停进程、不修改安装目录、不调用模型、不提交或恢复任务。所有写入只进入新建 owned workspace 的 profiles、preservations 和 activation；原件不会删除或覆盖。

## 显式物化与代码身份

先按 [迁移准备](MIGRATION_TOOLING.md) 执行 `init → preflight → migrate`。profile 准备要求完整快照且 `switchPreflightClear=true`。每个源文件都必须映射一次；拒绝遗漏、重复、大小写冲突、越界。input/output 必须保留原根和相对路径。旧、新 profile 各有独立的三个目录，空根也保留。

`prepare-profiles` 读取以下计划结构。路径与 commit 均为示例占位符，不能直接作为用户环境执行：

```json
{
  "schemaVersion": 1,
  "workspaceRoot": "B:/explicit-new-owned-workspace",
  "migrationId": "reviewed-snapshot",
  "setId": "round-1",
  "mapping": [
    {"source": "workflows/example.json", "root": "user", "path": "default/workflows/example.json"},
    {"source": "input/example.png", "root": "input", "path": "example.png"},
    {"source": "output/result.png", "root": "output", "path": "result.png"}
  ],
  "oldPackage": {
    "kind": "legacy",
    "installationRoot": "B:/explicit-isolated-old-installation",
    "roots": {
      "canvas": "B:/explicit-isolated-old-installation/custom_nodes/ComfyUI-DAELab-Creative-Canvas",
      "business": "B:/explicit-isolated-old-installation/custom_nodes/ComfyUI-DAELab-Custom-Nodes-Library"
    },
    "commits": {
      "canvas": "3176b5a67dbcd0b66f795976e5a81bcdfe346093",
      "business": "7ff56cb51ef6f7fc3bcf5707792d655037c61b30"
    }
  },
  "newPackage": {
    "kind": "studio",
    "installationRoot": "B:/explicit-isolated-new-installation",
    "root": "B:/explicit-isolated-new-installation/custom_nodes/ComfyUI-DAELab-Creative-Studio",
    "commit": "<exact 40-character candidate commit>"
  }
}
```

旧代码要求 baseline 准备器生成的 prepared.json、两份原 Git ZIP、固定 commit 与逐文件 SHA；核对 ZIP commit comment、归档内容与安装字节。新代码要求解压后的候选目录带 release-candidate.json，commit、build ID 与全部文件相符。旧环境允许两旧包及明确绑定的零节点 `StudioMigration.LegacyProbe`；新环境允许单新包及同一显式迁移探针。`oldPackage.observer` 和 `newPackage.observer` 均使用 `{"root":"<探针目录绝对路径>"}`，必须对应审核过的 tools/migration/legacy_probe 三个文件及 manifest。发行包CLI使用内置受审摘要核验显式安装的探针，不依赖旁置源码；探针实现不进入发行包，清洁单包验收另在不装探针的环境执行。原业务实现字节固定，不能混入另一业务实现或测试执行器。

```powershell
& $Python -m tools.migration prepare-profiles $ProfilePlan
& $Python -m tools.migration activate-profile $Workspace initial-old round-1-old --expected-sequence 0
& $Python -m tools.migration active-profile $Workspace
```

READY 后重复 prepare-profiles 只核对，不再补缺失文件或覆盖变化；两 profile 都预检后才写未完成副本。只有同一 manifest、未 READY、未选择过且无活进程绑定的目录可以中断续写。首次从未被选择的 profile 只有完整 inventory 与初始快照相同、无进程绑定数据根才允许离线选择。运行过或已被选择过的 profile 不能再走这一捷径。描述符是 OS 进程锁保护的追加日志，含前一条 SHA、序号、操作 ID、完整 profile/包/数据身份。`--expected-sequence` 是 CAS；同一请求/操作 ID 可重试，修改请求拒绝。中断不会发布半个选择。

## 运行与直接采集的关闭证据

工具需要操作者 Python 可导入 psutil；无法验证目标进程则拒绝。观察只向显式 PID 实际拥有的 loopback 端口发 GET，拒绝 8000、代理与重定向。进程创建时间、三根/base 参数、有效 database-url、包 build、空原生队列和相同数据 inventory 一起绑定。显式宿主数据库必须是 profile user/comfyui.db；默认按固定宿主 user 根推导。仅数据库路径重叠的活进程也会阻断。只记录命令行哈希，不记录原始命令行。Windows venv 启动器可能不是实际监听 PID，必须传实际监听者。

操作者启动时读取活动描述符的精确映射。以下模板不代替已审核的隔离宿主参数；必须继续使用相应插件白名单、禁网/禁自动下载及固定宿主/Python：

```powershell
$Selection = (& $Python -m tools.migration active-profile $Workspace | ConvertFrom-Json)
$Install = $Selection.package.spec.installationRoot
$ComfyDatabase = 'sqlite:///' + (($Selection.roots.user + '/comfyui.db') -replace '\\','/')
& $Python -s (Join-Path $HostRoot 'main.py') `
  --base-directory $Install --user-directory $Selection.roots.user `
  --input-directory $Selection.roots.input --output-directory $Selection.roots.output `
  --temp-directory (Join-Path $Install 'temp') --database-url $ComfyDatabase `
  --listen 127.0.0.1 --port $Port --cpu
```

启动后另核对节点列表、实际加载包/build、图和素材。先保存并结束交互；显式 fence-profile 单调关闭审核过的新或旧宿主任务/变更入口，再观察已有工作为空；操作者正常停止明确隔离宿主后 seal。fence 不取消任务、不解除自身、不停止进程；GET mutation、新 WS 和旧内部生产者都必须有覆盖证明，未知覆盖拒绝。工具不自动发 fence 或停止信号：

```powershell
& $Python -m tools.migration fence-profile $Workspace round-1-old --pid $ActualListenerPid --port $Port
$Observed = (& $Python -m tools.migration observe-profile $Workspace round-1-old --pid $ActualListenerPid --port $Port | ConvertFrom-Json)
# 操作者正常退出该明确隔离宿主。
$OldSeal = (& $Python -m tools.migration seal-profile $Workspace round-1-old $Observed.observationId | ConvertFrom-Json)
& $Python -m tools.migration activate-profile $Workspace select-new round-1-new --expected-sequence 1 --current-seal $OldSeal.sealId
```

观察有效期 300 秒。观察后数据改变、PID 未退出、另有进程绑定/重叠三根、代码改变或序号不符均拒绝。目录检查覆盖 split/equals、Python 参数的无歧义缩写、进程 cwd 下相对路径、Win32 扩展盘符/UNC 别名，以及宿主从 base 推导缺省目录。未知设备路径拒绝；其他程序的 `--database` 不当成 ComfyUI 的参数缩写。手填 quiesced=true 不能替代这些证据。

SQLite 在 fence 后通过只读连接取得包含已提交 WAL 的一致快照，完整比较 schema、所有表/列/行、值类型、BLOB、ID、时间与 JSON 原文；不忽略业务元数据。原始文件清单和完整逻辑摘要同时保留。正常退出时仅物理 checkpoint/sidecar 删除可以保持逻辑相等；seal 仍要求无残留 sidecar、支持的 schema 和完整离线任务检查，真实行变化照样拒绝。工具不执行 checkpoint，不改源 journal mode。在线只读连接参与 SQLite 既有共享锁；有 WAL 而没有 runtime 已创建的 SHM 时拒绝，避免观察器创建新伴随文件。

持久任务检查覆盖列表、rows、嵌套 JSON、序列化字符串和工作流 widgets。非终态仅允许准确原 request/provider/providerTaskId 的受支持远端只读查询计划；退役通道、本地/媒体、未知身份均阻断。原生 queue 不是旧业务内存 worker 的完整注册表，不能把进程退出当成未持久化任务完成；旧角色额外核对原内存状态，新角色核对候选/账本/队列，两者都必须具备同进程单调入口 fence。任何未知覆盖都保持切换阻断。

旧 profile 在新副本物化后又编辑或产生文件时，旧→新选择会拒绝陈旧副本。需固定新的完整离线快照，以新的 migration ID/profile set 显式物化。选择新 set 时核对其完整初始数据及配对旧包身份与当前旧 seal 一致，之后回滚选该新 set 的旧备份；不会自动合并、覆盖或遗漏旧编辑。

## 保全当前活动新数据再回滚

新版本运行后也必须显式执行 `fence-profile ... round-1-new`，然后观察/停止/seal 得到 `$NewSeal`；产品账本不能替代对任意原生 `/prompt` 内存任务的入口封锁。旧目标也必须符合其原 seal；旧 profile 又运行过则需新证据。

```powershell
& $Python -m tools.migration rollback-profile $Workspace return-old round-1-old `
  --expected-sequence 2 --current-seal $NewSeal.sealId --target-seal $OldSeal.sealId
```

顺序为：核对当前 active 与两 profile 关闭证据 → 从实际新 user/input/output 保全所有文件到 preservations/return-old/data → 发布保全完成标记 → 再核对新旧数据 → 原子追加旧 profile 选择。新 profile 原位保留；旧 profile 不被新 schema 覆写；不会从陈旧 working 目录取新数据。新→旧只能走 rollback-profile，不能用 activate 绕过保全。

中断后用相同参数恢复；只复用哈希一致文件。保全后数据变化会拒绝且保留之前的保全包。随后实际启动旧代码、UI 打开/保存/重载与引用验证仍由操作者执行。

## 固定宿主数据库与未验收边界

源分类 host-sqlite 与 profile 的 user/comfyui.db 仅支持固定宿主 `3c1b7a17fdf239d35ce98cc777756f572d089795`、Alembic `0008_drop_asset_meta` 资产 schema。只读检查完整性、表/列/FK/index/约束、版本、敏感 JSON、sidecar、路径与大小；不升级、降级或 checkpoint 原数据库。

仅新建的 owned profile 数据库副本可转换 `asset_contents.path` 和绝对 `assets.loader_path`。每个原路径必须精确映射到已核对源文件，SHA/大小与备份相同，再映射各自 old/new 的 user/input/output 根。源、backup、working 原字节保持不变。profile marker 的 transformations 保存逐项 before/after、原/新 DB SHA、完整性、记录数、源文件 SHA 及非路径元数据摘要。两 profile 的逻辑比较仅将这两个路径列规范为 root 类型加相对路径；未知 JSON、ID、时间、NULL 和所有其他列都保留。外部未知路径、缺映射、缺文件或 source 内容变化仍阻断。

从已密封旧 profile 复制源数据时，迁移计划可声明完整 `referenceRoots: {user,input,output}`，把 DB 中仍指向旧 profile 的绝对路径与新 source 副本逐文件核对；这不是允许猜测外部位置。`prepare_e5 capture` 自动产生这一精确绑定。

schema 合成夹具由固定 Git blob 的实际 0001→0008 Alembic 链在内存 SQLite 生成，保留来源 SHA，无用户行和宿主服务。宿主资产元数据不被当成生成账本。

工具检查使用合成包/数据和假接口或新建无模型 HTTP 子进程；真实候选、旧金样、任务/收藏导入、实际切换/回滚 UI、支持矩阵和累计 M6 门禁需独立证据。副本演练的 Windows 临时长文件名首次失败已保留；短 sibling 临时名仍校验完整 SHA/内容，并支持恢复旧 .part 文件。没有调整系统路径策略或重命名用户源文件。

## E5 实际隔离运行准备入口

在审核的源码仓库运行 `python -m tools.migration.prepare_e5`，CLI 目标必须是该仓库 `.local` 下尚不存在的目录。该准备器与 runtime probe 都不进入发行包。`seed` 创建新的 source 和 owned workspace，生成两个显式计划，不启停服务、不选择 profile；`capture` 只接受当前 active、已 seal、进程已退出的 old profile，完整复制三根后生成新的 migration/profile set 计划。写入前拒绝与绑定安装/代码目录、原 workspace/profile/三数据根重叠；已有目标一律拒绝，部分失败原件留下待审查。核心 migrate/prepare-profiles 负责相同请求的中断恢复。

先准备全新独立安装。旧版使用现有 `tools/host/prepare_baseline.py --runtime <固定runtime.json> --environment-root <新OldInstall> --archive-root <新ArchiveRoot> --port <专用端口>`，不传 `--start` 或 performance observer。新版用 `tools/release/package_candidate.py --revision <固定40位commit> --output <新ZIP>` 生成审核候选，再解压到新 NewInstall/custom_nodes；不得复用带 performance observer 的 8225 安装。仅将 `tools/migration/legacy_probe` 的三个文件显式复制到两个安装各自 custom_nodes/StudioMigration.LegacyProbe。绑定文件使用前文 oldPackage/newPackage 对象，均声明 observer.root；旧 prepared.json 与 Git ZIP 仍保留。

准备器生成非空原生资产 DB：2 个 content、2 个 asset、标签、未知 metadata，路径分别指向实际可解码合成 PNG 与既有合成 MP4；另含文本/图片/视频 3 项旧收藏目录，以及保留 root/node/extensions 未知字段冲突的原生工作流。没有旧回执、模型、缓存、凭据或真实用户数据。未知节点类型仍按预检要求报告阻断，不能用这个已知节点夹具冒充全部未知节点验收。

```powershell
# $SeedRoot 必须不存在；$Bindings 是完整 oldPackage/newPackage JSON。
& $Python -m tools.migration.prepare_e5 seed --root $SeedRoot --bindings $Bindings
$MigrationPlan = Join-Path $SeedRoot 'migration-plan.json'
$ProfilePlan = Join-Path $SeedRoot 'profile-plan.json'
$Workspace = Join-Path $SeedRoot 'workspace'
& $Python -m tools.migration preflight $MigrationPlan
& $Python -m tools.migration migrate $MigrationPlan
& $Python -m tools.migration migrate $MigrationPlan
& $Python -m tools.migration prepare-profiles $ProfilePlan
& $Python -m tools.migration prepare-profiles $ProfilePlan
& $Python -m tools.migration activate-profile $Workspace initial-old round1-old --expected-sequence 0
```

启动模板必须加入 `--offline --disable-auto-launch --disable-all-custom-nodes --whitelist-custom-nodes`：旧版白名单是两个固定包名和 StudioMigration.LegacyProbe，新版是 ComfyUI-DAELab-Creative-Studio 和 StudioMigration.LegacyProbe；并加 `--feature-flag enable_telemetry=false`。主源/Python 固定，base 是相应 installationRoot，三数据根必须取 active-profile 结果，数据库显式指向其 user/comfyui.db。`--offline` 不是系统级网络防火墙，不能用它宣称网络隔离已验收。初次真实启动还要检查 probe 覆盖和已加载包身份；任何 unknown 先定位，不能手填证据。

旧 UI 打开/编辑/保存后，按前文 fence→observe→正常停止→seal 得到 OldSeal。由于旧 UI 可能产生宿主设置/资产记录，不能假设 round1-new 仍是最新副本。固定实际旧数据，再明确制备 round2：

```powershell
& $Python -m tools.migration.prepare_e5 capture --root $CapturedRoot --bindings $Bindings `
  --workspace $Workspace --profile round1-old --seal $OldSeal.sealId `
  --migration-id after-old-ui --set-id round2
& $Python -m tools.migration preflight (Join-Path $CapturedRoot 'migration-plan.json')
& $Python -m tools.migration migrate (Join-Path $CapturedRoot 'migration-plan.json')
& $Python -m tools.migration prepare-profiles (Join-Path $CapturedRoot 'profile-plan.json')
& $Python -m tools.migration activate-profile $Workspace select-new round2-new `
  --expected-sequence 1 --current-seal $OldSeal.sealId
```

新版 UI 从 user/imports/legacy-favorites.json 显式导入旧收藏（记录确切旧 origin），验证三项与重复导入；保存/重载未知字段，使用既有媒体并新增/编辑合成文件。完成新版 fence→observe→正常停止→seal 后，回滚目标是 round2-old（最新已核对旧数据副本），它从未运行所以不传 target-seal：

```powershell
& $Python -m tools.migration rollback-profile $Workspace return-old round2-old `
  --expected-sequence 2 --current-seal $NewSeal.sealId
& $Python -m tools.migration rollback-profile $Workspace return-old round2-old `
  --expected-sequence 2 --current-seal $NewSeal.sealId
```

保留 SeedRoot/PREPARED.json 的原件清单、CapturedRoot/PREPARED.json 的已密封旧清单、两组 profile transformations、runtime/seal/journal、preservations/return-old 的完整清单与首次错误。原件/backup 应逐字节相同；新旧 DB 的预期路径差异用转换 manifest 与完整 logical inventory 验证；preservation 必须与真正 active 新 profile 的停机字节清单相同。最后实际启动 round2-old、打开/重载并核对 UI/引用，才形成真实切换/回滚证据。
