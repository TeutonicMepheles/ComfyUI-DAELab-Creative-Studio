# GitHub 协作

`workflows/checks.yml` 为 push 和 PR 运行纯代码、构建与 CPU 测试。当前没有自动发布、部署或创建标签的流程。

PR 写明问题、修改后的行为、验证和未完成项；审核与当前提交的 CI 都通过后合入 main。产品发布仍受 M6 限制。

构建后校验提交的 `web/` 产物：`node tools/check_build_manifest.mjs` 逐条比对清单 SHA 与文件字节，并核对 `FRONTEND_BUILD_ID`；随后 `git diff --exit-code -- web/` 确认构建结果与提交一致。文本文件哈希前按 `.gitattributes` 统一行尾，`-text` 路径保持原字节，因此 CRLF 工作区与 LF 检出得到同一份产物。

检查入口：仓库根目录 `npm run check`，其余 Python、夹具和清单命令以 workflow 为准。
