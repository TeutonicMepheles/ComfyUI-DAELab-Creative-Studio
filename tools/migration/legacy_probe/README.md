# 隔离旧版观察器

给明确拥有的旧版测试 profile 提供代码指纹匹配后的运行观察及入口围栏。

源码入口：__init__.py：测试包入口；probe.py：只读状态观察和单调围栏；probe-manifest.json：允许观察的固定源码指纹。

协作边界：只安装到隔离旧版宿主的测试 custom_nodes；不是 Studio 正式节点，也不属于生产安装。输出只含限定元数据，不导出请求、结果或凭据正文。

下述命令均从仓库根目录执行；依赖准备见 docs/DEVELOPMENT.md。

```powershell
python -m unittest discover -s tests/migration -p "test_legacy_probe*.py" -v
```

