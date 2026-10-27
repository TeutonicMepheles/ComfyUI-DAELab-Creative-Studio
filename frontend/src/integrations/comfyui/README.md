# ComfyUI 前端接入

注册 Studio 扩展、检查前后端构建一致性，并绑定资产、导出、兼容节点和业务/画布端口。

源码入口：index.ts：版本与构建身份；health_client.ts、studio_diagnostics.js：健康诊断；asset_services.js、media_exports.ts：服务绑定；compat_readonly.js：旧节点宿主显示。

协作边界：ComfyUI 自动发现发布目录内所有 .js；bootstrap 的 import 列表不是唯一加载入口。所有权和生命周期必须在实际发现集合中唯一。

本目录的可编辑源位于 `frontend/src/integrations/comfyui/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
npm run build
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/business_entrypoints.test.mjs tests/migration/readonly_nodes.test.mjs
```


表格节点在 business/data_table_nodes.mjs 注入面板上下文、上传、结构剪贴板及原生文档工厂；script_parser.js 采用同一端口。宿主拥有节点模式、Slot 和原生保存，不能以预览内存历史替代。验证范围见 [T4 记录](../../../../docs/validation/MODULARITY_T4_20261027.md)。
