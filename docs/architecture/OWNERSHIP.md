# 单包模块归属

迁入的交互和控件规范保留其历史来源说明；其中“画布仓库”和“业务库”
在本产品中分别对应 canvas/design/ui 与 features/application/backend。
旧仓库资源路径不再作为运行地址。来源基线与文件哈希见 docs/provenance。

通用控件保留唯一源码：frontend/src/ui/creative_button.mjs、creative_field.mjs、
creative_panel_state.mjs；主题与字体在 frontend/src/design。
ComfyUI 全局对象、注册、菜单和历史桥接在 integrations/comfyui。
features 通过公开 adapter v1 和注入的服务通信。

成熟 ESM 的迁入不代表已经完成所有状态架构重构。当前新文档控制器提供
事务与迟到结果校验端口；每个功能接入及真实宿主验收分别记录，不能把
控制器存在或单元测试通过当作全部编辑入口已经改造完成。

测试专用 StudioTest.Panel 位于 tests/host_fixture。隔离启动器显式安装时
才会出现；产品构建和发布范围均不包含该夹具。
