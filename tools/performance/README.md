# 固定性能夹具与观测

生成合成原生工作流、准备测试观察器、采集宿主遥测和分析性能样本。

源码入口：prepare_fixtures.py：合成工作流；prepare_observer.py：测试专用观察包；sample_host.py：只读遥测；analyze.mjs：记录分析；run_scheduler_plan.py：显式 PERF-06 HTTP 夹具。

协作边界：浏览器可见端点、固定样例、视口/缩放和采样条件共同决定证据资格。方法耗时、CPU 遥测和脚本成功不等于端到端输入延迟通过。

下述命令均从仓库根目录执行；依赖准备见 docs/DEVELOPMENT.md。

```powershell
python -m unittest discover -s tests/performance -p "test_*.py" -v
node --test tests/performance/*.test.mjs
```

