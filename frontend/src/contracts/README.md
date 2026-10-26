# 前端跨模块合同

定义资产、业务、画布、媒体导出及文档端口，让核心规则不依赖 ComfyUI 对象。

源码入口：ports.ts：文档和异步票据；canvas_host.ts：画布宿主端口；assets.ts、media_exports.ts：资源服务；business.ts：业务服务绑定；json_snapshot.ts：JSON 快照边界。

协作边界：design、ui 和 contracts 不能反向依赖 features、application 或 integrations。序列化边界保留未知合法 JSON 数据并拒绝不可表示状态。

本目录的可编辑源位于 `frontend/src/contracts/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
npm run typecheck
node tools/check_architecture.mjs
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/business_ports.test.mjs tests/migrated_business/native_json_boundaries.test.mjs
```

