# 兼容读取

兼容层保存旧工作流、旧回执和收藏的原始信息，输出可见报告或显式导入结果；不重新启用旧生成执行通道。

| 目录 | 职责 |
| --- | --- |
| [workflows](workflows/README.md) | 未知节点/字段报告与历史节点只读原生 schema |
| [receipts](receipts/README.md) | 历史任务回执和数据库只读检查 |
| [legacy](legacy/README.md) | 旧浏览器收藏规范化与幂等导入 |

验证：`python -m unittest discover -s tests/migration -p 'test_*.py' -v`，以及 `node --test tests/migration/readonly_nodes.test.mjs`。
