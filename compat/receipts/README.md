# 历史回执

`reader.py` 提供 `inspect_receipts`、`read_receipt`、`inspect_database`。历史回执只提供来源、状态及已有结果的读取信息，不证明新版本已实际生成，也不能自动转成新账本的成功任务。

验证：`python -m unittest discover -s tests/migration -p 'test_*.py' -v`。数据库检查保持只读，凭据、未知提供方与异常结构需按现有校验处理。
