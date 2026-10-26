# 固定本地模型评估工具

冻结旧/新请求并核对固定输入、预处理和执行证据，维护任务到验收的追踪关系。

源码入口：prepare_local_inputs.py、prepare_studio_inputs.py：离线输入捕获；request_contract.py：请求比较；capture_h3_preprocessing.py：CPU 预处理；local_runtime_hooks.py：受约束运行观测；run_local_evaluation.py、local_batch.mjs：批次和槽位；traceability.mjs：追踪检查。

协作边界：固定模型、样例、顺序、哈希和失败记录构成比较依据。离线准备、真实推理和人工盲评分别留证；运行准入依赖独立宿主和登记清单。

下述命令均从仓库根目录执行；依赖准备见 docs/DEVELOPMENT.md。

```powershell
python -m unittest discover -s tests/evals -p "test_*.py" -v
node tools/evals/traceability.mjs --check
```

