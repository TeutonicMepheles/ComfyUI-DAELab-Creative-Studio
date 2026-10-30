# 验证与未完成项

先读 [STATUS.md](STATUS.md) 的最新记录；历史段落保留当时的失败和限制。`main` 可作为开发基线，M6 未通过仍禁止正式发布和替换原安装。

2026-10-29：[PR #12 修复验证](PR12_REVIEW_20261029.md) 记录任务归档、旧表格 LLM 兼容性、测试更新及隔离宿主检查。

2026-10-29：[表格性能整合](TABLE_PERFORMANCE_INTEGRATION_20261029.md) 记录行窗口化、原生历史快照复用、隔离宿主检查和同夹具比较。

| 文件组 | 用途 |
| --- | --- |
| `EXECUTION_PLAN.md`、`catalog/` | 任务、F/AC/UC/TC/EV 关联与证据格式 |
| `BASELINE_ENVIRONMENT.md`、`OLD_BASELINE.md` | 固定宿主与旧版本参考条件 |
| `LOCAL_EVAL_*`、`STUDIO_EVAL_PREPARATION.md` | 固定本地模型输入、运行与恢复协议 |
| `PERFORMANCE_*` | 性能登记条件、原始失败与诊断局限 |
| `M6_DATA_PROFILES.md`、`MIGRATION_TOOLING.md`、`RELEASE_PREPARATION.md` | 数据迁移、回滚及候选包检查 |
| `M1_INITIAL_HOST_SMOKE.md`、`OPTIONAL_COMFYTV_CPU.md`、`DETERMINISTIC_GENERATION_FIXTURE.md` | 有界宿主/可选组合/确定性替身检查 |

公开文档只保存脱敏结论与原件索引；本机工作流、原视频、数据库和完整日志位于忽略的 `.local/`。同夹具复测追加证据，不删除首次失败，不选择最好输出作为唯一结果。

验证追踪：`node tools/evals/traceability.mjs --check`。该命令只检查资料结构，不授予产品通过状态。

2026-10-29：[工作流历史初始化修复](HISTORY_LIFECYCLE_20261029.md) 记录已复现的加载竞态、延迟安装及隔离环境回归。

2026-10-30：[生成节点 Slot 素材统一](GENERATION_SLOT_MATERIALS_20261030.md) 记录重复素材修复、首尾帧选择、独立与表格接入测试及本地模型限制。
2026-10-30：[剧本四列与章节拆表](SCRIPT_PARTITIONS_20261030.md) 记录每表 10 行、来源与手改保护、原子导入和隔离宿主验收。
2026-10-30：[生成输出占位](GENERATION_OUTPUTS_20261030.md) 记录自动连线、状态回填、批量组输出及隔离宿主模拟验收。
