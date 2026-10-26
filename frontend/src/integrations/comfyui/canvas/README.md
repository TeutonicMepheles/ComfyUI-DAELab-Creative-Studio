# 画布宿主与基础节点

将 Canvas 核心绑定到 ComfyUI 图、历史、模式、素材上传、文本、素材组和剪辑节点。

源码入口：canvas_host.ts：宿主端口；creative_canvas.js：扩展生命周期；creative_history.mjs：原生撤销桥；restored_node_order.ts：恢复排序；media_upload.js、material_group.js、text_input.js、video_edit.js：基础节点。

协作边界：核心模型不读取宿主；此处保留 DAELAB.MediaUpload、槽位和 material JSON。编辑历史仍由宿主拥有，局部恢复不能建立平行撤销栈。

本目录的可编辑源位于 `frontend/src/integrations/comfyui/canvas/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_canvas/canvas_host.test.mjs tests/migrated_canvas/history_keyboard.test.mjs tests/migrated_canvas/history_workflow_lease.test.mjs tests/migrated_canvas/history_restored_order.test.mjs
```

