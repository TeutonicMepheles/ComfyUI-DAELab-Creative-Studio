# 1029 剧本解析反馈验证

基于 `ab875b1` 的候选修复四列输出、章节拆表和每表 10 行。未修改 CSS、字体、尺寸或控件样式。原生类型、插槽和 JSON 版本保持；新数据以 `field_policy: fixed-four` 区分，旧表不自动转换。

## 追踪与范围

任务 `1029-script-partitions` → F-BIZ-018/019/020 → AC-BIZ-018-002、AC-BIZ-019-001/002、AC-BIZ-020-001/002 → UC-BIZ-003 → TC-BIZ-022/023/024/026 的解析、修订和存档子集 → `EV-script-partitions-20261030`。不代表完整 TC 或 M6 通过。

## 已执行

- 纯逻辑：0/1/10/11/20/21 行边界、同名章节来源分离、追加去重与续表、原文及非展示字段保留、多图顺序、坏图定位、手工内容保护、跨章修订、旧表显式转换及图片引用迁移。
- 宿主替身调用正式批次入口和文档控制器：一次历史边界、同批次其他表变化拒绝旧结果、创建失败回滚、两个独立实例不互改。该项不冒充实际浏览器结果。
- 隔离 ComfyUI 8310：从合成 DOCX 实际导入两个同名章节共 13 条任务，得到 10/1/2 行；另一解析器独立导入相同文档。一次原生撤销移除整次导入，重做恢复全部表。未操作用户 8000 图。
- 在页面手工修改画面，再将旁白映射到备注：画面手改保留，备注更新；保存 JSON 核对原 13 个记录 ID 和图片引用完全保留。尝试新增第 11 行被拒绝，原表不变。
- 勾选首行直接接入生成节点，显示一条任务、手改文字和两张参考图；未执行模型。最终候选使用现有提示词编辑器插入本行第二张图的 @ 引用，重新解析与保存重载后标签及 assetId 仍指向同一图片。
- 旧 11 行表在打开时保持原状，点击现有菜单的转换入口后得到 10/1 行，手改文字和转换前完整表格保留。检查 15%/23%/45% 画布及现有调整解析对话框。

本地证据：`.local/script-imported.json`、`.local/script-edited-linked.json`、`.local/script-final.json` 和隔离目录 `generation-acceptance/user/default/workflows/Script-*.json`。初轮 `.local/script-focused.log` 的可选图片属性 undefined/JSON 往返差异失败保留，显式省略可选属性后定向测试通过；`.local/script-backend.log` 记录首次选用不带依赖的解释器失败，改用既有 ComfyUI 虚拟环境后通过。`.local/script-check.log` 为中间候选通过记录，不用于替代后续候选指纹。

## 限制

最终自动检查：`npm run check` 通过（前端 393 通过、3 项既有跳过；业务 580 通过），后端 unittest 23 通过，`npm run check:docs` 通过。日志分别为 `.local/script-final-check.log`、`.local/script-final-backend.log`、`.local/script-final-docs.log`。新增回归覆盖旧表手工增删图片在转换后再次解析仍保留。最终构建 sourceFingerprint：`b6f009408e81d7e512f0ea6271eb539003de82bcfadd0da1642530bf73b9eb96`；重载后的工作台截图为 `.local/script-final-review.png`。最后的旧表图片基线修正由定向测试验证，未在浏览器重做该特定手工增删场景。

未扩展普通表格容量规则、DOCX 拖拽上传、摘要或新优化模板。文档仍受原 20 MiB/500 任务安全限制；超限拒绝而非截断。未重跑完整 App Mode、Mute/Bypass、云端或 GPU 生成矩阵；下游本轮只验收输入投影。
