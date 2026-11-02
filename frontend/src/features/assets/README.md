# 素材与资产库界面

负责上传素材、文字素材、收藏、资产库筛选和预览；持久资产身份由后端资产服务管理。

源码入口：asset_library.mjs、asset_library_model.mjs：检索和列表；asset_favorite.mjs：收藏交互；media_upload_model.mjs、text_input_model.mjs：序列化；upload_video_controls.mjs：视频控件。

协作边界：上传节点名称和 material JSON 保持兼容；通过 application 及资产端口注册或查询文件，不将运行时 DOM 或播放器状态写入素材数据。

上传节点、表格、分镜和视频任务通过 `application/media_upload.js` 共用原生上传策略：每次读取 Comfy `/features` 的 `max_upload_size`（字节），超限文件在 POST 前被拒绝。读取不到时交由宿主判断，不虚构上限；HTTP 413 显示文件大小、宿主返回的上限或代理限制说明。保留 Comfy `--max-upload-size` 设置，不另设产品默认值。

本目录的可编辑源位于 `frontend/src/features/assets/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_assets/asset_views.test.mjs tests/migrated_assets/asset_service.test.mjs tests/migrated_assets/upload_registration.test.mjs
```


尚无本模块独立预览入口。模型/合同用例可从上述命令单独运行；界面、模式与保存需在独立 ComfyUI 中检查。示例使用见 [Showcase](../../../../Showcase/README.md)，开发环境见 [开发指南](../../../../docs/DEVELOPMENT.md)。
