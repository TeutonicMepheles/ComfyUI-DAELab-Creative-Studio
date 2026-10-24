# 六类历史节点的只读宿主适配

这是 M6 的能力准备，尚未完成真实宿主读取、切换、迁移或回滚验收。无旧 Python/JavaScript 执行导入，无 provider、CLI、网络、恢复或重投入口。

## 装配

后端显式调用 `compat.workflows.readonly_node_mappings()`，仅合并 **2 个原生类型**，并按宿主习惯建立显示名映射：

- `DAELAB.ComfyTV.GPTImageStoryboardStage`
- `DAELAB.LibTV.StoryboardBatch`

前端显式调用 `installCompatReadonly(app)`，来自 `frontend/src/integrations/comfyui/compat_readonly.js`。应在宿主 `registerCustomNodes` / `beforeRegisterNodeDef` 生命周期运行之前调用，不能延迟到 setup、健康检查完成或工作流已加载后。它额外注册 **4 个原有前端 virtual 类型** `DAELAB.LLMStylePreviewA/C/D/E`，并为后端两类安装保真序列化和只读面板。模块 import 本身不注册；返回值释放监听、面板及队列包装，不支持同一页面卸载后重新注册类型，需完整刷新。

界面显示实际保存参数、分镜和结果；仅本文件中的结果被展示，旧样式原型的示例文字不会被当成模型输出。可以导出原始节点 JSON；未知字段保留在原件，不输出到遥测或日志。共享按钮、字段和面板 availability 控制由现有 UI 模块承担。

## 固定来源与槽位

固定业务提交 `7ff56cb51ef6f7fc3bcf5707792d655037c61b30`。`tests/migration/fixtures/legacy-source-contract.json` 保存 8 个精确 GitHub commit 链接和源码 SHA-256；`docs/provenance/compat-files.json` 同时记录新实现哈希。fixture 维护脚本只通过 `git show <commit>:<path>` 读取源码/受跟踪工作流，通过 AST 和限定构造器解析提取 schema；不会 import 旧实现。日常测试完全不依赖旧目录。

| 类型 | 输入索引 | 输出索引 | serialized widgets |
| --- | --- | --- | --- |
| GPTImageStoryboardStage | 0 force_run_token, 1 project_id, 2 parent_output_id, 3 workflow, 4 size, 5 custom_width, 6 custom_height, 7 background, 8 quality, 9 seed, 10 main_prompt, 11 storyboard_data, 12 selected_index, 13 custom_params；新 schema 只在末尾追加可选 14 imported_storyboard | 0 images: COMFYTV_IMAGES；1 image: COMFYTV_IMAGE | 15 项，seed 后的第 10 项为 control_after_generate，因此 main_prompt/storyboard_data 的 widget 索引为 11/12，不能直接使用 input 索引 |
| StoryboardBatch | 0 storyboard_json, 1 project_uuid, 2 request_id, 3 model, 4 mode, 5 duration, 6 resolution, 7 ratio, 8 sound | 0 batch_report: STRING；1 video_paths: STRING | storyboard_json 为 forceInput；其余 8 个 widget 保持原顺序 |
| LLMStylePreview A/C/D/E | 0 原文: STRING；1 参考图片: IMAGE | 0 结果: STRING | 无业务 widget；原 DOM 空位置（例如 `[null]`）原样保存 |

固定源码定义了末尾 `imported_storyboard`，同一提交受跟踪的旧 GPT 工作流却保存 14 个 inputs。适配以实际文件数组为权威：读取 14 就重存 14，读取 15 就重存 15，既不插入前置槽位，也不移动已有连线。早期缺少 seed 控制项的 14-widget 文件仅在投影时按已确认旧格式解释；原数组不补写、不修复。两个后端 schema 保留选项、默认值、输出类型和顺序；旧 server auth hooks 不请求，`is_api_node` 不继承。

原节点 properties、widget 值和未知字段保持不可写。原生位置、大小、标题、mode 及连接的明确编辑仍通过原生图保存；宿主构造器补入但用户未改的缺省字段不会回写。发现同索引槽位 name/type 变化时拒绝保存，给出明确错误，不能猜测重接。

## 执行拒绝与显式 GPT 转换

两个原生类型的 `VALIDATE_INPUTS` 和 `execute` 都拒绝，`IS_CHANGED` 不复用旧执行缓存。前端队列保护检查根图及序列化中的已使用子图定义；六类型除 mute/bypass 外均拒绝提交。图序列化/保存不被执行保护拦截。四个 virtual 类型的 `onExecute` 同样拒绝，不伪造输出。

GPT 只在用户点击“预览转换为表格”后构造完整可审阅 JSON，确认后追加一个 `DAELAB.Table`。原节点、原 mode、未知字段及所有旧连线不变；不自动重连 COMFYTV_IMAGES/COMFYTV_IMAGE 到 STRING。继续执行新流程前，用户应明确停用旧节点。原件仍留在工作流中，并可单独导出。

转换通过成熟 `readStoryboard()` 生成编辑副本，500 行/64 列在转换前后检查，不允许静默截断。链接的 imported_storyboard 不执行上游取值；未知/损坏结构拒绝。新表格删除旧任务恢复及生成列绑定，不复制任务身份到新执行状态。原结果作为内容保留。预览与确认间工作流、节点数据变化即失效；同一预览不能重复确认。

应用使用 `DocumentController` → `canvasHistory` → 宿主 changeTracker 的一个原生事务。不存在第二套可写图或撤销栈；失败添加会撤回新节点，原节点保持不变。单元测试用宿主端口替身验证一次 undo/redo 同时恢复整个新增表格及其内容；这不代替真实 ComfyUI 撤销验收。

## 验证边界

命令：宿主 Python 3.12.11 运行 `-m unittest discover -s tests/migration -v`；Node 24.14.0 运行 `--test tests/migration/readonly_nodes.test.mjs`；`npx tsc --noEmit`；`node tools/check_architecture.mjs`。夹具所有提示词、结果路径、身份和媒体值均为合成内容，GPT 槽位来自固定提交受跟踪的 serialized workflow，其他槽位来自固定构造器。没有导入真实用户任务回执运行。

首次前端 10 项为 8 通过、2 失败：原生构造器默认 title 回写使无编辑往返增加字段，已修复并补测。第二轮 13 项为 12 通过、1 失败，仅测试全局事件函数先于 cleanup 恢复，已修正清理顺序。保留这些失败事实。最终 Python **33/33**、前端 **13/13**，均无跳过；类型检查通过，架构检查 **130 个模块**通过。它们不改变 catalog TC 状态。

真实宿主仍须验证：六类型注册及缺失提示、14/15 输入保存重载及连线、两个只读实例、溢出和焦点、模式切换、680/1280/1920 视口、子图/根图、转换取消/确认/undo/redo、原件和任务身份不变。实际安装切换、真实历史金样、在途停止/恢复决策、备份恢复、回滚和累计 P0/P1 门禁仍未验收。
