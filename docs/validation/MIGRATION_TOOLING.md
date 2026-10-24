# 离线迁移准备与只读兼容工具

本工具提前实现 M6 的数据保全与故障检查。它只在新建、带所有权标记的目录生成隔离副本；没有启停服务、重命名安装目录、修改 8000 用户环境、调用模型、提交或恢复任务的入口。`snapshot_complete` / `rollback_copy_complete` 仅表示副本完成，`activationAllowed` 始终为 `false`，不能据此宣布 M6 或产品迁移通过。

## 使用入口

在新仓库根目录使用实际 Python 运行：

```powershell
& 'C:\Users\Golajah\Documents\ComfyUI\.venv\Scripts\python.exe' -m tools.migration init C:\MigrationFixture\owned-workspace
& 'C:\Users\Golajah\Documents\ComfyUI\.venv\Scripts\python.exe' -m tools.migration preflight C:\MigrationFixture\plan.json
& 'C:\Users\Golajah\Documents\ComfyUI\.venv\Scripts\python.exe' -m tools.migration migrate C:\MigrationFixture\plan.json
& 'C:\Users\Golajah\Documents\ComfyUI\.venv\Scripts\python.exe' -m tools.migration rollback C:\MigrationFixture\owned-workspace fixture-v1
```

以上路径是示例，测试只使用临时合成数据。`init` 只接受不存在的新目录，父目录必须存在；现有空目录也不自动认领。`preflight` 不写源目录、目标目录或数据库，返回 JSON 报告；有切换阻断或复制安全错误时退出码为 2。其他错误退出码为 1，正常完成为 0。报告仅含路径、身份、状态、数量、哈希和原因，不包含提示词、结果正文、连接配置或凭据值。

计划格式 v1：

```json
{
  "schemaVersion": 1,
  "migrationId": "fixture-v1",
  "sourceRoot": "C:\\MigrationFixture\\offline-source",
  "workspaceRoot": "C:\\MigrationFixture\\owned-workspace",
  "files": [
    {"path": "workflows/graph.json", "kind": "workflow"},
    {"path": "input/picture.png", "kind": "media"},
    {"path": "receipts/table.json", "kind": "receipt-json"}
  ],
  "versions": {
    "canvas": "3176b5a67dbcd0b66f795976e5a81bcdfe346093",
    "business": "7ff56cb51ef6f7fc3bcf5707792d655037c61b30",
    "comfyui": "0.39.2"
  },
  "quiesced": true,
  "unpersistedTasks": 0,
  "recoveryPlans": [],
  "customNodeRoots": ["C:\\MigrationFixture\\custom_nodes"],
  "newPackageRoot": "C:\\MigrationFixture\\custom_nodes\\ComfyUI-DAELab-Creative-Studio"
}
```

所有源文件必须逐一分类，未列文件、新增文件、重复路径或大小写冲突均拒绝。路径使用正斜线相对路径，不接受绝对路径、`..`、反斜线、NTFS 数据流、设备名、软链接、junction 或硬链接。源目录与工作区不得相互包含。支持 `workflow`、`receipt-json`、`receipt-sqlite`、`product-sqlite`、`media`、`config`、`favorites`；媒体扩展名有白名单，配置必须是可检查 JSON。工作流内嵌的 material/widget JSON 也检查敏感键。

`versions` 是快照操作者声明的版本，不替代 Git/source manifest 证据；实际切换前仍需核对固定源码、宿主及资源指纹。`quiesced` 和 `unpersistedTasks` 也是离线快照前提声明，工具不探测或关闭现用进程。未提供安装扫描位置时，会报告“安装冲突尚未检查”，不会声称可切换。安装预检复用产品 `detect_conflicts()`，只读列出启用的旧包及可识别的改名重复安装。

## 提交边界与数据归属

`owned-workspace/<migrationId>/` 包含：

| 产物 | 含义 |
| --- | --- |
| `manifest.json` | 工具/工作区/迁移身份、计划与源清单，版本为 1 |
| `backup/` | 原始文件逐字节备份，SHA-256 与大小逐项核验 |
| `BACKUP_COMPLETE.json` | 完整备份的清单哈希，完成后才复制工作副本 |
| `working/` | 独立原生文件副本，保持相对路径，不修改节点/字段/连线/素材 JSON |
| `report.json` | 未知节点、只读类型、缺失或变更媒体、旧任务身份及阻断项 |
| `COMPLETE.json` | 所有文件与源快照再次核对后最后发布的完成标记 |

