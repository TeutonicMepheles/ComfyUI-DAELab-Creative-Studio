# backend

Python services for assets, durable jobs, prompts, local providers and media export.

contracts/ owns storage/error interfaces; integrations/comfyui/ owns host wiring; generation/, providers/ and media/ own application concerns.

Native workflows own editing data. SQLite owns task/asset facts; this package does not create another execution engine.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/unit -p "test_*.py" -v
python -m unittest discover -s tests/backend -p "test_*.py" -v
```

安装依赖与运行环境见 [安装指南](../docs/INSTALLATION.md)。本地模型配置的拥有入口为 integrations/comfyui/local_generation.py，字段说明见 [模型指南](../docs/MODELS.md)。纯后端测试使用临时存储与注入端口，不能替代真实持久化和宿主执行验收。
