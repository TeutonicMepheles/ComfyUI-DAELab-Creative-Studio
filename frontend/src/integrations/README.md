# 外部宿主接入目录

集中放置产品与外部宿主的适配，当前实现为 ComfyUI。核心功能不反向导入此目录。

源码入口：comfyui/README.md：注册、健康检查、业务及画布接入导航。

协作边界：把宿主对象翻译为 contracts 端口；外部依赖缺失应产生明确诊断，不由功能层猜测全局对象。

本目录的可编辑源位于 `frontend/src/integrations/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node tools/check_architecture.mjs
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/business_ports.test.mjs
```

