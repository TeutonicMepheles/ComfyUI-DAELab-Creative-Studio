# 剪辑与成片导出

拥有时间轴数据模型、剪辑面板及前端导出会话，组合图片、视频和音频为成片。

源码入口：video_edit_model.mjs：片段、时长和编辑规则；video_edit_panel.mjs：播放与时间轴交互；export_session.ts：请求身份和结果失效；video_edit.css：面板样式。

协作边界：媒体执行经 application/media_export_service.ts 和宿主接入；播放位置是临时会话，片段和导出输入属于原生工作流。

本目录的可编辑源位于 `frontend/src/features/editor/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_canvas/video_edit_model.test.mjs tests/application/media_export.test.mjs tests/application/media_export_panel.test.mjs
```

