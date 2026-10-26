# 画布公开适配器

以公共能力声明接入上传节点和可选 ComfyTV 节点，统一端口与素材交换体验。

源码入口：upload.mjs：基础素材节点适配；comfytv.mjs：外部 ComfyTV 能力检测与只读接入。

协作边界：仅适配本机已存在的上游公开能力；不复制、修改或捆绑 ComfyTV 实现。实际端口手势和视觉由 Canvas 共享层拥有。

本目录的可编辑源位于 `frontend/src/integrations/comfyui/canvas/adapters/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_canvas/comfytv_adapter.test.mjs tests/migrated_canvas/creative_contract.test.mjs
```

