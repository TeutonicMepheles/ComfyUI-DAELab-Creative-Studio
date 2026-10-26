# 迁移规格数据

`canvas.json`、`business.json`、`system.json`、`exclusions.json` 保存功能 F、用例 UC 和测试 TC 的权威定义，包含 AC 关联、来源、阶段及执行政策。

修改保持既有 ID 和引用闭合；执行 `node docs/migration-blueprint/render_catalog.mjs --write` 更新派生表，再运行 `--check` 与 `node tools/evals/traceability.mjs --check`。实际通过/失败记录属于 `docs/validation/` 及本地原始证据。
