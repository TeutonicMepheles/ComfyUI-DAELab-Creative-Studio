# 开发指南

本仓库是新功能的编辑入口；无需另外两个业务仓库。当前版本为 `0.1.0-dev.0`，
`main` 用于团队开发。M6 未通过前不发布、不打发布标签、不替换原安装及数据。

## 分支与协作

从最新 `main` 创建分支，经审核及当前提交 CI 后合并：

```powershell
git switch main
git pull --ff-only
git switch -c codex/your-feature
```

先读根及所属目录的 README/AGENTS，再分配文件范围和完成条件。
文档保持简洁、明确、客观；公共规则用链接引用，历史失败保留原记录。
交接注明提交、改动、验证结果、未完成项及证据位置。

## 环境与构建

使用 Node 24、Python 3.12。在独立 ComfyUI 的 Python 环境安装 `requirements.txt`；
Python 测试依赖见 `tests/requirements.txt`。以下命令从仓库根目录执行：

```powershell
npm ci
npm run build
npm run check
```

| 目录 | 职责 |
| --- | --- |
| `frontend/src/` | 前端源码；`web/` 及其文档由构建生成 |
| `backend/`、`compat/` | 后端、宿主接入与旧数据读取 |
| `tests/`、`docs/architecture/` | 回归测试与架构合同 |
| `.local/` | 本机数据、实验及失败证据；不进入 Git 或产品包 |

共享合同变更需同步调用方。ComfyUI 会自动发现 `web/` 中的 JavaScript，新增入口需避免重复注册。
按改动范围验证；每次开发不必重跑完整迁移矩阵或 44 次模型评估。

## 独立宿主与重启

宿主使用独立 user/input/output/temp，只安装本包，不同时加载旧 Canvas 与业务库。
将本仓库链接至 `custom_nodes/ComfyUI-DAELab-Creative-Studio` 后，前端构建可直接被宿主读取。
原 8000 服务保持独立。CPU 模式支持编辑、界面和保存；真实生成需配置本地模型及依赖。

`tools/host/prepare_isolated.py --help` 提供 CPU 快照环境参数。
快照不自动同步源码；停止宿主后用 `--refresh-package` 更新。

前端修改后构建并刷新页面；Python 修改后重启独立宿主。重启前：

1. 原生保存工作流，核对宿主队列和 Studio 账本中的运行及待提交任务。
2. 若有未核对的 submitted/running 或 `result_unverified` 任务，先保存原始 history、输出和身份并完成核对。

ComfyUI 执行 history 位于进程内存，保存工作流不会保存它；重启或重新生成不能代替结果核对。
机器路径、凭据、权重、数据库和生成结果留在本机，Git 只收录可公开的源码、合成夹具与脱敏结论。

## 待完成验收

固定评估已采集 10/44 次；剩余推理、盲评、任务恢复和完整流程待完成。
100 ms 输入预算未通过，真实中文输入法待人工；菜单边界、生命周期及 M6 仍有缺口。
详见 [执行状态](validation/STATUS.md)。
