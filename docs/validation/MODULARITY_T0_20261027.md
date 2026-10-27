# 表格模块化基线

2026-10-27。T0 源码基线：963cb6a。此记录仅覆盖依赖盘点与离线测试。

## 依赖与公共入口候选

| 文件 | 相对导入 |
| --- | --- |
| daelab_studio_theme.mjs |  |
| data_table_editor.mjs | ../prompt/table_prompt_source_header.mjs<br>../generation/table_generation_history.mjs<br>./table_cell_selection.mjs<br>./table_structure.mjs<br>./table_text_side.mjs<br>./table_content_view.mjs<br>./data_table_model.mjs<br>./list_editor_controls.mjs<br>./local_image_drop.mjs<br>./table_cell_choice.mjs<br>../prompt/table_prompt_model.mjs<br>./table_column_splitters.mjs<br>./table_video_references.mjs<br>../prompt/table_prompt_template.mjs<br>./empty_row_state_scope.js<br>./table_controls.mjs<br>./table_controls.mjs |
| data_table_groups.mjs | ./data_table_model.mjs<br>./data_table_editor.mjs<br>./local_image_drop.mjs |
| data_table_model.mjs | ../prompt/table_prompt_model.mjs<br>../prompt/table_prompt_template.mjs<br>./table_video_references.mjs<br>../prompt/table_prompt_source.mjs |
| empty_row_state_scope.ts |  |
| list_editor_controls.mjs | ../../ui/creative_events.mjs |
| local_image_drop.mjs |  |
| node_availability.mjs |  |
| table_cell_choice.mjs | ./list_editor_controls.mjs |
| table_cell_selection.mjs |  |
| table_column_splitters.mjs | ./data_table_model.mjs |
| table_content_view.mjs | ./table_inline_editor.mjs<br>../../ui/creative_events.mjs<br>../prompt/table_prompt_template.mjs<br>./table_reference_menu.mjs<br>../prompt/table_prompt_template_editor.mjs<br>./data_table_model.mjs<br>./table_controls.mjs |
| table_context_menu.mjs | ./table_material_columns.mjs<br>../generation/table_generation_model.mjs<br>../prompt/table_prompt_model.mjs<br>./data_table_model.mjs<br>./table_controls.mjs<br>../prompt/table_prompt_template.mjs<br>./table_content_view.mjs<br>../prompt/prompt_optimization_panel.mjs<br>../prompt/table_prompt_source.mjs |
| table_controls.mjs | ../../ui/creative_button.mjs<br>../../contracts/business.js |
| table_empty_node.mjs |  |
| table_exchange.mjs | ../../contracts/business.js<br>./data_table_model.mjs<br>./table_source_model.mjs<br>../prompt/table_prompt_template.mjs<br>../generation/table_generation_model.mjs |
| table_inline_editor.mjs | ./table_reference_menu.mjs<br>./list_editor_controls.mjs |
| table_material_columns.mjs | ../prompt/table_prompt_template.mjs<br>./data_table_model.mjs<br>../generation/table_generation_model.mjs |
| table_material_item.mjs |  |
| table_material_output.mjs | ../generation/table_generation_model.mjs |
| table_node_install.mjs |  |
| table_panel_views.mjs |  |
| table_reference_menu.mjs | ../prompt/table_prompt_source.mjs<br>../prompt/table_prompt_template.mjs |
| table_source_model.mjs | ./data_table_model.mjs |
| table_structure.mjs | ../generation/table_generation_model.mjs<br>./data_table_model.mjs<br>./table_controls.mjs<br>./table_structure_model.mjs<br>../../ui/creative_events.mjs |
| table_structure_model.mjs |  |
| table_text_side.mjs | ./table_controls.mjs<br>./list_editor_controls.mjs |
| table_video_references.mjs |  |
| table_workbench.mjs | ./data_table_editor.mjs<br>./node_availability.mjs |
| table_workbench_theme.mjs |  |

公共入口候选为 table/index.ts（模型与编辑器）和 contracts.ts（按实例注入的能力）。组合行为归 application，共享按钮、引用菜单和文本输入交互归 ui；保留旧路径薄转发至调用方迁完。

## 兼容与验收

原有夹具与断言：tests/migrated_business/data_table.test.mjs、table_material_columns.test.mjs、table_structure.test.mjs、table_inline_tab_boundary.test.mjs、table_transaction_serialization.test.mjs、table_exchange.test.mjs、table_generation_history.test.mjs。

