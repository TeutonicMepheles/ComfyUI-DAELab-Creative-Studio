# 素材与资产库界面

负责上传素材、文字素材、收藏、资产库筛选和预览；持久资产身份由后端资产服务管理。

源码入口：asset_library.mjs、asset_library_model.mjs：检索和列表；asset_favorite.mjs：收藏交互；media_upload_model.mjs、text_input_model.mjs：序列化；upload_video_controls.mjs：视频控件。

协作边界：上传节点名称和 material JSON 保持兼容；通过 application 及资产端口注册或查询文件，不将运行时 DOM 或播放器状态写入素材数据。

本目录的可编辑源位于 `frontend/src/features/assets/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_assets/asset_views.test.mjs tests/migrated_assets/asset_service.test.mjs tests/migrated_assets/upload_registration.test.mjs
```

