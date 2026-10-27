# 模块化文档整理

日期：2026-10-27。安装、首次使用、模型配置、排错和开发导航已按实际实现整理；不升级表格试点或 M6 验收结论。

根 README 链接四份用户指南和独立表格预览。模型指南逐字段核对 `backend/integrations/comfyui/local_generation.py` 与实际提供方，未复制机器路径或虚构哈希。表格及相邻模块说明拥有入口、数据归属、能力、测试和未提供的独立页面。Showcase 的旧本机状态完整移至 [历史记录](SHOWCASE_20261026.md)，便携 JSON 和素材未改动。

生成 README 的目录深度与 frontend/src 不同；构建现在重定位相对 Markdown 链接，使其仍指向同一拥有源。两个规则测试覆盖源码/预览路径、锚点、带空格链接和外部链接。`npm run check:docs` 检查 126 份第一方 README 与主要指南的本地文件目标；外部网址与标题锚点不计入此检查。

执行范围包括文档链接、生成副本、catalog/traceability 一致性及完整 `npm run check`。D1 不修改产品运行源码；web 中变化为文档、构建清单和生成身份。实际宿主证据仍绑定 T4 指纹，不伪装成重新运行所有产品验收。原始检查日志位于 `.local/modularity/D1-*`。

完整检查结果：主套件 369 通过、3 跳过，业务套件 515 通过。扩展链接检查首次发现交互规范中的旧 `../validation.md` 已失效，现改为验证目录入口；首次结果保存在 `.local/modularity/D1-links-first.log`。
