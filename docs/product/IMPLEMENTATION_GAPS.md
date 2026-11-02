# Creative Studio 特性工程调整清单

2026-11-02。本文件汇总已确认产品规则与当前实现之间的差距，用于后续排期和实施。
基线为提交 `81646f4`。本文件是工程差距清单，不代表对应能力已经实现或完成验收。

## 状态说明

| 状态 | 含义 |
| --- | --- |
| 未实现 | 当前实现没有对应行为，或现有行为与产品规则相反。 |
| 部分实现 | 已有入口、数据字段或局部能力，但产品行为仍不完整。 |
| 需实机验收 | 代码路径可能存在，但尚未在规定的隔离 ComfyUI 和真实模型范围内完成验收。 |

## 待调整项

| 编号 | 模块 | 已确认的产品规则 | 当前状态与依据 | 需要的工程调整 |
| --- | --- | --- | --- | --- |
| `GAP-M13-01` | `P-M13` 模型与提供方管理 | 服务启动、应用打开或宿主重连后，自动发现本机可用本地模型及已配置 DeepSeek API；生成节点、LLM 优化节点和多维表格使用同一模型目录。 | **部分实现。** 当前依赖 `daelab/creative-studio/local-generation.json` 显式装配，模型控件各自读取能力；尚无统一跨节点目录和完整的启动、重连刷新生命周期。见 [P-M13 产品说明](P-M13-model-provider-management.md)。 | 建立只读模型目录与逻辑模型身份；接入宿主启动/重连、配置变化和手动重检；统一发布本地图片、本地视频、Qwen 和 DeepSeek 的能力与状态；保留已保存模型 ID，不自动回退。 |
| `GAP-M13-02` | `P-M13` 模型与提供方管理 | 模型可用性采用隐式 UI：不可用置灰禁用，检测中显示加载圆环，可用保持默认；检测原因只写日志。 | **部分实现。** 现有控件可能显示不可用原因，未统一使用可选、检测中、待验证和不可用状态。 | 为共享模型选项增加状态模型和可访问名称；接入原位刷新、提交前复核和结构化日志；禁止在菜单、节点或 Toast 中显示底层检测错误。 |
| `GAP-M11-01` | `P-M11` 任务与资源管理 | 生成和 LLM 优化任务支持明确作用域的暂停、继续、打断和重启；不同动作必须表达真实任务事实，作用域不能误伤其他节点或实例。 | **部分实现。** 现有主要入口仍以“暂停”表达，底层通过取消接口实现；本地已有作用域内中断和新请求重跑，远端任务通常继续完成。完整持久暂停、继续、统一打断和显式重启仍未完成。见 [P-M11 任务控制](P-M11-generation-task-control.md)。 | 统一任务控制命令和状态；持久化暂停意图；查询并映射提供方取消、中断和重启能力；防止运行中或结果未知任务被重复提交；刷新、重开和服务重启后从账本恢复。 |
| `GAP-M11-02` | `P-M11` 任务与资源管理 | 单个任务显示真实百分比和阶段；两个及以上任务不显示百分比，生成节点左上角只显示总任务数和已完成数。 | **部分实现。** 快照协议已有可选 `progress`，占位具备展示入口，但提供方和账本尚未稳定产生单任务真实数值；成组百分比尚未严格隐藏，现有测试主要使用合成报告。见 [单任务进度](P-M11-generation-task-progress.md)。 | 将提供方进度映射到统一任务快照；按任务数切换百分比和完成计数；处理乱序、跨请求、暂停、重启和刷新；未取得真实进度时只显示不确定状态。 |
| `GAP-M05-01` | `P-M05` 素材组 | 新素材组只允许文本、图片或视频中的同一类型成员；跨类型打组和跨类型成员加入不可用。 | **未实现。** 当前 `isGroupMember` 同时接受媒体节点和文本节点，`collectionFor` 可输出图片/视频集合，混合图片与文字仍形成 `image-instructions`；现有测试明确保留混合组。见 [P-M05 产品说明](P-M05-material-groups.md)。 | 在打组、加入成员、拖入、复制和快照入口统一校验素材类型；跨类型选择不提供有效打组动作；更新混合组测试与消费假设。按已确认范围，不设计旧混合组迁移。 |
| `GAP-M07-01` | `P-M07` 多维表格 | 单元格、行头和列头左键只选择；右键打开纵向菜单。横向菜单仅用于节点级操作；纵向菜单复用素材组横向菜单视觉，固定行高、图标加文字、逻辑分组并支持键盘。 | **未实现。** 当前 [内容呈现实现](../../frontend/src/application/table_presentation.mjs) 在选中后创建横向 `content-context` 工具栏并按锚点自动定位；右键仅对文本列进入部分优化菜单，不提供统一表内上下文菜单。Figma 评审稿 `Creative Studio · 多维表格操作菜单 · Draft 01` 仅作为设计参考。 | 建立统一的表内上下文菜单控制器；拆分节点级菜单与表内菜单；实现右键和 Shift+F10 唤出、分组、固定行高、图标、焦点循环、Escape 归还焦点和视口边缘避让；移除选择后自动横向菜单。 |
| `GAP-M07-02` | `P-M07` 多维表格 | 只允许单个单元格和按列输出；单元格通过右键菜单输出，列通过菜单和输出 Slot 输出；结果为素材组并保留表格来源到组的连线。 | **部分实现。** 列输出 Slot 可创建独立素材节点和素材组，并在素材节点保存来源属性；没有建立持久表格到素材组的原生连线。单元格和列菜单尚无统一输出入口。见 [P-M07 产品说明](P-M07-multidimensional-table.md)。 | 增加单元格和列输出命令；禁止整行和多单元格选区输出；定义稳定输出身份和来源关系；在原生工作流创建可保存、可撤销、重载后仍有效的表到组连线；失败时原子回滚新增成员、组和连线。 |
| `GAP-M07-03` | `P-M07` 多维表格 | 按列输出跳过空单元格和失效引用，按素材身份去重并保留首次出现，再按文本、图片、视频自动拆成独立组；无有效内容时不创建空组。 | **未实现。** 当前 [素材输出实现](../../frontend/src/application/table_material_output.mjs) 只筛选带 URL 的图片/视频，按任务行分组，不处理文本、跨行列去重或按类型拆分；通用表格素材输出仍复用行段分组。 | 将列选择、过滤、去重和类型拆分做成共享纯函数；按表格行序、单元格内顺序稳定输出；为每个非空类型组建立来源关系；覆盖空值、失效、重复和混排图片/视频测试。 |

