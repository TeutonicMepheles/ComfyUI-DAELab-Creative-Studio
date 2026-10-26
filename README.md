# DAELab Creative Studio for ComfyUI

单仓库、单安装包的创作画布迁移正在实施，尚未发布可替换旧包的版本。
本项目继续使用 ComfyUI 原生工作流和执行队列。

日常功能开发统一在本仓库进行，入口见 [开发指南](docs/DEVELOPMENT.md)。
开发交接与 M6 发布验收分别记录；未完成的发布验收不阻止在隔离环境继续开发。

现有功能的可编辑展示工程见 [Creative Studio Showcase](Showcase/README.md)，附示例素材与逐项确认清单。

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
