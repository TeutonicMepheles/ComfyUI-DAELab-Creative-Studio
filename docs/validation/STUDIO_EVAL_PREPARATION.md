# 新版离线最终请求捕获

`tools/evals/prepare_studio_inputs.py` 已构造固定 10 个新版请求，与旧版
`.local/local-eval-preparation/1792859601674585100/` 逐项比较。8 项直接通过请求比较；
H3 首帧、首尾帧两项保留共 3 个输入路径差异，尚待审核。所有有效输入投影一致。
这是请求构造证据，不是推理、性能、界面或 M4 验收。

## 生产入口与边界

| 样例 | 实际使用的新版生产实现 |
| --- | --- |
| 独立文本润色、两项图片反推 | `backend/providers/qwen.py:qwen_request`；图像经真实资产服务冻结，再读取冻结字节，执行其 `image_payload` |
| 两项表格逐行优化 | `frontend/src/features/prompt/prompt_optimization_model.mjs:freezeSnapshot` → `qwen_request` |
| 两项 Qwen 图像、三项 H3 视频 | `NativeProvider.build` 与显式 `ModelInventory`；媒体经 `CoreServices.assets`、`freeze_reference`、`stage_native_input` |

正文、系统指令、上下文、输出预算、温度从新 Qwen body 提取。图像/视频的种子、尺寸、步数、
采样器、调度器、帧数、帧率、模型文件名和提示词从新 graph 提取；输入时长来自新 provider
验证后的 settings。参考帧顺序依据新 graph 的 `first_frame`/`last_frame` 连线，解析真实 staged
文件并以内容哈希匹配公开夹具。没有用旧 `effective` 回填新版结果。

所有 Python 构造运行于拒绝网络和子进程的守卫中。唯一构造子进程是显式 Node 纯 ESM
快照构造器，其内部同样禁用网络与子进程。Node 版本探测是另一项只读工具调用。
没有执行 provider 的 `preflight`、`create`、`capabilities`，没有 HTTP、宿主队列、模型加载、
Ollama 启动或下载。独立 SQLite 中 `jobsCreated=0`。

权重名称和 SHA-256 来自固定 M0 runtime；native 映射再次检查文件存在及大小。
本工具没有重新读取数十 GB 权重计算哈希，没有验证宿主当前注册或实际加载权重。
报告明确记录 `weightRehashExecuted=false`。真实执行前仍需 production binding 的完整校验。

## 内容寻址差异

| 输入 | 旧路径 | 新路径 | 实际文件字节 |
| --- | --- | --- | --- |
| 首帧 | `daelab/table-local-h3/motion-first.png` | `daelab/creative-studio/frozen/52b94cd93f793d284f0b6bbad3c3de53d7b9ec008d7dd10a6c5f0a7e6b654401.png` | 1462 bytes；两路径逐字节相同，SHA-256 为文件名主体 |
| 尾帧 | `daelab/table-local-h3/motion-last.png` | `daelab/creative-studio/frozen/fb3a32a9bba4fb5cec0736b58c0d6d12543660ca808dbcbe1b54baf8aebd9deb.png` | 2249 bytes；两路径逐字节相同，SHA-256 为文件名主体 |

比较器仍是 `tools/evals/request_contract.py:compare_requests`，未修改其门禁。
每个路径候选保留精确 JSON pointer、旧/新字段哈希、原生路径、实际内容哈希、长度及
`reviewStatus=pending-human-review`。工具不填写 reviewer，不自动将候选作为批准的差异说明。
`LOCAL-H3-002` 和 `LOCAL-H3-003` 的 `passed=false` 保持原样；它们的
`immutableEffectiveDifferences` 与 `immutableModelRequestDifferences` 均为空。

关联的 H3 CPU 演练 `.local/h3-preprocessing/1792860459385683600/preprocessing.json`
仅以文件哈希和夹具清单哈希关联，不将其张量哈希冒充新一轮 live 模型输入。
真实执行仍须捕获 tokenize/VAE 边界，并关联真实加载权重和采样执行证据。

## 当前证据

- 首次构造：`.local/studio-eval-preparation/1792865516070485600/`。
- 最终构造：`.local/studio-eval-preparation/1792865645734511000/`。
- 最终 `preparation.json` SHA-256：`fba84fd1f22cefae090e30050f617a0fd1be81d1d2102689b98337de5273d910`。
- 准备器 SHA-256：`c0d18e60e268f9512739844b16299bd4286cfdcd8ee791f576cad660eae776a6`。
- 39 项实际源码闭包指纹：`3aa8b3b39d00bd63fea2e669c95055dbd2aeeb4a0a377f7969c13bd601ea1d78`。
- 两轮 10 个完整 capture 文件逐字节相同，报告 `.local/baseline/studio-eval-repeatability.json`。
- 构造日志 `.local/baseline/studio-eval-preparation-final.log`；首轮和最终测试日志
  `.local/baseline/studio-eval-tests-first.log`、`studio-eval-tests-final.log`。

捕获清单包含 runtime、夹具、旧捕获清单、工具、Python/ESM 生产闭包及每个新请求/比较报告哈希，
并记载实际 Python、Pillow、Node 版本。构造前后验证源码及输入未改变。旧请求只在新请求已构造后
读取并校验其原清单哈希。所有输出目录新建，错误保存 `first-failure.json`，不覆盖之前证据。
本轮 6 项新增回归首次通过，无需伪造首次失败。

## 运行与回归

在仓库根目录使用固定 Python 环境：

```powershell
python -m tools.evals.prepare_studio_inputs --h3-preprocessing .local/h3-preprocessing/1792860459385683600/preprocessing.json
python -m unittest discover -s tests/evals -v
```

最终 Eval 工具共 22 项测试通过。新增 6 项验证真实 10 请求构造不调用执行能力、新 body/graph
独立投影、夹具字节修改拒绝、旧捕获哈希修改拒绝、异名同字节保持待审核、异名不同字节拒绝说明。
测试权重是明确的单字节构造夹具，不代表合法可加载模型，也不会进入生产。
