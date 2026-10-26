# 前端源码模块

应用层组合业务用例，features 拥有具体编辑功能，canvas 拥有画布交互，integrations/comfyui 是唯一宿主接入边界。

源码入口：application：事务与服务；contracts：端口和 JSON 边界；design/ui：视觉和共享控件；compat：旧节点只读规则。

协作边界：新核心采用 TypeScript；成熟 ESM 可复用。运行时不能导入旧两个业务包，也不能在核心功能中直接导入 /scripts/ 宿主模块。

本目录的可编辑源位于 `frontend/src/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
npm run typecheck
node tools/check_architecture.mjs
```

