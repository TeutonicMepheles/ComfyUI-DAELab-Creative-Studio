# DAELab Creative Studio for ComfyUI

单仓库开发基线已合入 `main`，可在隔离 ComfyUI 中安装、使用和继续开发。正式发布验收尚未完成，当前版本不替换现用旧包。
本项目继续使用 ComfyUI 原生工作流和执行队列。

Studio 提供素材与资产库、表格和分镜、提示词、生成任务、剪辑导出及统一创作画布。安装开发版不需要旧 Canvas 或业务库；请保留现用环境，在独立 ComfyUI 中使用。

| 使用入口 | 内容 |
| --- | --- |
| [安装](docs/INSTALLATION.md) | 独立环境、Python 依赖与单包启动 |
| [首次使用](docs/USAGE.md) | 打开创作画布、安装合成素材、编辑与保存 Showcase |
| [模型配置](docs/MODELS.md) | 实际本地配置字段、固定模型与能力检查 |
| [排错](docs/TROUBLESHOOTING.md) | 冲突、构建身份、素材、任务恢复和预览问题 |
| [表格独立开发](dev/table/README.md) | `npm run dev:table`、定向与浏览器测试 |

日常功能开发统一在本仓库进行，入口见 [开发指南](docs/DEVELOPMENT.md)。
开发交接与 M6 发布验收分别记录；未完成的发布验收不阻止在隔离环境继续开发。

现有功能的可编辑展示工程见 [Creative Studio Showcase](Showcase/README.md)，附示例素材与逐项确认清单。

## 当前进度（2026-10-27）

表格模块化 T0–T4 与开发文档已合并：公共入口、实例生命周期、依赖边界检查及独立预览已落地。实施范围和分批记录见 [模块化计划](docs/MODULARITY_PLAN.md)。

[PR #9](https://github.com/TeutonicMepheles/ComfyUI-DAELab-Creative-Studio/pull/9) 已合并 18% 缩放下的设置入口命中修复及相关输入、面板改进，当前提交 CI 通过。双实例缩放、结构与素材操作、模式切换、保存重开和人工输入法的已执行范围见 [表格补充验收](docs/validation/TABLE_PILOT_ACCEPTANCE_20261027.md)。

表格试点尚未关闭：固定大表输入性能仍未达到 100 ms，余下焦点覆盖继续跟踪。大表行窗口等性能候选未合入 `main`。这不阻止开发版协作，也不代表 M6 发布验收通过；完整状态见 [执行状态](docs/validation/STATUS.md)。

## 协作入口

从最新 `main` 创建功能分支，通过审核和 CI 后合并。各自有模块的 README 说明职责与验证入口，
AGENTS.md 补充局部协作约束；先读根 [AGENTS.md](AGENTS.md)，再读将修改的目录。

| 范围 | 入口 |
| --- | --- |
| 前端源代码、宿主接入与共享 UI | [frontend](frontend/README.md) |
| 任务、资产、模型提供方与后端 | [backend](backend/README.md) |
| 旧数据兼容读取 | [compat](compat/README.md) |
| 测试、固定夹具与证据 | [tests](tests/README.md) |
| 构建、迁移、评估与打包工具 | [tools](tools/README.md) |
| 架构、协作、迁移规格与验收状态 | [docs](docs/README.md) |

`web/` 随源码构建生成；第三方资源由其父目录登记来源。依赖、模型、运行数据不属于协作源码。

目标流程：素材/分镜导入 → 画布与表格编辑 → 提示词配置与优化 →
表内/表外生成 → 结果回填与复用 → 剪辑导出 → 保存重开与任务恢复。

当前阶段与未完成验收见 [执行状态](docs/validation/STATUS.md)。
[迁移规格](docs/migration-blueprint/README.md) 定义目标，不能当作通过证据。
迁移未通过 M6 前，请继续保留原安装和数据；隔离开发环境不操作现用服务。

源代码来自同一所有者的 Creative Canvas 与 Custom Nodes Library 固定基线。
公开托管不构成新的许可授权；来源和第三方许可见
[来源记录](docs/provenance/README.md)。
