# 创作功能模块

按用户流程划分素材、素材组、表格、分镜、提示词、生成、任务展示和剪辑；各功能拥有自己的模型及界面。

源码入口：assets/groups：素材组织；table/storyboard：结构化内容；prompt/generation：请求与结果；tasks：任务呈现；editor：时间轴与导出。

协作边界：功能模块通过 contracts 和 application 调用宿主能力，不直接导入 integrations。共享按钮、字段、事件和主题来自 ui/design。

本目录的可编辑源位于 `frontend/src/features/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node tools/check_architecture.mjs
npm run test:business
```

