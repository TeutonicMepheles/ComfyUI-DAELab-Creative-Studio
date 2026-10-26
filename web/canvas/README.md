# 创作画布核心

负责卡片位置、视口、选择、导航、真实 Slot 连线和素材投放。节点业务内容由公开适配器声明。

源码入口：creative_canvas_view.mjs：视图和布局同步；creative_canvas_model.mjs：daelabCreativeCanvasV1；creative_connections.mjs：原生槽位连接；creative_material_drop.mjs、creative_input_exchange.mjs：素材交换。

协作边界：与 integrations/comfyui/canvas 通过宿主端口连接；与业务通过 adapter v1 交换能力和素材快照。平移缩放属于视图，不新增编辑历史。

本目录的可编辑源位于 `frontend/src/canvas/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_canvas/creative_canvas_model.test.mjs tests/migrated_canvas/creative_connections.test.mjs tests/migrated_canvas/creative_material_drop.test.mjs tests/migrated_canvas/creative_navigation.test.mjs
```

