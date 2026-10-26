# 离线迁移与回滚工具

生成受版本约束的备份、迁移副本和 profile 描述，检查旧回执及原生资产数据库映射。

源码入口：__main__.py：CLI；prepare.py：预检、迁移和回滚副本；profiles.py：观察、封存和激活描述；host_database.py、sqlite_snapshot.py：只读数据库；safety.py：所有权与发布原子性。

协作边界：本工具不启动、停止或切换安装中的 ComfyUI 服务。源数据只读；只有显式创建的目标副本可写，激活描述与真实部署是两件事。

下述命令均从仓库根目录执行；依赖准备见 docs/DEVELOPMENT.md。

```powershell
python -m tools.migration --help
python -m unittest discover -s tests/migration -p "test_*.py" -v
```