执行：node --import ./tests/migrated_business/register.mjs --test 加上述七个文件；52/52 通过。node tools/check_architecture.mjs：144 模块通过。原始日志：忽略目录 .local/modularity/T0-tests.log。

后续新增反例：未知根字段往返、缺少列能力保留原值、两个编辑器的剪贴板/票据/卸载、迟到上传、公共入口违规与宿主反向依赖、预览产物排除。现有模型 normalizeTable 只返回 version/fields/records/view/meta，根级未知键未保留；先以反例固定后修复。

实际 ComfyUI 双实例、焦点/溢出、Active/Mute/Bypass、Graph/Canvas、保存重开、Slot、缩放/窄视口，以及同夹具性能均尚未执行。100 ms 既有失败保持。

## 现有追踪关联

| 任务 | F / AC / UC / TC / EV |
| --- | --- |
| TASK-M1-APPLICATION | F-CAN-013, F-CAN-027, F-SYS-002, F-SYS-005, AC-CAN-013-001, AC-CAN-013-002, AC-CAN-013-003, AC-CAN-027-001, AC-CAN-027-002, AC-CAN-027-003, AC-SYS-002-001, AC-SYS-005-001, UC-CAN-005, UC-CAN-006, UC-CAN-009, UC-CAN-010, UC-CAN-013, UC-SYS-001, UC-SYS-002, UC-SYS-003, UC-SYS-011, TC-CAN-002, TC-CAN-003, TC-CAN-006, TC-CAN-008, TC-CAN-011, TC-CAN-014, TC-CAN-018, TC-CAN-021, TC-CAN-024, TC-CAN-030, TC-CAN-032, TC-CAN-033, TC-CAN-042, TC-CAN-045, TC-SYS-003, TC-SYS-004, TC-SYS-005, TC-SYS-006, TC-SYS-008, TC-SYS-027, TC-SYS-032, EV-ARCH, EV-DATA, EV-E2E, EV-JOBS, EV-PERF, EV-UI |
| TASK-M3-APPLICATION | F-BIZ-007, F-BIZ-041, AC-BIZ-007-001, AC-BIZ-007-002, AC-BIZ-041-001, AC-BIZ-041-002, UC-BIZ-002, UC-BIZ-010, UC-BIZ-016, TC-BIZ-009, TC-BIZ-028, TC-BIZ-049, EV-ARCH, EV-JOBS |
| TASK-M4-APPLICATION | F-BIZ-033, AC-BIZ-033-001, AC-BIZ-033-002, UC-BIZ-009, UC-BIZ-011, UC-BIZ-013, TC-BIZ-002, TC-BIZ-019, TC-BIZ-036, TC-BIZ-038, TC-BIZ-042, TC-BIZ-049, TC-SYS-036, EV-ARCH, EV-DATA, EV-JOBS, EV-LOCAL |

以上关联沿用拥有 JSON 的既有规格，不将测试通过写为完整 TC/EV 验收通过。新增规格缺项在拥有 catalog 补充后重新生成。

### T2 补充追踪关联

T0 表仅列出了 application 任务；本次补充拥有 catalog 中的表格任务，原测试结果不变。

| 任务 | F / AC / UC / TC / EV |
| --- | --- |
| TASK-M3-FEATURES-TABLE | AC-BIZ-001-001, AC-BIZ-001-002, AC-BIZ-002-001, AC-BIZ-002-002, AC-BIZ-003-001, AC-BIZ-003-002, AC-BIZ-004-001, AC-BIZ-004-002, AC-BIZ-005-001, AC-BIZ-005-002, AC-BIZ-006-001, AC-BIZ-006-002, AC-BIZ-008-001, AC-BIZ-008-002, EV-DATA, EV-JOBS, EV-PERF, EV-UI, F-BIZ-001, F-BIZ-002, F-BIZ-003, F-BIZ-004, F-BIZ-005, F-BIZ-006, F-BIZ-008, TC-BIZ-001, TC-BIZ-002, TC-BIZ-003, TC-BIZ-004, TC-BIZ-005, TC-BIZ-006, TC-BIZ-007, TC-BIZ-008, TC-BIZ-010, TC-BIZ-011, TC-BIZ-045, UC-BIZ-001, UC-BIZ-002, UC-BIZ-004, UC-BIZ-016 |
