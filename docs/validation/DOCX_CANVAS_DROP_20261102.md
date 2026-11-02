# 空白画布拖入 DOCX

范围：task #21，今晚整链步骤 1，F-BIZ-018 / F-BIZ-021 / UC-BIZ-003。

旧画布文件拖放仅通过 `mediaKind` 筛选图片/视频，DOCX 被拒绝，未创建解析节点或
解析请求。新增回归在旧代码先失败：DOCX 节点列表为空，混拖仅保留媒体。

同一 drop 监听现将 `.docx` 分流为 `DAELAB.ScriptParser`；解析适配器等待已排队的
面板初始化后调用既有 `uploadDocument(mode:append)`。图片/视频沿用原上传能力，
单文件替换上传节点行为保留；CSV/XLSX 仍跳过。节点摆放按各自宽度排列。异步上传
保留原图归属检查，单文件失败可见提示，不启动新 HTTP 客户端或另一套解析流程。

验证：画布回归 246 项、严格类型与 189 模块架构通过，来源清单已更新。
真实 8365 独立浏览器会话中，仅替换本次源码响应后，将 Reviewer 制作的无图 DOCX
副本拖入空白处，得到四列四行解析表；仅发送一次 document 与 normalize 请求，
不调用 `/upload/image`。原生撤销可依次恢复导入和节点创建，重做还原解析内容。
没有改动用户原件、运行中的宿主或模型配置，也没有模型调用。

原始证据保存在 Implementer 工作区 `docx-drop-check.mjs`、`docx-drop-after.json/.png`。
实现预览不等于已部署；仍由 Controller 集成列输入 Slot 修复并构建、Reviewer 在
最终 8365 构建复验真实拖放和今晚整条流程。
