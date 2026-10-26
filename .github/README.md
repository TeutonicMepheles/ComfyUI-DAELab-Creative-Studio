# GitHub 协作

`workflows/checks.yml` 为 push 和 PR 运行纯代码、构建与 CPU 测试。当前没有自动发布、部署或创建标签的流程。

PR 写明问题、修改后的行为、验证和未完成项；审核与当前提交的 CI 都通过后合入 main。产品发布仍受 M6 限制。

检查入口：仓库根目录 `npm run check`，其余 Python、夹具和清单命令以 workflow 为准。
