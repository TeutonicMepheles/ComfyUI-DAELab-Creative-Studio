# 排错入口

先确认当前访问的是预期的独立宿主，保留首次错误、提交和工作流副本。不要删除未知字段、原任务或输出以获得“干净”结果。

| 现象 | 检查与下一步 |
| --- | --- |
| Studio 未注册，日志含 duplicate ownership | 检查同一 custom_nodes 范围内是否仍启用了旧 Canvas/业务库。使用独立安装，保留旧环境及数据；不依赖加载顺序 |
| 前后端不兼容或更新后界面仍旧 | 检查 `/daelab/studio/health` 的 `compatible` 和构建身份；在拥有仓库构建。快照宿主需显式刷新快照，普通浏览器刷新不会复制新文件 |
| Showcase 图片缺失 | 将公开素材安装到该宿主 `input/CreativeStudioShowcase/`；工作流使用相对 `/view` 引用。不要为了显示图片改写生产素材校验 |
| 本地模型不可用 | 按 [模型配置](MODELS.md) 核对 user 目录配置、固定文件、哈希、原生节点和本机 Ollama；不自动换模型 |
| 结果过期或待恢复 | 先查询原 requestId 和宿主执行 history；保留原输出。未知状态不能直接重提；保存工作流不保存进程内执行 history |
| 预览端口占用 | 停止自己启动的预览，或设置空闲 `TABLE_PORT`。工具不会接管或结束其他进程 |
| 浏览器测试找不到浏览器 | 默认使用已安装 Chrome；CI 使用 Playwright Chromium。设置 `TABLE_BROWSER` 前确认对应浏览器已安装，见 [预览说明](../dev/table/README.md) |
| 极低缩放下设置打不开 | 本轮在 600×800 / 18% 观察到点击落到列 Slot，已保留失败；不要将构建/单元测试通过当作此项修复，见 [T4 记录](validation/MODULARITY_T4_20261027.md) |

100 ms 输入预算、真实 IME 和 M6 当前限制集中维护在 [验证状态](validation/STATUS.md)。本页只提供定位入口，不覆盖既有失败记录。
