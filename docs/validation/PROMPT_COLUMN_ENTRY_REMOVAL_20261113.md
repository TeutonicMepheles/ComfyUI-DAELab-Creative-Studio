# 移除整列模型配置入口 · 2026-11-13

用户明确要求：删除整个“整列模型配置”入口和弹窗，设为提示词按钮不应打开该面板。基线 `e0e556c`，分支 `codex/prompt-model-rewrite-20261113`。

## 行为与范围

表头按钮只指定唯一提示词列；已选列标签为“已设为提示词”，重复点击不写历史、不改数据、不弹窗。删除 `dae-prompt-column-settings` 的派发、监听、专用弹窗构建函数及样式，并清理专用导入。旧工作流的列/逐行生成配置、首尾帧数据和已有结果保留。生成节点和其他设置面板不变。

追踪 F-BIZ-010 / AC-BIZ-010-001 / UC-BIZ-005；本次是 TC-BIZ-003、013 的指定/持久化相关子范围，不声称完整 TC 或 M6 验收。

## 验证

- `npm run check`：前端 477 项通过、3 项跳过；业务 724 项通过。日志 `.local/remove-column-settings-check.log`。
- 新增 `tests/migrated_business/table_prompt_source_header.test.mjs`：指定、重复点击、无事件、数据和实例隔离；旧配置兼容断言保留在 `generation_parameters.test.mjs`。
- `tests/browser/prompt_source_header.mjs` 在 8365、8366、8367 的真实 ComfyUI 各两个表格上通过：指定后无弹窗，已选列重复点击不改数据，派发旧事件也不复活面板；列配置及文字保留，另一实例不变，保存重开、图形/创作画布、Mute/Active、聚焦和两视口三种缩放复查通过。截图已查看。
- 视口 1700×1100 / 1000×800，画布缩放 50% / 100% / 150%；用滚轮把目标按钮移到视口内后真实点击，不 force-click。显式 .local 宿主，浏览器独立 context，生成请求全部拦截，没有付费或真实推理。
- 原始记录：`.local/header-8365-actual.log`、`header-8366-actual.log`、`header-8367-actual.log`；每端口的 `prompt-header-actual.json/png`。候选首轮因为夹具的默认画布卡片间距小于表格宽度而点击被另一实例挡住，日志保留；修正夹具显式布局后复测通过，未跳过指针命中检查。

## 运行副本

三个宿主同步构建的 `table_prompt_source_header.mjs`、`table_generation_panel.mjs`、`table_prompt_settings.mjs` 三个模块。原文件先备份，部署清单和逐文件前后 SHA-256 在 `.local/remove-column-settings/deployment.json`。后端、模型配置、用户工作流和其他 JS 未替换，未重启服务。运行副本是有记录的三个静态模块热修复，包级 build manifest 仍标识原包；不能据此声称全包升级。已有页面须保存后刷新，以释放旧模块实例及已打开的弹窗。
