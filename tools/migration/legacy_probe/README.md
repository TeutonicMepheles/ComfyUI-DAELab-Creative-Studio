# 隔离旧版观察器

给明确拥有的旧版测试 profile 提供代码指纹匹配后的运行观察及入口围栏。

源码入口：__init__.py：测试包入口；probe.py：只读状态观察和单调围栏；probe-manifest.json：允许观察的固定源码指纹。

协作边界：只安装到隔离旧版宿主的测试 custom_nodes；不是 Studio 正式节点，也不属于生产安装。输出只含限定元数据，不导出请求、结果或凭据正文。

包身份精确覆盖 `__init__.py`、`probe.py`、`README.md` 和 `AGENTS.md`。文档也校验原始字节的 SHA-256 与大小；修改后需同步 `probe-manifest.json` 及 `tools/migration/profiles.py` 的独立审核固定值。统一使用仓库约定的 LF 换行，不忽略未知 Markdown 或可执行文件。纳入文档后包身份已改变，旧身份的运行证据不能冒充新身份验收。

下述命令均从仓库根目录执行；依赖准备见 docs/DEVELOPMENT.md。

```powershell
python -m unittest discover -s tests/migration -p "test_legacy_probe*.py" -v
```

