# 兼容读取

兼容层保存旧工作流、旧回执和收藏的原始信息，输出可见报告或显式导入结果；不重新启用旧生成执行通道。

| 目录 | 职责 |
| --- | --- |
| [workflows](workflows/README.md) | 未知节点/字段报告与历史节点只读原生 schema |
| [receipts](receipts/README.md) | 历史任务回执和数据库只读检查 |
| [legacy](legacy/README.md) | 旧浏览器收藏规范化与幂等导入 |

验证：`python -m unittest discover -s tests/migration -p 'test_*.py' -v`，以及 `node --test tests/migration/readonly_nodes.test.mjs`。

输入是原始旧工作流/回执/收藏，输出是规范化视图、报告或显式导入结果；未知内容继续保留。没有独立浏览器入口，需在隔离宿主核对可见报告与原生保存；安装冲突与只读兼容是不同路径，见 [排错入口](../docs/TROUBLESHOOTING.md)。
