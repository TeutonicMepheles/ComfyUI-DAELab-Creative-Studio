# 画布公开适配器 · 协作规则

继承仓库根 `AGENTS.md`。本目录职责、入口和定向验证见本目录 `README.md`。

编辑归属为 `frontend/src/integrations/comfyui/canvas/adapters/`；`web/` 下对应文件只允许由构建生成，不能在副本另行维护实现或文档。

- 可选上游不存在时应安全退化；不得把缺失能力推断成可执行。
- 适配器声明能力和数据，不另写 Slot 手势或访问非公开上游状态。