## 相关目录树

以下只列出本清单涉及的入口。编辑源码时只修改 `frontend/src/`，`web/` 是
`npm run build` 生成的副本；测试、用户工作流、模型权重和截图仍按仓库约束放在
`.local/` 或规定测试目录。

```text
ComfyUI-DAELab-Creative-Studio/
├─ docs/
│  ├─ adapter-contract.md
│  ├─ material-groups.md
│  ├─ task-contract.md
│  ├─ MODELS.md
│  ├─ architecture/
│  │  ├─ FRONTEND_INTERACTION.md
│  │  ├─ EDITING.md
│  │  ├─ JOBS_ASSETS.md
│  │  └─ LOCAL_GENERATION.md
│  ├─ product/
│  │  ├─ MODULE_MAP.md
│  │  ├─ P-M05-material-groups.md
│  │  ├─ P-M07-multidimensional-table.md
│  │  ├─ P-M11-generation-task-control.md
│  │  ├─ P-M11-generation-task-progress.md
│  │  ├─ P-M13-model-provider-management.md
│  │  └─ IMPLEMENTATION_GAPS.md
│  └─ validation/
│     ├─ STATUS.md
│     ├─ TABLE_PILOT_ACCEPTANCE_20261027.md
│     ├─ GENERATION_OUTPUTS_20261030.md
│     └─ LOCAL_GENERATION_20261029.md
├─ frontend/src/
│  ├─ application/
│  │  ├─ table_editor.mjs
│  │  ├─ table_exchange.mjs
│  │  ├─ table_material_columns.mjs
│  │  ├─ table_material_output.mjs
│  │  ├─ table_model.mjs
│  │  ├─ table_presentation.mjs
│  │  └─ table_workbench.mjs
│  ├─ canvas/
│  │  ├─ creative_canvas_view.mjs
│  │  ├─ creative_connections.mjs
│  │  ├─ creative_input_exchange.mjs
│  │  ├─ creative_material_drop.mjs
│  │  └─ creative_output.mjs
│  ├─ features/
│  │  ├─ assets/
│  │  │  ├─ media_upload_model.mjs
│  │  │  └─ text_input_model.mjs
│  │  ├─ groups/
│  │  │  ├─ material_group_model.mjs
│  │  │  ├─ material_groups.mjs
│  │  │  └─ material_groups.css
│  │  ├─ table/
│  │  │  ├─ editor_runtime.mjs
│  │  │  ├─ table_context_menu.mjs
│  │  │  ├─ table_material_item.mjs
│  │  │  ├─ table_material_output.mjs
│  │  │  ├─ table_structure.mjs
│  │  │  ├─ view.ts
│  │  │  └─ table_ui.css
│  │  ├─ generation/
│  │  │  ├─ table_generation_model.mjs
│  │  │  ├─ table_generation_panel.mjs
│  │  │  ├─ table_generation_tasks.mjs
│  │  │  ├─ task_snapshots.mjs
│  │  │  ├─ video_tasks_model.mjs
│  │  │  └─ video_tasks_panel.mjs
│  │  └─ prompt/
│  │     ├─ llm_io_panel.mjs
│  │     ├─ prompt_optimization_controller.mjs
│  │     ├─ prompt_optimization_panel.mjs
│  │     └─ table_prompt_settings.mjs
│  └─ integrations/comfyui/
│     ├─ health_client.ts
│     ├─ index.ts
│     ├─ business/
│     │  ├─ business_document_host.ts
│     │  ├─ comfy_pricing.ts
│     │  ├─ generation_output_nodes.ts
│     │  └─ table_capabilities.ts
│     └─ canvas/
│        ├─ canvas_host.ts
│        ├─ generation_output_binding.ts
│        └─ material_group.js
├─ backend/
│  ├─ jobs/
│  │  └─ ledger.py
│  ├─ generation/
│  │  ├─ admission.py
│  │  ├─ assembly.py
│  │  ├─ http.py
│  │  └─ service.py
│  ├─ providers/
│  │  ├─ contracts.py
│  │  ├─ native.py
│  │  ├─ qwen.py
│  │  ├─ qwen_binding.py
│  │  ├─ deepseek.py
│  │  ├─ comfy_image.py
│  │  ├─ comfy_text.py
│  │  └─ comfy_video.py
│  └─ integrations/comfyui/
│     ├─ local_generation.py
│     ├─ services.py
│     ├─ generation_nodes/
│     │  └─ native_host.py
│     └─ canvas_nodes/
│        ├─ material_group.py
│        └─ material_output_api.py
├─ tests/
│  ├─ migrated_canvas/
│  │  ├─ creative_material_drop.test.mjs
│  │  ├─ creative_output.test.mjs
│  │  ├─ material_groups.test.mjs
│  │  ├─ mixed_group.test.mjs
│  │  └─ table_keyboard.test.mjs
│  ├─ migrated_business/
│  │  ├─ column_optimization.test.mjs
│  │  ├─ generation_output_nodes.test.mjs
│  │  ├─ prompt_optimization_controller.test.mjs
│  │  ├─ table_context_selection_cleanup.test.mjs
│  │  ├─ table_exchange.test.mjs
│  │  ├─ table_generation_polling.test.mjs
│  │  ├─ table_generation_task_snapshots.test.mjs
│  │  ├─ table_material_columns.test.mjs
│  │  ├─ table_material_output.test.mjs
│  │  └─ table_structure.test.mjs
│  └─ generation_frontend/
│     ├─ optimization_flow.test.mjs
│     ├─ session.test.mjs
│     └─ table_flow.test.mjs
└─ package.json
```

