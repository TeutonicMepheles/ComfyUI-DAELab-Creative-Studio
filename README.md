# DAELab Creative Studio for ComfyUI

单仓库、单安装包的创作画布迁移正在实施，尚未发布可替换旧包的版本。
本项目继续使用 ComfyUI 原生工作流和执行队列。

目标流程：素材/分镜导入 → 画布与表格编辑 → 提示词配置与优化 →
表内/表外生成 → 结果回填与复用 → 剪辑导出 → 保存重开与任务恢复。

当前阶段与未完成验收见 [执行状态](docs/validation/STATUS.md)。
[迁移规格](docs/migration-blueprint/README.md) 定义目标，不能当作通过证据。
迁移未通过 M6 前，请继续保留原安装和数据；隔离开发环境不操作现用服务。

源代码来自同一所有者的 Creative Canvas 与 Custom Nodes Library 固定基线。
公开托管不构成新的许可授权；来源和第三方许可见
[来源记录](docs/provenance/README.md)。