原生工作流依然是编辑权威；没有建立第二份可写图模型。工作副本只在单独的隔离宿主明确打开后才成为编辑文件。未知类型/字段、输入输出索引、widget 顺序、组顺序、连线、`daelabCreativeCanvasV1` 和 material 字符串保持原始字节；未知节点可见报告，绝不静默删节点或重连。

迁移期间没有任务或资产 SQL 写入，不把历史记录转换成新的 `pending` 任务，不猜测 provider 或补造 requestId。现有产品 SQLite 只作为完整数据库副本保全；旧优化 `objects(kind,id,body)` SQLite 读取其 batch，旧生成 JSON 保留原件和只读投影。来源 schema 未知、损坏 JSON、未检查数据库、敏感键或未 checkpoint 的 WAL/journal 会拒绝自动复制；原件留在源目录并报告。已解析但版本未知的 JSON 可保全为待审查档案，不能算导入成功。内存任务无持久记录时明确阻断，不能重建其成功事实。

已有资产库读取产品 v1–v3 的文件引用，与 `input/`、`output/` 下快照文件及 SHA-256 对照；其他 root 明确列为未映射。不会改写绝对路径来猜测素材位置。收藏 JSON 只保全；实际收藏导入继续使用现有 `AssetAPI` / `AssetCatalog` 的显式导入合同，保持 origin、去重与取消收藏 tombstone 语义。工具不另造资产数据库或旧任务执行引擎。

在途任务默认阻止切换。有明确 provider 和 providerTaskId 的非退役远端记录，可在 `recoveryPlans` 中记录同一 `requestId` / `provider` / `providerTaskId` 与 `action: "query_original_only"`。这只是外部核对计划，工具不执行它。LibTV/旧 GPT、缺身份、未知 schema、本地在途及未持久内存任务仍阻断，绝不自动重投。

## 中断、重复与回滚

同一 migrationId 必须对应同一计划、源清单和工作区身份。完整或部分已复制文件只在哈希一致时复用；现有不一致文件拒绝替换。OS 进程锁防止两个进程同时写同一迁移，进程退出自动释放锁；不把残留锁文件当成活动进程。

文件和元数据先写确定身份的 `.part-<sha256>`，flush/fsync 后独占发布。已知部分文件只在内容与固定源的前缀一致时续写；发布链接后崩溃也能恢复。未知 `.part` 或无可恢复所有权清单的目录拒绝认领。新建空目录后、首个所有权字节写入前崩溃会留下无法认领的空目录，须保留并选择新的迁移 ID；工具不会删除它。完成标记出现前，副本不可用作已完成迁移。电源断电与文件系统损坏不在本轮测试证据范围。

工作副本产生新数据后，再运行原迁移命令会拒绝不一致目标；请使用回滚保全入口。回滚流程：

1. 核对原 manifest、备份完整标记及每个备份文件哈希。
2. 对当前 `working/` 的全部新旧文件生成新清单，复制到 `rollback/preserved-new/`，逐项核验，再发布 `NEW_DATA_PRESERVED.json`。
3. 从完整备份复制到独立的 `rollback/restored-old/`，保留源及当前 working 不变。
4. 再次核对新数据未变化，最后发布回滚完成标记。中断可重复同一命令；若保全后新数据又变化则拒绝继续，不覆盖之前保全包。

恢复产物供之后明确安排的隔离宿主演练使用。实际停用新包、恢复旧代码基线、切换数据目录及启动旧版不由此工具执行；仅回退 Git 仍不算数据回滚。

## 六类型与历史回执合同

`compat.workflows.read_compat_node(node)` 返回深复制的原始属性和只读说明。六类型为 GPTImageStoryboardStage、StoryboardBatch 及 LLMStylePreview A/C/D/E，稳定完整 ID 见 `compat/workflows/reader.py`。`readonly_node_mappings()` 现返回按固定旧源核对的 2 个 deprecated 原生 schema，另外 4 个维持前端 virtual 注册；没有 import 注册副作用，`VALIDATE_INPUTS` 与 `execute` 都拒绝执行。原生槽位和 widget 顺序、旧 GPT 14-input 与末尾可选 imported_storyboard 的策略见 [只读宿主适配合同](../../compat/workflows/README.md)。宿主装配与实际验收应分别记录，原始 JSON 字节保全不依赖注册。

