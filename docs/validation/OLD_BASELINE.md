# 固定旧版行为基线宿主

`tools/host/prepare_baseline.py` 创建两个固定旧包的 CPU 行为基线，供新旧界面和保存合同对照。完整旧库只存在于忽略的本地测试夹具目录，不能进入 Creative Studio 正式包。此环境没有执行模型，不是新的生成基线或产品阶段通过证据。

## 本次就绪状态

旧宿主在 `http://127.0.0.1:8225` 启动，74 个旧后端节点注册齐全；未安装 ComfyTV。运行版本为 ComfyUI 0.39.2、前端 1.53.10、Python 3.12.11、PyTorch 2.8.0+cu129，实际 device 为 cpu，启动后队列为空。

| 包 | 固定提交 | Git archive SHA-256 | 文件数 |
| --- | --- | --- | ---: |
| Canvas | `3176b5a67dbcd0b66f795976e5a81bcdfe346093` | `2c0914cab2a86e6ed48e8ac9780104d9b3ffb59cc51c33621a35133ceec14c1f` | 172 |
| 业务库 | `7ff56cb51ef6f7fc3bcf5707792d655037c61b30` | `0b8cefcb8951157093f55036d4e15010c7a279e9b4f2ccfc629140684b4e81a1` | 913 |

原始归档保存在 `.local/baseline-code/`；完整逐文件哈希保存在 `.local/host-old/prepared.json`。本次启动证据前缀为 `.local/host-old/evidence/1792857914871788000`，分别有 `-start.json`、`-system-stats.json`、`-object-info.json`、`-ready.json`。stdout/stderr 在 `.local/host-old/logs/`。证据只留本地，不作为公开包资源。

Windows venv 启动器 PID 为 129692，实际监听子进程 PID 为 57288；两者已核对同一 `host-old` 命令。这些是本次运行事实，后续操作必须重新核实监听端口及完整命令，不将旧 PID 当永久标识。

已在此宿主通过真实 UI 新建并保存默认表格，确认素材、提示词、生成三列及任务 1–3 三行。保存文件为独立 user 目录中的 `Studio-M0-old-table-default.json`；空内容合成副本及哈希清单位于 `tests/fixtures/workflows/old-default-table.json` 和 `tests/fixtures/manifest.json`。完整三行截图保存在 `.local/baseline/old-table-default-fitted.png`。

历史工作流仅备份到忽略目录，未导入此宿主，也没有导入旧任务回执、启动 Ollama、下载权重或提交生成。两实例、模式、保存重载的完整对照与性能基线仍待执行；已观察到的默认表格行为不能代替其余验收。

## 准备及启动

使用 `.local/baseline/runtime.json` 记录的宿主和 Python，运行：

```powershell
python tools/host/prepare_baseline.py --start
```

默认使用独立 `.local/host-old/` 的 base、user、input、output、temp、models、数据库目录和 8225 端口。脚本只白名单两个旧包，传入 CPU/offline、禁止自动打开浏览器和 telemetry；不加载模型路径配置。现用 8000 与新版 8224/8226 是受保护端口。脚本不修改 `prepare_isolated.py` 或任何已有新版环境。

准备前验证来源 owner/name、固定提交、宿主固定提交及清洁状态；`git archive` 只读取提交，不包含源库未提交文件。检查归档路径穿越、Windows 路径别名、大小上限、大小写冲突、链接与特殊文件后，才解包到拥有标记的隔离目录。

已有目录必须具有完全匹配的 ownership 标记。完整旧夹具只能按全部文件哈希复核后复用；没有自动更新、覆盖或清理。未完成夹具、改动后的代码、占用端口和配置不符均拒绝启动，保留现场。启动日志和每次运行报告使用新文件保存。

`--offline` 约束 ComfyUI 前端和 partner 节点，不是整个 Python 进程的网络防火墙。本夹具只用于无生成的基线检查；不要在其中点击生成、安装本地模型或恢复旧任务。真实模型 Eval 需另行建立受控执行环境与共享资源协调。

## 工具验证

```powershell
python -m unittest discover -s tests/host -p 'test_baseline_isolation.py' -v
```

8 项边界测试在实际 Python 3.12.11 通过，覆盖保护路径/端口、来源提交与 owner、未提交数据隔离、ZIP 路径与链接、不可覆盖、命令白名单和启动前重检。首轮 Windows ZIP 测试夹具被标准库规范化导致的失败以及修复后完整日志保存在 `.local/host-old/evidence/harness-*`。它们是隔离工具证据，不是产品 UI 验收。
