# 隔离宿主准备工具

创建有明确所有权的 CPU 或 GPU 测试环境，使开发和验收使用独立 user/input/output/temp。

源码入口：prepare_isolated.py：当前包 CPU 快照和启动；prepare_baseline.py：固定旧版 CPU 基线；prepare_gpu_evaluation.py：旧/新 GPU 准备与路径映射；prepare_optional_comfytv.py：可选上游组合环境。

协作边界：只有工具拥有的目标可复用；快照更新是显式操作。模型只按明确配置引用，主服务、用户程序和源仓库不作为可清理对象。

下述命令均从仓库根目录执行；依赖准备见 docs/DEVELOPMENT.md。

```powershell
python -m unittest discover -s tests/host -p "test_*.py" -v
python tools/host/prepare_isolated.py --help
```

可选 ComfyTV 使用 `python -m tools.host.prepare_optional_comfytv --help`。`--port` 可指定空闲回环端口；生产及已保留评估端口仍被拒绝，不会终止占用者。上游必须是工具中固定的干净提交；原始目录只读归档。

