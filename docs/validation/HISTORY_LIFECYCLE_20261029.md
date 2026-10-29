# 工作流加载与历史初始化修复 · 2026-10-29

范围为 `history.captureCanvasState` 提示的已复现加载竞态，不是完整 M6 或发布验收。开发基线 `073f435e68476d4769a7996242a02a76e1c1d5ff`；验证构建指纹 `af74b02e469119b3ff24b08da1f1f7ed80179a942845082e1b7bf5429a92ca48`。

## 原因与修复

原生 `loadGraphData` 在配置节点之后才激活工作流和 ChangeTracker。此时 `isGraphReady` 已为 true，生成节点的微任务安装仍会先触发输入同步，经 document replace / history amend 请求 `captureCanvasState`。Toast 调用栈确认此时 activeWorkflow 没有 ChangeTracker；只监听控制台错误会漏掉该提示。

生成节点现在通过宿主生命周期边界安排安装：等待原生加载返回及其撤销／重做调用方继续执行后，在下一帧安装，并核验加载版本、当前图和节点身份。新加载、移除或重新配置会取消旧安装。加载期间暂停输入同步及编辑；真正缺失历史能力仍由既有历史桥拒绝。没有排队重放编辑，也没有改写原生历史实现或任务账本。

## 验证

- 基线连续 5 轮刷新／载入均捕获提示，保留首次失败和调用栈。
- 最终构建在独立安装、可选 ComfyTV 组合各执行 3 轮：共 6 轮，0 条历史诊断。每轮覆盖两组表格／生成节点、取消勾选和删除后恢复、结果引用／旧回执／单行配置、userdata 保存和刷新重载、Active/Mute/Bypass、50%/100%/150% 缩放与宽窄视口截图。
- 两环境各 4 次人为延迟 afterConfigureGraph：延迟期间未安装生成面板，完成后两个实例安装；原生撤销／重做恢复表格编辑，另一实例数据不变，0 条历史诊断。
- 生命周期单元测试覆盖合并安装、同 ID 替换、取消、失败加载、重叠加载、旧图回调和真实能力缺失；生成入口装配测试覆盖原生加载的调用方延续与双实例安装。
- `npm run check`：TypeScript、构建、架构、资源核验及前端／业务测试；执行结果见本机 `check-final.log`。前端 381 通过、3 项原有跳过；业务 566 通过。

宿主为 Windows CPU 隔离环境，ComfyUI `3c1b7a17fdf239d35ce98cc777756f572d089795`，可选 ComfyTV `a5e0c16b5ca7f74b31293c2f940a704107e4a009`，自动化使用 Chrome。端口 8330 为基线、8331 为修复版、8332 为可选组合；各有独立 user/input/output/temp。没有操作 8000 服务或提交模型任务。结果与回执是合成夹具，不证明真实生成恢复；人工输入法及完整 M6 不在本次范围。

追踪沿用 `TASK-M1-APPLICATION → F-CAN-013 → AC-CAN-013-001/002 → UC-CAN-006/010 → TC-CAN-003/011/014/018/021/032/033/042 → EV-ARCH/DATA/JOBS/UI`。本记录提供加载与历史子场景的补充证据，不将这些累计用例整体改为通过。

证据在独立工作区忽略目录 `.local/history-evidence/`：`before-rerun.log`、`traces.jsonl`、`final-reproduction.log`、`final-traces.jsonl`、`stress.mjs`、`stress.log`、`check-final.log`、`host-*.png`；隔离清单在 `.local/history-host-*`。首次探针过早导入宿主模块导致的测试准备失败保留在 `before.log`。早期修复构建的 `after-first.log` 仅为过程证据，最终结论使用上述指纹。
