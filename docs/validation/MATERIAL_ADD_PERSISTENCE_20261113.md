# 上传后保留追加入口 · 2026-11-13

基线 `fbb16e9`。用户反馈独立视频生成节点首次上传后“＋”消失。原因是素材栏只在 `assets.length === 0` 时插入上传控件。

## 修复

取消空态条件，将同一个上传控件固定放在素材栏首位；缩略图排在其后。上传、删除和保存重开不移动或替换入口。原上传请求、追加事务、素材顺序和身份、大小/格式限制及任务锁定规则不变；共用生成面板同时适用于图片节点，本次实机覆盖视频节点。

归属 `features/generation/video_tasks_panel.mjs`。对应 F-BIZ-024 外部生成节点的素材输入子范围；不是完整模型生成或 M6 验收。

## 检查

- `video_task_prompt_boundary.test.mjs` 新增真实 renderPrompt 的引用列表回归：0→1→2→1→0 项素材始终只有一个首位“＋”，缩略图顺序保持，两个实例不共用控件。
- `npm run check`：477 项通过、3 项跳过，业务 725 项通过；最终日志 `.local/material-add-check-final.log`。
- `tests/browser/material_upload_add.mjs` 显式访问隔离回环宿主，8365、8366、8367 各两个视频节点通过。使用合成 PNG 经真实文件选择和 `/upload/image` 上传，验证首次/第二次上传、Delete 删除后再上传、保存 JSON 刷新重开后继续上传；每轮四次上传均返回 200，另一实例仍为空且入口可用。生成请求全部拦截，无模型推理或付费调用。
- 两个视口 1700×1050 / 1000×800、创作画布 50% / 100% / 150% 下入口存在、可用且不横向溢出；Mute/Active 恢复检查通过。原始日志 `.local/material-add-<port>-actual-final.log`，测量和截图 `.local/<port>-material-add-actual.json/png`。

## 首次失败与部署

最初将“＋”放在尾部的候选虽能显示，但上传后的首图占据原点击位置，悬停预览阻挡再次点击。首次失败及详细命中日志保留在 `material-add-8366-candidate.log` 与 `candidate-r2.log`。改为固定首位后四次真实上传通过；删除使用缩略图原有的键盘 Delete 入口，不修改共享预览行为。截图前移动到画布空白并关闭悬停预览，避免截图被临时预览遮挡。

三个运行副本仅同步构建的 `video_tasks_panel.mjs`。该文件 SHA-256 为 `d3a93ac4afae96f90f7265526e32fd8ad4e2956a1408017a13ee4fb0d8df79f4`。原文件均备份，清单 `.local/material-add-deployment/deployment.json`。没有重启服务、替换后端、修改用户工作流或生成设置。包级 manifest 仍标识原安装，本次是明确记录的单模块热修复，不代表全包升级。既有页面保存后刷新生效。
