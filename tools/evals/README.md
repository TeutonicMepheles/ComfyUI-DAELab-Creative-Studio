# 固定本地模型评估工具

冻结旧/新请求并核对固定输入、预处理和执行证据，维护任务到验收的追踪关系。

源码入口：prepare_local_inputs.py、prepare_studio_inputs.py：离线输入捕获；request_contract.py：请求比较；capture_h3_preprocessing.py：CPU 预处理；local_runtime_hooks.py：受约束运行观测；run_local_evaluation.py、local_batch.mjs：批次和槽位；traceability.mjs：追踪检查。

协作边界：固定模型、样例、顺序、哈希和失败记录构成比较依据。离线准备、真实推理和人工盲评分别留证；运行准入依赖独立宿主和登记清单。

`local_continuation.py` 支持固定 44 槽位评估的受限续跑：已完成部分必须是连续的成对前缀，紧接的失败必须有派发前数值表示比较拒绝的证据，且仅允许已审查的评估工具变更。产品文件、模型、宿主配置和固定输入必须保持一致。原结果只按原身份引用；新运行使用全新身份，已继承槽位不能再次执行或 arm。

离线 `python -m tools.evals.run_local_evaluation prepare` 可追加 `--continuation-review <JSON>`。该文件包含 `schemaVersion: 1`、与 approval 一致的 `reviewer`、带绝对路径和 SHA-256 的 `parentRun`、`completedPrefix`、`blockedSlot`、`blockedTraceRoot` 和 `reviewedChanges`；每项变更记录 `path`、`beforeSha256`、`afterSha256`、`reason`，新增或删除侧的哈希为 null。准备会写入并固定 `continuation.json`，不执行推理。执行仍需既有审批和 `--execute-reviewed`；不支持连续继承多个运行，也不授予产品验收结论。

下述命令均从仓库根目录执行；依赖准备见 docs/DEVELOPMENT.md。

```powershell
python -m unittest discover -s tests/evals -p "test_*.py" -v
node tools/evals/traceability.mjs --check
```

