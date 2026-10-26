# 单包候选准备

候选打包器已通过合成 Git 仓库和真实 ZIP 回归。尚未从本项目完整提交生成产品候选，
没有发布、安装或执行清洁宿主验收。所有生成清单固定为 `releaseAllowed=false`，
状态为 `candidate-not-accepted`；打包成功不改变 M1–M6 验收结论。

## 输入与归档边界

`tools/release/package_candidate.py` 只接受完整的 40 位 Git commit SHA。
通过 Git tree/blob 对象读取内容，不读取工作树或暂存区。源码中的链接和 submodule 会拒绝打包。
真实候选应由维护者在统一检查、构建和提交后显式生成；工具不会执行 npm build、模型或安装流程。

ZIP 顶层为 `ComfyUI-DAELab-Creative-Studio/`，只包含：

- 根 `__init__.py`、`pyproject.toml`、`requirements.txt`、`package.json`、`README.md`，以及已存在的根 LICENSE/NOTICE 文件。
- `backend/` 与 `compat/` 的生产 `.py` 文件。
- `web/build-manifest.json` 精确登记的全部编译文件、静态资源与第三方许可证。
- `tools/migration/` 的离线 Python 迁移工具。
- `docs/` 的 Markdown、JSON、CSV 文档。
- 生成的 `release-candidate.json`，包含提交、版本、前端构建 ID、逐文件大小及 SHA-256。

排除规则同时作用于子目录：`frontend`、`node_modules`、测试、`.local`、Git 数据、虚拟环境、
缓存、密钥/凭据文件、模型权重后缀和数据库均不进入候选。若此类内容进入 `web` 的正式清单，
工具会拒绝整个候选。凭据排除依赖明确路径/后缀规则，不能替代提交前的源码与内容审查。

路径必须相对、规范且可用于 Windows：拒绝 `..`、绝对路径、反斜线、盘符/数据流、控制字符、
保留设备名、尾随空格/点以及大小写路径别名。ZIP 内无可执行链接，每个文件使用固定时间戳、
权限和排序。在相同 Python/zlib 工具链中，同一提交产生相同字节。已有输出文件以 `xb` 拒绝覆盖。

## 构建、版本和许可校验

工具核对 Python 版本与 npm 的对应表示（例如 `0.1.0.dev0` / `0.1.0-dev.0`），
要求 web manifest 版本与编译入口 `STUDIO_VERSION` 相同；`FRONTEND_BUILD_ID` 必须与
manifest 的 64 位 `sourceFingerprint` 一致。每个 web 文件必须存在且哈希相同，重复、漏项和
未登记 web 文件都拒绝。这里核对已构建产物的一致性，不宣称重新编译或复现源树构建。

`requirements.txt` 的有效依赖行必须与 `pyproject.toml` 的 runtime dependencies 完全一致。
必须保留 Alibaba PuHuiTi、Remix Icon、Remix 业务源原始字节版本和 model-icons 的 4 项许可证。
三款字体还要通过其内部清单的文件名、长度和 SHA-256 校验；即使重写 web manifest，也不能用
缺失或被修改的字体绕过这一层。源码许可继续沿用 `docs/provenance/README.md` 的限制，
候选工具不授予来源代码新的许可。

## Python 元数据与 ComfyUI 安装形式

`[tool.setuptools] packages=[]` 显式禁用自动 package discovery。
构建后端固定为本次验证的 `setuptools==79.0.0`。合成目录中放入 `backend`、`compat`、
`frontend`、`node_modules` 和根 `__init__.py` 后，实际调用 `build_wheel` 只生成 `.dist-info`
元数据；依赖和版本正确保留，没有导入或收集上述代码。

这个 metadata-only wheel 不是 ComfyUI 产品安装物。ComfyUI 运行时需要目录 ZIP 内的根入口、
Python 模块和完整 `web`；Python 依赖由 `requirements.txt` 声明。候选已带编译产物，
使用候选的用户无需 Node.js/npm。上述结论来自打包合同测试，清洁 ComfyUI 的安装、启动、
模式、保存重开与回滚仍待 M6 实际执行。

## 验证记录与使用

首次测试发现 `docs/credentials.json` / `docs/secrets.json` 会被宽泛文档规则带入，
首失败保存在 `.local/baseline/release-candidate-tests-first.log`。修复后回归覆盖：
真实 ZIP 解压及逐文件哈希、确定性、缺资源、改字节、版本/依赖/内嵌 ID 错误、路径越界、
大小写冲突、禁止内容、已存在输出保护、指定提交隔离工作树/暂存区、Git symlink 拒绝，
以及实际 metadata-only wheel 构造。测试只使用临时合成仓库，不安装产品或读取私密源数据。
当前 9 项测试全部通过，最终日志为 `.local/baseline/release-candidate-tests-final.log`。

```powershell
python -m unittest discover -s tests/release -v
python -m tools.release.package_candidate --revision <FULL_COMMIT_SHA> --output <NEW_OUTPUT_PATH.zip>
```

测试使用已安装的 setuptools/packaging；CI 的独立候选检查步骤固定安装测试构建依赖后运行。
CI 原有 media_export 检查保留。产品候选步骤须等待完整提交，不能用工作树假装一个版本。
