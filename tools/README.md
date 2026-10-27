# 开发与验收工具

维护构建、架构与资源校验，以及独立宿主、迁移、评估、性能和候选打包工具。

源码入口：build.mjs：同路径复制和 TS 编译；check_architecture.mjs：导入边界及环；verify_assets.mjs：字体哈希和许可；子目录分别负责实验准备和证据合同。

协作边界：产品运行代码属于 frontend/backend；工具输出默认进入忽略的本地数据目录，不能混入正式节点菜单或把准备文件当作验收通过。

下述命令均从仓库根目录执行；依赖准备见 docs/DEVELOPMENT.md。

```powershell
npm run build
node tools/check_architecture.mjs
node tools/verify_assets.mjs
```

表格公共边界由 `table_boundary.mjs` 定义，并纳入 `check_architecture.mjs`。规则回归：`node --test tests/unit/architecture.test.mjs`，包含故意违规夹具。独立预览见 [dev/table](../dev/table/README.md)。

