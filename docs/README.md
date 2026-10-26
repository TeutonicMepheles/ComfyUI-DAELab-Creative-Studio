# 文档索引

| 入口 | 作为何种依据 |
| --- | --- |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 新同事与 Agent 的编辑、构建、独立宿主和协作流程 |
| [architecture](architecture/README.md) | 当前模块所有权、原生编辑、任务资产及交互合同 |
| [migration-blueprint](migration-blueprint/README.md) | 功能决策、用例、固定夹具和 M0–M6 规格，不代表通过 |
| [validation](validation/README.md) | 已执行证据、首个失败、当前缺口和发布门槛 |
| [provenance](provenance/README.md) | 来源提交、原件哈希与第三方许可 |
| [adapter-contract.md](adapter-contract.md) | 跨模块公开 adapter API |
| [task-contract.md](task-contract.md) / [material-groups.md](material-groups.md) | 任务展示与素材交换合同 |

更新顺序：实现归属模块 → 对应合同/模块 README → 实际验证记录。不要用计划、模拟或构建结果替代真实验收。

规格校验：`node docs/migration-blueprint/render_catalog.mjs --check`；追踪校验：`node tools/evals/traceability.mjs --check`。
