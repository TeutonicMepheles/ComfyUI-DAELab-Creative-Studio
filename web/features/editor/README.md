# 剪辑与成片导出

拥有时间轴数据模型、剪辑面板及前端导出会话，组合图片、视频和音频为成片。

源码入口：video_edit_model.mjs：片段、时长和编辑规则；video_edit_panel.mjs：播放与时间轴交互；export_session.ts：请求身份和结果失效；video_edit.css：面板样式。

协作边界：媒体执行经 application/media_export_service.ts 和宿主接入；播放位置是临时会话，片段和导出输入属于原生工作流。

当前导出经成功回执与输入指纹核验后，自动输出一个独立视频素材并连接剪辑的本地视频引用出口。素材沿用已注册成片的文件和资产身份，不再次导出；同一请求的重复通知、重开或输出被用户删除后不重复创建。后续新导出创建新素材，保留已有成片。普通成功导出不再在面板底部重复预览或下载；副本只读来源的提示保留。

素材同步按稳定素材身份去重；缺少身份时使用现有 SHA-256 指纹，不以文件名判断同一素材。同名字但不同内容保持独立，重新连接相同来源不新增素材或片段；用户主动复制、分割出的多个时间线片段保持不变。去重保留的那条素材若因改名或顺序变化而换了文件名，已有片段按素材身份解析到该条，保留 clip ID、裁剪区间和主动副本，不重建从头开始的默认片段。

自动扩展槽名不参与素材身份。同一原生输出不能重复连入新的剪辑输入；旧工作流中已有的重复路径保留连线，但同步时只导入一次对应素材。断开其中一条重复路径不移除仍连接的素材，也不重建已有裁剪或主动副本。

本目录的可编辑源位于 `frontend/src/features/editor/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_canvas/video_edit_model.test.mjs tests/application/media_export.test.mjs tests/application/media_export_panel.test.mjs
```


尚无本模块独立预览入口。模型/合同用例可从上述命令单独运行；界面、模式与保存需在独立 ComfyUI 中检查。示例使用见 [Showcase](../../../Showcase/README.md)，开发环境见 [开发指南](../../../docs/DEVELOPMENT.md)。
