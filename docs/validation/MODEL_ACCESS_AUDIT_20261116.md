# 18 项模型接入配置文档核对

日期 2026-11-16，基线 `47e597d`，分支 `codex/model-access-table-20261116`。任务 AIGC-1113-02；按用户要求盘点现有 18 项，不新增模型接入、不修改产品代码，也不执行暂缓的效果评估。

## 交付与依据

[配置表](../MODEL_ACCESS_CONFIGURATION_20261116.md)为主说明，[CSV](../MODEL_ACCESS_CONFIGURATION_20261116.csv)为 18 行、22 列的可筛选副本。覆盖 5 图片、9 视频、4 文本配置项；各行保留逻辑 ID、显示名、kind、目录路由和后端 provider，输入、参数、输出与接口映射使用同一组定义。

核对源包括前端 model_catalog、文本面板及 generation 参数入口，后端 generation/service、assembly、local_generation、各 provider、image_dimensions、prompt_rewrite，以及 model_manifest。历史验收引用原始记录；其提交、模式及精度边界不提升到当前代码。

会议输入来自 11 月 13 日会议摘要／任务指南；其 image/video/text/3d、input/parameters/output、开放属性和环境要求列入文档。尚未取得许可证或目标宿主快照的字段明确标待补，3D 仍为未实现需求，不作为第 19 个已有模型。

## 核对结果

- 18 项均存在目录与后端映射；不等于 18 项在当前面板都可选。独立文本面板过滤 Qwen3.5 并将旧选择映射为 27B，已记录为待产品确认。
- API 模型已有官方节点字段映射与 schema 读取；具体枚举／范围／默认值按宿主版本、模型、模式变化，标记为需目标能力快照，未伪造数值。
- 本地视频四档均为现行 Flex/LCM 路径，旧 20/8 步 FL/Ref 记录不作为四档实测通过。宽高 schema 步长与后端校验差异已列为待修正。
- 许可证／开放属性、统一环境策略和四类统一 schema 是不同缺口；文档完成不把程序任务或 M6 标为通过。

## 验证边界

执行本地文档链接检查、CSV 列数／记录数／逻辑 ID 唯一性与目录覆盖检查，以及规格／追踪一致性检查。具体最终命令结果见本记录收尾追加。原始核对日志保存在忽略的 `.local/model-access-document-checks.log` 与 `.local/model-access-coverage.json`。

最终结果：18 个逻辑 ID 与当前 MODEL_DEFINITIONS 逐项一致，CSV 每行 22 字段且无空字段，Markdown 总表和 CSV 身份一致，所列源码路径存在；5 image／9 video／4 text。8 个变更 Markdown 的本地链接及默认 128 文档检查通过；规格检查 126 功能／49 用例／146 测试、追踪检查 316 验收条件通过。初次覆盖脚本把其他章节的 T27/I01/I02 行误计为目录记录，限定到总表章节后通过；首失败保留 `model-access-document-checks-first.log`，未改模型清单来迎合脚本。

本轮不修改 frontend/backend/web；不重建前端、不改构建指纹、不运行 GPU、宿主 UI、付费或其他模型请求。既有模型与 Bug 验收保留原结论，不重复宣称。
