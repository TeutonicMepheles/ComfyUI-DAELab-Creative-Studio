# 共享视觉资源

共享语义主题和本地第三方字体、图标资源；不承载节点业务行为。

源码入口：creative_theme.css：颜色、字阶和通用视觉变量；vendor/README.md：三个资源包及来源边界。

协作边界：ui 复用主题，features 的 CSS 限定各自作用域。第三方授权和原始哈希由 docs/provenance 及资源清单维护。

本目录的可编辑源位于 `frontend/src/design/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
npm run build
node tools/verify_assets.mjs
```

