# 前端协作入口

产品前端的唯一源码树在 frontend/src；web 是同路径构建产物。这里按设计、合同、应用用例、功能和宿主接入划分职责。

源码入口：src/README.md：模块导航；仓库根 tools/build.mjs：复制资源并编译 TypeScript；tsconfig.json：严格类型与输出目录。

协作边界：跨模块先确认数据归属：原生工作流保存编辑状态，后端账本保存任务事实，DOM 会话保存焦点与播放状态。

下述命令均从仓库根目录执行；依赖准备见 docs/DEVELOPMENT.md。

```powershell
npm run typecheck
npm run build
node tools/check_architecture.mjs
```

