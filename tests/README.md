# tests

Portable regressions, public synthetic fixtures and explicitly isolated host/evaluation harnesses.

requirements.txt pins Python dependencies; .github/workflows/checks.yml lists complete CI commands. application/, migrated_*/ and generation_frontend/ cover frontend rules.

A CI pass does not establish real browser/GPU quality, latency budgets or M6 acceptance.

Focused checks, from the repository root:

```powershell
npm run check
python -m unittest discover -s tests/unit -p "test_*.py" -v
```

表格定向入口为 `npm run test:table`；真实浏览器入口为 `npm run test:table:ui`，用例位于 dev/table/tests，结果保留在忽略的 .local/modularity。浏览器环境、模拟范围与停止方式见 [预览说明](../dev/table/README.md)。架构反例由 tests/unit/architecture.test.mjs 维护。

提示词编辑区的真实 ComfyUI 回归入口：[browser/requirements_layout.mjs](browser/requirements_layout.mjs)。显式设置 `STUDIO_TEST_URL=http://127.0.0.1:8366` 后运行 `node tests/browser/requirements_layout.mjs`；仅允许回环 `.local` 隔离宿主，拦截所有生成请求。检查两实例、五行可读高度、聚焦、润色/反推、保存重开、图形/画布与缩放；输出证据位于忽略的 `.local/`。

提示词列按钮的真实宿主回归：显式设置 `STUDIO_TEST_URL` 后运行 `node tests/browser/prompt_source_header.mjs`。验证指定/重复点击不弹窗、旧事件不复活、配置保留、两实例隔离、保存重开和画布缩放；仅访问回环 .local 宿主，生成请求全部拦截。

连续上传回归：显式设置 `STUDIO_TEST_URL` 后运行 `node tests/browser/material_upload_add.mjs`。上传合成 PNG，检查初次/再次上传、删除后追加、保存重开、两实例和缩放下的固定“＋”入口；拦截生成请求，不执行模型。仅使用回环 .local 隔离宿主。
