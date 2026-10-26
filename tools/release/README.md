# 候选包构建

从一个完整、不可变 Git 提交生成确定性、允许清单约束的 ComfyUI custom_nodes 候选压缩包。

源码入口：package_candidate.py：文件选择、构建身份、哈希与候选说明。工作树中未提交内容不进入候选。

协作边界：只做打包，不发布、安装或运行模型；candidate-not-accepted 和 releaseAllowed=false 保持区分。正式发布仍由根 M6 门槛约束。

下述命令均从仓库根目录执行；依赖准备见 docs/DEVELOPMENT.md。

```powershell
python tools/release/package_candidate.py --help
python -m unittest discover -s tests/release -p "test_*.py" -v
```