主修改入口：

| 差距 | 前端主入口 | 后端或宿主入口 | 定向测试 |
| --- | --- | --- | --- |
| `GAP-M13-01/02` | `generation/table_generation_panel.mjs`、`prompt/llm_io_panel.mjs`、`integrations/comfyui/health_client.ts` | `providers/*`、`integrations/comfyui/local_generation.py` | `table_local_qwen.test.mjs`、`llm_provider_transport.test.mjs`、`qwen_contract.test.mjs` |
| `GAP-M11-01/02` | `generation/table_generation_tasks.mjs`、`generation/task_snapshots.mjs`、`prompt/prompt_optimization_controller.mjs` | `jobs/ledger.py`、`generation/service.py`、`providers/contracts.py` | `table_generation_polling.test.mjs`、`table_generation_task_snapshots.test.mjs`、`prompt_optimization_controller.test.mjs` |
| `GAP-M05-01` | `features/groups/material_group_model.mjs`、`material_groups.mjs` | 无独立后端入口 | `material_groups.test.mjs`、`mixed_group.test.mjs` |
| `GAP-M07-01` | `application/table_presentation.mjs`、`features/table/editor_runtime.mjs` | `integrations/comfyui/canvas/canvas_host.ts` | `table_context_selection_cleanup.test.mjs`、`table_keyboard.test.mjs` |
| `GAP-M07-02/03` | `application/table_material_output.mjs`、`canvas/creative_output.mjs`、`canvas/creative_connections.mjs` | `integrations/comfyui/canvas/canvas_host.ts`、`canvas_nodes/material_output_api.py`、`canvas_nodes/material_group.py` | `table_material_output.test.mjs`、`creative_output.test.mjs`、`generation_output_nodes.test.mjs` |

