# 安装开发版

当前为 `0.1.0-dev.0`，尚未通过 M6。请在独立 ComfyUI 环境安装，保留现用安装和数据。Studio 是单一 custom_nodes 包，不需要先安装旧 Canvas 或 Custom Nodes Library；同一环境检测到旧包会拒绝注册。

在独立 ComfyUI 根目录执行以下命令，`python` 必须属于该 ComfyUI 的环境：

```powershell
git clone https://github.com/TeutonicMepheles/ComfyUI-DAELab-Creative-Studio.git custom_nodes/ComfyUI-DAELab-Creative-Studio
python -m pip install -r custom_nodes/ComfyUI-DAELab-Creative-Studio/requirements.txt
```

仓库带有已生成的 `web/`，只运行产品无需 npm 构建。修改前端才需要 Node 24 与 `npm ci`、`npm run build`，见 [开发指南](DEVELOPMENT.md)。已验证的宿主条件及限制见 [T4 记录](validation/MODULARITY_T4_20261027.md)，不能据此推断所有 ComfyUI 版本均已验证。

启动该独立 ComfyUI。打开页面，在顶部“图形”菜单切换“创作画布”；双击空白处新建节点，或按 [使用指南](USAGE.md) 打开 Showcase。没有模型时可编辑、导入素材和保存工作流；生成能力需另行配置。

ComfyTV 是可选上游，不是安装依赖。Studio 的兼容适配不复制或修改上游源码；其依赖和可执行工作流仍由 ComfyTV 管理。本次组合安装只验证编辑与保存，未验证全部 ComfyTV 执行能力。

更新前先保存工作流，核对运行任务。源码更新后，前端修改需构建并刷新，后端修改需重启独立宿主；在途任务的核对要求见 [开发指南](DEVELOPMENT.md#独立宿主与重启)。不要通过重新生成掩盖尚未核对的原任务。
