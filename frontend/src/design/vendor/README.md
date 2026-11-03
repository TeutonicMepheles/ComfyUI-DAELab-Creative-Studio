# 第三方视觉资源清单

2026-11-03：补齐生成节点与表格中止控件使用的 `remixicon/stop-line.svg`。
来源为 RemixIcon 提交 `9fb7967c0a4c09910161192bde99efd3df09f5eb` 的
`icons/Media/stop-line.svg`，原始 SHA-256 为
`da22575900a1d70bc2a57c8ddad97b672d5f30a3c42c542d17912886a6de4e6e`。
已核对该提交的 License 与现有 Remix Icon License v1.0 相同，沿用包内许可。

保留三个本地资源包，避免运行时 CDN 依赖。下属资源与许可是上游材料，本目录文档负责协作入口。

源码入口：alibaba-puhuiti-3：三种 WOFF2 字重、LICENSE.txt 与 manifest.json；remixicon：SVG 和 LICENSE；model-icons：模型品牌 SVG、LICENSE 与原始 README。

协作边界：各包自带 README 说明具体来源和权利范围；model-icons 中 LibTV 标识不能推定为 Lobe Icons 的 MIT 授权。仓库代码许可不覆盖品牌权利。

本目录的可编辑源位于 `frontend/src/design/vendor/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
npm run build
node tools/verify_assets.mjs
```

