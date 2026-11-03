# 生成信息精简与剪辑自动素材输出

task #51 对应 AC-BIZ-025-004 / AC-CAN-034-004。用户截图要求移除生成节点底部说明条及重复“已完成”，剪辑导出成功后自动出视频素材并保留连线。

## 修改

- 生成节点移除说明句和无异常的重复完成状态；设置控件的作用范围、运行和异常提示保留。
- 仅 `ExportSession.currentOutput` 的已核验当前导出触发素材输出；失败、未核验和副本只读结果不自动创建。
- 使用原成片的 filename/subfolder/type、asset/reference ID、哈希和来源创建现有 MediaUpload，未再次导出或注册另一套文件。按原请求保存输出身份，同一完成通知或保存重开不新建；用户删掉或断开输出不会被轮询恢复。
- 素材末尾追加可选惰性 `source_video`，连接剪辑原有 COMFYTV_VIDEO 引用出口。旧输入和输出顺序保留；`check_lazy_status` 仍返回空，不拉取上游执行。当前宿主实测 COMFYTV_VIDEO 与 String 不兼容，因此不复用 source_report。
- 普通导出移除底部重复成功、预览和下载区域；原副本的只读来源提示及预览仍保留。

## 验证

原失败由 Reviewer 在当前 8365 使用已有四段视频实跑保留：成功后仅下载链接，无自动素材或连线。候选源码自检包括：

- 输出控制器回归覆盖已核验回执、重复通知/重开、删除/断线不复活、新导出保留旧素材、失败/错误来源/工作流切换、连接失败回滚及布局避让。
- 使用真实 ExportSession 与 MediaExportService 的合成成功回执，完成时自动输出，后续状态刷新不再提交或新增素材。
- 原生注册检查验证追加入口的类型、可选和惰性属性，原素材输出槽未变。
- Chrome 独立页面使用候选源码响应覆盖及新增入口的 object_info 模拟，加载已有成功导出画布，正常会话恢复后自动创建一个素材，画布连线可见。成片实际播放（512×288、3.67 秒）；重复回执和保存重开后仍是同一节点。既有资产身份及哈希一致，未提交生成或新的导出请求。

首次浏览器自检因宿主将出口名显示为中文而报接口未就绪；匹配改为稳定 COMFYTV_VIDEO 类型并新增回归后通过。证据在 Implementer 工作区 `editor-auto-output-check.mjs/json/png`。新增输入的真实后端接线及重新导出全流程仍须 Reviewer 在同版本最终构建上复验；源码覆盖与 object_info 模拟不代表测试服部署完成。

自动检查：658 项业务、262 项画布及导出面板、28 项原生画布后端、TypeScript 和架构（191 模块）。来源清单在提交前更新为 LF 字节哈希；首次画布检查中未更新的来源哈希失败保留于本地日志，更新后复验。

## 真实宿主元数据补修

最终构建独立复验发现 `/object_info/DAELAB.MediaUpload` 500：自定义连接的 `Input` 不接受 `force_input`。此前 IO 桩吞掉任意参数，浏览器新增入口元数据又是模拟，未覆盖这项宿主兼容问题。

补修仅移除自定义 `source_video` 上的 `force_input`；保留 `optional=True`、`lazy=True`、末尾位置及空 `check_lazy_status`，既有 String 入口不变。自定义输入桩改为真实连接 Input 的严格参数签名。

新增可选真实宿主回归，使用本机 ComfyUI 安装的 SDK，在 CPU 子进程执行与 object_info 相同的 `GET_NODE_INFO_V1()`：旧代码先复现 TypeError，补修后通过，确认原五个输出、可选入口顺序及 `source_video` 的惰性元数据。证据 `.local-real-schema-before.log`、`.local-real-test-before.log`、`.local-real-test-after.log`、`.local-real-metadata.json` 在补修工作树。该检查未启动服务器或运行模型；实际 HTTP 元数据和原四段导出仍交 Reviewer 在同版本最终构建复验。