`compat.receipts.read_receipt(document)` 可查看完整历史结果及原字段，但 `canResume` / `canSubmit` 恒为 false。没有 CLI、网络、Comfy 队列或 provider 端口。GPT 显式转换的预览、确认与原生事务适配已准备：只追加表格副本，保留原节点/连线，不自动替换、重接或运行；真实宿主与用户迁移验收仍待完成。

格式依据来自固定业务提交 [表格回执](https://github.com/TeutonicMepheles/ComfyUI-DAELab-Custom-Nodes-Library/blob/7ff56cb51ef6f7fc3bcf5707792d655037c61b30/nodes/libtv_bridge/table_generation_api.py)、[LibTV 历史缓存](https://github.com/TeutonicMepheles/ComfyUI-DAELab-Custom-Nodes-Library/blob/7ff56cb51ef6f7fc3bcf5707792d655037c61b30/nodes/libtv_bridge/runtime.py)、[优化 SQLite](https://github.com/TeutonicMepheles/ComfyUI-DAELab-Custom-Nodes-Library/blob/7ff56cb51ef6f7fc3bcf5707792d655037c61b30/nodes/prompt_optimization/service.py) 与本库 [节点盘点](../migration-blueprint/NODE_INVENTORY.md)。实现为独立只读适配，不导入旧源码运行时。消费方是迁移工具；删除条件是明确取消该格式支持且所有保留原件已验证导出，不按日期自动删除兼容。

## 验证记录与未验收项

关联：F-SYS-013/014/015/021（对应 AC-SYS-013-001、014-001、015-001、021-001），F-BIZ-030/037/038（其全部 AC），UC-SYS-005/006/011、UC-BIZ-011/015；相关 TC-SYS-008/009/011–015、TC-BIZ-034/043/044/050，主要证据族 EV-DATA、EV-JOBS、EV-ARCH。以下只是这些 TC 的工具层支撑，没有修改 catalog 的验收状态。

实际命令：`python -m unittest discover -s tests/migration -v`，使用宿主 Python 3.12.11。合成夹具覆盖逐字节往返、六类型拒绝执行、重复迁移、原任务身份、旧 JSON/优化 SQLite/产品 SQLite、敏感嵌套 JSON、媒体引用哈希、冲突安装、路径越界、真实 Windows junction、真实子进程强制退出、双进程竞争、部分文件/元数据恢复、回滚先保全和不一致拒绝。

首次运行 21 项：18 通过、2 错误、1 跳过。两项错误来自测试夹具的 SQLite 上下文只提交事务而未关闭连接，导致 Windows 临时目录清理失败；改为显式 close。系统禁止创建普通 symlink，改用实际 Windows junction 执行同一越界用例，后续无跳过。之后 23、26、27 项全部通过；最终迁移工具 **28/28 通过，无跳过**，额外验证未知状态结构及历史 `stopped` 不被当成确认终态。同轮 `tests/backend` **39/39**、`tests/review_backend` **6/6** 通过，架构检查通过（128 个前端模块）。保留该首次失败事实；这些数量不代表上述产品 TC 已完整执行。

随后只读宿主能力准备增加了固定源 schema、无编辑序列化、14/15 输入与 widget 顺序、预览确认、单原生事务 undo/redo、子图队列保护和 provenance 校验：迁移 Python **33/33**、兼容前端 **13/13**，无跳过；类型检查和架构检查（130 个模块）通过。新增前端首次 8/10、第二次 12/13 的失败原因和修复见只读适配合同；未把失败记录覆盖成首次全通过。

仍需：历史真实金样及凭据边界审查；完整资产/任务导入与 UI 显式转换的真实验收；六类型真实宿主保留槽位/连线的读取与保存；新旧代码、环境及在途身份外部核对；隔离宿主真实切换/重载/回滚；清洁安装、支持版本矩阵、M4/M5 生成和完整流程，以及全部适用累计 P0/P1。不能以这些合成测试替代这些验收。