`features/table/table_context_menu.mjs` 和 `features/table/table_material_output.mjs`
当前都是兼容转发，分别指向 `application/table_presentation.mjs` 和
`application/table_material_output.mjs`。新增逻辑应进入 application 下的正式拥有模块
或拆分后的新拥有模块，不能把第二套实现写进兼容文件。

## 建议实施顺序

1. 先实现共享菜单控件与 `P-M07` 表内纵向菜单，完成视觉、键盘和边缘定位的独立验收。
2. 落实 `P-M05` 同类型约束，为表格输出的类型拆分和素材组消费提供统一前提。
3. 实现 `P-M07` 单元格/列输出命令、过滤去重、类型拆分和持久连线，补充端到端保存重载测试。
4. 建立 `P-M13` 统一模型目录和隐式可用性状态，作为生成与 LLM 节点的共同基础。
5. 在统一模型能力上完成 `P-M11` 任务控制与真实进度，最后进行真实本地模型和规定宿主范围的验收。

## 明确不在本轮改造范围

- 不给整行或多单元格选区增加输出能力。
- 不增加“选择要输出的素材类型”步骤；混排内容直接拆分。
- 不为旧工作流中的混合类型素材组设计迁移或兼容改造。
- 不把 Figma 设计稿、单元测试或合成任务报告视为功能完成证据。

## 验收边界

前端交互需要在隔离 ComfyUI 中使用两个实例检查保存重载、模式往返、焦点、菜单裁切和状态隔离。
真实模型验收仍仅使用仓库规定范围内的本地模型；本轮没有授权新增云调用或付费生成。
相关 F/AC/UC/TC 编号需要在实施前补入现有能力目录，未执行和未验证项不能记为通过。
