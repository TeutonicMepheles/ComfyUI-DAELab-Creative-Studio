# 生成输出占位 · 2026-10-30

基线为 `main @ fca1633`；最终源码构建指纹 `2383f566d720a826f46b3ca5ca8a31ebf3e2702f87f71a7d6709a0bfeb09eebf`。本次实现新请求自动连出占位、已核验结果原位显示，以及批量任务的输出素材组。详细行为见 [生成模块](../../frontend/src/features/generation/README.md#自动输出素材)。

## 检查范围

- TypeScript、构建、架构、资源与回归：`npm run check`；前端 387 项、业务 573 项通过。
- 后端素材合同：21 项通过，包括可选惰性来源输入、五个既有输出槽位和不请求上游执行。
- 独立 ComfyUI 与可选 ComfyTV 组合：两个生成实例、真实运行按钮、自动连线、图片原位显示；三个表格任务共享输出组，状态排序为运行中／失败／完成。
- 两环境均保存原生 workflow JSON、刷新浏览器后重新载入，保留节点身份、来源线、组成员及素材；覆盖原生／创作画布切换、Bypass 恢复、50%／100%／150% 缩放和 1000／1600 像素视口。
- 独立环境补充视频播放、暂停确认与重新生成保留旧占位、另一实例焦点保留、输出删除的原生撤销／重做。加载占位输出只包含已就绪素材；单元测试保留普通缺失素材错误。
- 定向测试覆盖重复回执、删除与断线不复活、错误身份、切换工作流、销毁、收据不匹配、用户替换，以及提交结果未知时显示待恢复。状态服务临时 503 时占位显示待恢复，恢复后继续更新原目标，实际界面模拟检查通过。

真实宿主使用 CPU 隔离目录，ComfyUI `3c1b7a17fdf239d35ce98cc777756f572d089795`；组合环境为只读固定 ComfyTV `a5e0c16b5ca7f74b31293c2f940a704107e4a009`。生成接口由浏览器测试提供明确模拟的回执，媒体为合成图片／视频。没有提交模型或付费任务，未修改 8000 工作流。这些检查不代表真实模型推理、人工输入法或完整 M6 通过。

## 过程失败与证据

首次完整检查发现上传替换路径对缺省 properties 的兼容问题及需更新的迁移目标摘要，已修正；原始 sourceSha256 保留。首次 UI 探针的卡片定位使用了替换对象，未更新已有布局引用；联合环境首次点击被宿主模板窗口遮挡。测试分别改为原位布局更新与关闭模板窗口。首次文档检查时验证记录尚未创建。首次日志保留，不作为产品通过证据。

本机证据位于独立工作区 `.local/`：`check-first.log`、`check-second.log`、`check-third.log`、`check-final.log`、`backend-test.log`、`docs-check.log`；`ui-flow.mjs`、`ui-batch-final.mjs`、`ui-batch-optional.mjs`、`ui-video.mjs`、`ui-pause.mjs`、`ui-focus-undo.mjs`、`ui-offline.mjs`；`single-*.png`、`batch-*.png`、`optional-*.png`、`video-*.png`，以及保存的合成工作流。宿主清单在 `.local/output-host/` 与 `.local/optional-output-host/`。

追踪沿用 `TASK-M4-FEATURES-GENERATION → F-BIZ-024 → AC-BIZ-024-001/002 → UC-BIZ-010 → TC-BIZ-017/028/049 → EV-ARCH/EV-JOBS`，并补充本记录的占位、回填与组输出子场景；不将累计用例整体标记为通过。
