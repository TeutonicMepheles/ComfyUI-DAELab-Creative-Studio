# 2026-10-25 实际性能观察

这些是指定构建上的原始观察，不代表阶段通过。所有首次失败和后续运行均保留；相关实现变化后须重测。

## 旧版 S 场景

固定 Canvas `3176b5a67dbcd0b66f795976e5a81bcdfe346093` 与业务库
`7ff56cb51ef6f7fc3bcf5707792d655037c61b30` 在独立 CPU 宿主运行。
原源码归档未改；仅显式安装零节点的被动观测包。
使用 `FX-PERF-S-no-video.json`、1920×1080、实际 DPR
`1.0000000298023224`（数值舍入，原值保留）、50% 画布起始缩放。

两组均先预热10秒，再采集五段各30秒；没有隐藏页面、缺段或删掉离群值。

| 操作 | 五段帧间隔 p95（ms） | 各段最大值（ms） | 数值观察 |
| --- | --- | --- | --- |
| 节点标题实际往返拖动150×100屏幕像素 | 13.4 / 13.4 / 13.4 / 13.4 / 13.4 | 40.0 / 40.0 / 53.4 / 40.0 / 40.1 | 此拖动子场景在预算内 |
| 实际工具栏连续放大、缩小 | 93.3 / 93.4 / 93.3 / 93.3 / 93.4 | 120.1 / 133.3 / 120.0 / 133.4 / 120.1 | 超过PERF-01的20ms预算 |

第一组是节点拖动观察，不能代替空白画布平移的全部协议。第二组记录了旧版已有的缩放性能问题；尚无对应新版数据，不能据此判断迁移退化。
新版首次加载同一工作流遇到LLM面板克隆宿主响应式对象的`DataCloneError`，导入被中止。该失败已留证，修复及重开核对完成后才能测量新版。

### JSON边界修复后的新版复测

`748e5c7`产品实现、前端指纹`c7a5aaac2d541a4a52c321b78f7855f34015203828c69e5e35c6d8d790fcfe3c`
已在8226实际重新导入同一S夹具，保存重开后100节点/100连线、稳定ID/类型、连线原始数组一致，
表格100行10列、34个LLM面板、两张320×180预览存在。两个LLM实例完成独立要求编辑、
撤销/重做、图形/创作画布/应用模式往返及保存重开；这仍不替代完整缩放/视口矩阵。

在相同1920×1080/DPR/50%起点、无视频场景，工具栏连续放大/缩小再次执行10秒预热与五段30秒。
五段交互帧间隔p95分别为106.7 / 93.4 / 93.4 / 93.4 / 93.4ms，最大值146.7 / 120 / 160 / 133.3 / 133.2ms。
全部段均无隐藏页面、缺样本或删点；**未达到20ms预算**。保留首段较高值，不选取最好段。
按钮倍率为×1.25/×0.8，实际50%与62.5%往返；旧版使用同一按钮轨迹。
热点归因仍需浏览器脚本/样式布局观察，不能仅由帧时间推定某个函数是根因。

本地报告：`.local/performance-actual/new-S-no-video-zoom-c7a5aa-raw.json`。
SHA-256：`b0a9b50b60f02e5d3e7577dcb9e333f2ef1cb21ea8904a391cb75e25e99e1532`。

本地原始报告：`.local/performance-actual/old-S-no-video-drag-and-zoom-raw.json`。
SHA-256：`7ba8331be66ad6e8aa83b4e21120e4a94d7bac55cef2a98a03eda5f2b9eda05f`。
操作说明及实际输入轨迹随本地报告保留，没有执行模型。

## 实际 ComfyUI 混合调度

新建的独立CPU宿主8236加载产品和显式v3测试包，正式菜单没有新增测试节点。
产品前端指纹为`17b2511c00cd5ee2065d6adae3d9c334f5db555d7b2f696d490413245291f30e`；
完整产品文件哈希、宿主身份和任务事件在原报告中。
测试使用真实GenerationService、SQLite、资产服务和共享资源门，以及确定性提供方替身。
fake-transcode执行有界PNG文件读写、哈希和资产回执验证，不执行视频编码或模型。

预热10秒后五轮各至少30秒，每轮100个新身份，共500个任务。

| 轮次 | 健康查询p95（ms） | 忙碌期p95（ms） | 最大值（ms） | GPU / cloud / transcode峰值 |
| --- | ---: | ---: | ---: | --- |
| 1 | 2.08 | 2.33 | 5.96 | 1 / 3 / 2 |
| 2 | 2.15 | 2.28 | 179.98 | 1 / 3 / 2 |
| 3 | 2.10 | 2.27 | 3.06 | 1 / 3 / 2 |
| 4 | 2.06 | 2.23 | 13.97 | 1 / 3 / 2 |
| 5 | 2.06 | 2.31 | 4.04 | 1 / 3 / 2 |

五轮全部调度检查通过，包含三种资源的真实排队取消、未知提交保留名额直到原身份恢复、无重复创建、无饥饿、结束名额归零及服务重建后只查询不创建。
服务重建不等同进程重启；本观察也不代替原生剪辑导出的实际验证。
追踪范围：F-SYS-010 → AC-SYS-010-001 → UC-SYS-008 → TC-SYS-019 / PERF-06。

本地原始报告：`.local/performance-scheduler-evidence/first-comfyui-run.json`。
SHA-256：`4c79acebbfd05e8b126ffb0ae63e006c10062ea96b88ac16687ada7702909246`。

另一次CI在同系列实现中发现取消确认与并发状态观察的版本竞争；同身份有界CAS重读已修复。
重启资源恢复也改用单次SQLite快照，避免任务从unknown变为running时被分状态扫描遗漏。
独立事件测试已覆盖这两条竞态，实际宿主重测尚待执行。
该变化影响GenerationService，所以上述结果保留为历史构建观察，修复后必须重新执行受影响检查，不能直接作为最终M4/M5退出证据。

### 取消/恢复修复后的实际复测

固定`748e5c707d0029d56515f930ed842061e93e432b`产品及同一不可变v3测试包，刷新8236后重复完整五轮500任务。
所有19类检查在五轮均为true：无重复创建、资源峰值1/3/2、排队取消不执行、未知任务保留名额至查询恢复、结束资源归零。
健康查询p95分别为2.10 / 2.07 / 2.08 / 1.99 / 2.01ms；各轮最大值4.93 / 196.05 / 16.58 / 27.94 / 12.90ms，均保留。
HTTP健康检查与真实原子资源计数覆盖恢复过程；共享资源门内部恢复SQL不经过分段计时代理，不能声称已测其单独SQL耗时。
这仍是假提供方/服务重建范围，不代替模型、进程重启或原生视频编码验收。

本地报告：`.local/performance-scheduler-evidence/cas-snapshot-comfyui-run.json`。
SHA-256：`2de4710b0ec86756fb2bd084ba2e80dab77d80ae17e080183aaba56d1f59abf3`。

## 连线帧测量候选与浏览器缓存复核

`94d1d8f0ef8b7a2afe06b687fe5b649487083472`将本帧磁吸和连线几何读放到样式写入前，
保留普通端口同帧位移、旧端口归零和合并端口固定锚点。规则回归通过不等于性能收益。
前端指纹为`513c6ebd416784711df4727ffc3189be05089c75de0f557a1604af6a575691db`。

第一次新标签页仍使用旧缓存模块：服务器文件SHA为新候选，浏览器长帧的sync源码位置仍为旧版47144。
该轮五段原件保留在`new-S-no-video-zoom-513c6e-raw.json`（SHA-256
`8aa1db593a90faebc6ff7cbc9021d196375bd04d2b7b1e1ef9d2843cccc2c424`），**构建身份未证实，不计候选成绩**。
在独立localhost来源重新载入后，sync位置47766与新源对应；该核验不是完整运行时源码哈希证明，
结合独立来源和服务器逐文件哈希消除了本次已发现的旧缓存证据。

确认新来源后重复同一S夹具、1920×1080、50%↔62.5%、10秒预热及五段30秒：
五段活动帧p95均106.7ms；最大值133.2 / 120 / 133.3 / 120 / 133.4ms。
无隐藏页面、缺段或删点，**仍未通过20ms预算，未证实此候选有性能收益**。
原件为`.local/performance-actual/new-S-no-video-zoom-513c6e-fresh-origin-raw.json`，
SHA-256 `6bc1efa95667736c0808a4a4eba7bf3a16df68c80fdb9e3e4cbe7a49147a275c`。

独立15秒诊断记录90个长帧，animateWires中25条脚本合计1934.4ms，其中1902.0ms为强制样式/布局，
两者不能相加。该数据只定位到回调，不能区分样式和布局的具体耗时，也不能代替五段预算。
下一步以显式测试样式逐项隔离缩放变量失效范围；任何改变标题补偿的诊断模式均不能算产品成绩。

## 表格正文缩放变量隔离候选

`c413bdcce74566ca683fa4dd72164d72977c61d3`只在拥有的表格正文数据格停止继承两项未消费的缩放变量；标题、行号栏、行调整柄和列接口保持原合同。
新端口8237首载确认实际100节点、两张320×180图像已加载、正文变量为空、行号栏仍为0.5；服务器CSS SHA与候选一致，代码响应禁止缓存。
前端指纹`7fd2630c1e2abed00e7f5eae287ef1e41a5c7007d6153842935dacd59418a678`。

同一公开S无视频夹具、1920×1080、50%↔62.5%、10秒预热及五段30秒，活动帧p95为
53.3 / 53.3 / 53.3 / 53.3 / 53.5ms，最大值106.7 / 106.7 / 80.1 / 80.1 / 119.9ms。
五段完整、无隐藏页面，较上一候选106.7ms有改善，**仍未通过20ms预算**。
原件`.local/performance-actual/new-S-no-video-zoom-7fd263-raw.json`，SHA-256
`6ae260ee983a74f44b1228c48b3c8431c322c0ebfbef3740338d7b5c47b2f455`。
另15秒热点诊断只用于剩余问题定位，不代替五段预算或双表交互验收。

后续CI又发现提交ACK落库前取消意图改变版本时丢失原task ID的竞态。
`467d4f9`保留同一ACK、延迟执行原任务取消；早先500任务结果保留为历史观察，修复后的首次复测与再次复测状态见下文。

## 行号栏候选回退与891c76复测

`1baeb8124ce9db54bd08eac26f661bfd16fd9100`的行号栏隔离候选，前端指纹
`7b6e5c3fb3da8596033805c60d905cf47d84bccc71bb8b058c1b1c28175173a7`，
在同一S无视频夹具、1920×1080、50%↔62.5%、10秒预热和五段各30秒下，
活动帧p95为66.7 / 79.9 / 53.4 / 79.9 / 66.7ms；最大值120.0 / 93.4 / 120.1 / 106.7 / 106.6ms。
五段完整且无隐藏页面，**FAIL：未达20ms预算，未证实行号栏候选收益**。
候选已由`92e12f79f41b16e879117cb4d8f35860c2aa1737`回退，失败数据仍保留。
原件`.local/performance-actual/new-S-no-video-zoom-7b6e5c-raw.json`，SHA-256
`4b4994df30814d48bb11dec0c429c048ba24c6f0b5deeee43c28c1795b918dc1`。

后续`8369c205fe1f2e0a9fb746d1b9e3daf368e85b58`，前端指纹
`891c76378b8d130639bf327c4bcff30dc277a4e7a671f1a4dbd990224217b2b2`，
同协议五段活动帧p95为40.1 / 40.0 / 40.1 / 40.1 / 40.1ms；
最大值93.4 / 80.1 / 106.6 / 66.7 / 93.4ms。五段完整且无隐藏页面，
数值较前次降低，**仍为FAIL：全部高于20ms，不能宣布PERF-01或阶段通过**。
原件`.local/performance-actual/new-S-no-video-zoom-891c76-raw.json`，SHA-256
`6e25ad270d5d4145248b68d77fb8710e4be25cdfebc741a683985ad928b197a3`。
两份summary均绑定上述原件哈希；短时热点诊断不计入这五段结果，也不替代语义完成、RSS或GPU测量。

## 891c76正文视口矩阵的证据边界

`.local/validation/body-zoom-891-actual/viewport-focus-matrix.json`共有36条记录，
逐条核对`viewport`后，**36条全部为1920×1080**，没有1280或680宽度样本。
不同分组或文件名不能替代实际视口尺寸；这些记录只能支持其已记录的1920×1080焦点/面板状态，
不能算1280/680响应式矩阵通过。此处记录时窄屏仍待补测；后续真实24条补测与限制见STATUS，原36条不改写。
该矩阵SHA-256为`6ca7483cadc667b8dd0c8290685cc88abf3c30d9b60ddce3db8015e083d69f58`。

## SVG候选复测与回退

`853c857d3044ff069b2cdf47d22ae7f6af0fddbc`的SVG候选，前端指纹
`cd21ec56cabd64ce14fe896a24c191158d5f621fb2b6dd1af553ca6433d47ddc`，
在同一S无视频夹具、1920×1080、50%↔62.5%、10秒预热和五段各30秒下，
活动帧p95为40.1 / 53.3 / 40.1 / 40.0 / 40.0ms；最大值106.6 / 93.4 / 106.7 / 93.3 / 93.3ms。
五段完整、无隐藏页面、无observer错误；**仍为FAIL：全部高于20ms，未证实SVG候选的明确收益**。
已由`c3d79aeb1f05375adea4a5963e049e8059fe10c9`回退，保留`891c76`的表格正文修复。

环境注记：采样期间另一个代理运行过0.846秒的定向测试。这是已知的并行负载干扰，不能据本轮差值
断言确定性能回归，也不能据此删点、删段或把失败改为通过；全部原始样本保留。
原件`.local/performance-actual/new-S-no-video-zoom-cd21ec-raw.json`，SHA-256
`017966be9499d85556b90ba929c11fb4e1448367555deebf0cb6e7350f688ed7`；
摘要`new-S-no-video-zoom-cd21ec-summary.json`（同目录），SHA-256
`882a5131b8cf469801290442a09151916635abe1d01a3124418ba287337d26b4`。
五段活动帧p95已由原始frame记录重新计算，未扣除并行测试期间的任何样本。

## 467d4f9后端的首次调度复测失败与再次复测

8236首次复测固定后端字节基线`467d4f94af23be6198986b05703d9598618227c4`，
五轮500个假任务已经执行，第一轮19项检查中`fixedOutcomes`失败；后四轮通过不能覆盖第一轮失败。
运行器从较早的pending快照选中取消目标，但实际`control_cancel`时该项已为running，
已有一次create和一次attempt，随后按原任务身份完成执行中取消。
旧运行器未把这一实际取消边界纳入预期分类，仍预期succeeded。此解释定位的是驱动分类错误，
**首次报告继续保留FAILED，不回填PASS，也不能当作排队取消的成功证据**。

原件`.local/performance-scheduler-evidence/early-cancel-ack-comfyui-run.json`，SHA-256
`59e3593ca27354fdfed44d90f3be3ae7cb4075204d60ec401f3851f96a10821c`；
事件分析`early-cancel-ack-first-failure-analysis.json`（同目录），SHA-256
`9283f369c0687c6fae7cf4c1d8b714eb9f69eb57b2ff5454f55305397fe463d2`。

驱动`ebae02188baffd265d5ae4426b0078bfb5682f11`改为依据实际原子取消边界、
预登记控制意图以及独立账本/提供方事件区分排队与执行中取消；不通过最终状态反推预期。
第二次完整复测已完成五轮500任务，每轮21/21检查通过：430成功、25预设失败、45排队取消，
提供方create共455次。各轮GPU/cloud/transcode资源峰值为1/3/2，结束时active、queued、retained及worker均归零。
健康查询2528次全部HTTP 200，合并p95为2.0701ms、最大226.6007ms；p95指标不能抹去这个单次最大值。
**本轮执行中取消样本为0**；`runningCancellationConfirmed=true`是对已出现样本的条件断言，
不能读成该边界已经实际覆盖。该边界另有确定性回归及前次失败留证，不能补作本轮样本。
自动报告仍为`requires_review`、`productAcceptance=false`；这是实际CPU隔离宿主上的确定性提供方替身，
不代表真实模型、GPU、云调用、进程重启或原生转码验收。

原件`.local/performance-scheduler-evidence/cancellation-boundary-comfyui-run.json`，SHA-256
`f1a92a99aa324e8d7555c087656aaca133e4940c30f6e6ce268301a8e99cbf5b`；
摘要`cancellation-boundary-summary.json`（同目录），SHA-256
`7082219daa0a65e95a8df14e2ca83f34241377dde4b41a7cbf79e452f4ca87de`。
启动证据`cancellation-boundary-start.json`（同目录），SHA-256
`66cadc4198f50d3fefdf31a273c46857d1f044ee608a327b7c333977c4751b12`。
宿主仍为8236的`1baeb81`候选、前端`7b6e5c`，后端字节对应`467d4f9`；只替换驱动，未把后来的前端成绩归给本次调度。

## M6离线准备边界

固定候选`2c7429ec4d571b31da31ae64fe2a29a7ff15351a`已完成独立旧/新安装的离线准备，
预检无阻断，migrate和prepare-profiles各重复一次成功；source/backup/working原字节相同，
离线准备记录当时两profile均READY且未激活，迁移自动回归97/97通过。
随后已选中round1-old并启动8244，完成旧版副本保存与重开演练；这不构成新旧切换或回滚通过。
实际probe在已激活fence且旧UI页关闭后仍报告`legacy-work-active`，只有legacyStacks线程计数为1，
其他工作登记和队列均为0。已定位探针自身堆栈归因缺陷，`observe-profile`真实失败原件保留，
**未获得clear observation、未seal，8245新版切换和回滚尚未执行**。修复后的新候选必须重新固定并演练；
随后根代理执行本试验专用abort：私有console成员与精确进程身份通过核验后仅发送一次CTRL_C，
两自有PID均已退出、8244无listener、无WAL/SHM/journal；这是失败试验的真实中止，
**未seal、未switch，不充当迁移通过证据**。原试验安装、数据与首失败证据均保留。
候选前端为`2d6ced4`，不能把后来`891c76`的测量归给这个候选。

准备证据`.local/m6-e5-ff079df-20261025/next-2c7429e/READY-OFFLINE.json`，SHA-256
`9f79250f2c215e7ed55de32c93fa69682763d157e0ea5d730d694da204f851a0`；
97项日志`.local/m6-e5-ff079df-20261025/identity-order-full-migration.log`，SHA-256
`d78382ebe05b7af52bf6b82db42766a70e4dba112acecf3abaa9299eb169c464`。
首次发行包探针依赖、Windows清单排序失败与私有交接脚本错误均留证，不能用离线准备替代M6验收。

旧版启动证据`next-2c7429e/actual/1792878734227191700-round1-old.ready.json`（同试验根），SHA-256
`efda3c2f71e8397744b772f8c544cf4e059a90ff8faea04452976fb31c02b4d9`；
fence调用记录`actual/1792879023150542300-fence-profile.json`，SHA-256
`20237a77928d3459a56f4f110d512ea9b0e7613c825f948a9913eeb177d294a9`；
首次observe拒绝`actual/1792879032102810400-observe-profile.json`，SHA-256
`292aa0edd37a6d31aaeb10320ecd18d9994831277a3f9a86aa85583f038f7f2b`。

失败中止记录`actual/old-abort-signal-result.log`，SHA-256
`474469a43920e518226929d59983c431a04309ece51c587cfa77d04a5fc0f135`；
独立退出检查`actual/old-abort-exit-check.json`，SHA-256
`d00beffc39e895ba15a14e2b3831985d899df1993314a92a50f65bba54fb2ce6`。
后续独立试验须保全本次旧profile的全部user/input/output数据，包括已保存副本和上传文件，
不能以最初seed覆盖实际编辑；待修复探针与候选固定后重新取得完整观察和正常停机seal。

## 77be887修复候选的冷保全与离线交接

失败试验停止后，完整保全原round1-old的user/input/output到新目录
`.local/m6-e5-77be887-20261025/cold/data`：8文件、12目录、307121字节，含实际保存副本、上传PNG和宿主DB。
复制前后原PID birth已退出、8244无listener、无进程绑定三个数据根、无SQLite sidecar；
源前后与副本完整文件/目录清单一致。原2c安装、原profile和所有失败证据未修改。
包含目录的清单SHA为`031fa1e12ea2bf1a963a48b2a45b9e7bcf0264cf782aee7cc17e986b029afb85`；
冷备份记录`cold/COLD-READY.json`，SHA-256
`37cc315fc538df447a81b2b23ff87b58110875cb145388df118ede5592355ce9`。
owner、原profile marker、退出和失败证据单独保存在`cold/provenance`，没有作为新profile身份导入。

固定修复候选`77be887aad74a51196ba45b5426e1262560f2166`、前端`891c76`和探针bundle
`9950e6c8b69c6dddb194ab8a40ed66ecfbda17126c1b33738b79d100d51bd84a`已建立全新旧/新安装。
发行包SHA-256为`0a92aea3a6f46c60dd8c54443d755ed9c5bc64a4d56c75b009fab73e565babd8`。
从候选发行树运行公开init/preflight/migrate两次/prepare-profiles两次均成功，预检blockers和safetyErrors为空。
`referenceRoots`明确绑定实际旧profile的三个根；8个文件全部映射，两目标的非DB文件与冷源字节相同，
各DB仅变换4个path/loader_path值，非路径metadata哈希前后相等。

离线交接时active=null、hostStarts=0、activations=0、fenceRequests=0；
没有调用缺少旧seal的capture，也没有把失败试验abort当作seal。该结果仅表明冷保全和离线装配完成，
这份记录截至离线交接；后续旧版实际演练与round2准备进展见下节，仍不构成M6通过。
同试验根`READY-OFFLINE.json`，SHA-256
`cc719e4e1bb046dcd9d45fa016fe229ce8f8353940179905a2494fb37aa2b06b`；
最终只读复核`POSTCHECK.json`，SHA-256
`da317bf7f0f9ac6ac6bbd6dd22abe6f6de0ee31d323fee0053462115a03ebdd3`。

## 77be887旧版实际停机与round2正式capture

在修复探针的独立旧宿主8244，round1-old已实际重新编辑并追加`RETRY-OLD-77`，
保存到磁盘后重新打开，文本保留；上传图片320×180可读。重开DOM记录
`actual/old-ui-reopened.txt`（本节均相对`.local/m6-e5-77be887-20261025/`），SHA-256
`d77b1af2c19e2af9440adf4a1cf8db5fa2de2949016b6026049aa0309a84cd9e`。
原始`M6-synthetic.json`未被本次编辑覆盖，包含unknown字段的原件SHA仍为
`bf10cf4b6d5fd7751ffc4f2f1ba557ce17be2759feb074a5f9870d7c9d308b6f`。

实际fence取得clear，epoch为`0415541996c04bdaad14aca0206a281a`，
observe ID为`c247bec6250f4d2d88e4ceba75e28f31`，native queue为空。
经精确私有console身份核验后正常发送一次Ctrl+C，宿主日志记录`Stopped server`。
发送返回只表示信号请求，不能直接表示进程已经退出：第一次过早调用seal、当时进程尚未退出，
被守卫拒绝；**该失败原件继续保留，不补填成功**。
等待launcher 154076与listener 24624实际退出、确认无SQLite sidecar后，第二次seal成功：
`ce579d4cc58358d6c9aa207ebc65b7454c7d81284e0743ee9dfe7dd4fededb72`。
seal绑定inventory `13c93f518e8f3e529205bb9c759fda9fa0b6b6614396cc9baa85af85c472d051`。

关键原件及SHA-256：

- 正常信号请求`actual/round1-old-normal-stop.log`：`dfd9b97945e8b756c82a2cfc05041a2a23f160802c4bc5cad7f8fc2206d6d8eb`。
- 第一次seal拒绝`actual/1792879845522053000-seal-profile.json`：`1a9c4e4c0a8c3dcfa29b2128b1bc5fa4e702d0fe8e38434e503cf326ce26ff71`。
- 第二次seal成功`actual/1792879863215234100-seal-profile.json`：`452b87d976a9d66c18fb339e4a8cc523f62c45d900a3c181d4142439c7eae274`。

此后按真实seal正式capture到`captured-round2`，从候选发行树执行preflight、migrate两次、
prepare-profiles两次均成功；预检blockers/safetyErrors为空。8个源文件前后不变，capture/backup/working
字节相同；两个round2 profile的非DB文件与源相同，`RETRY-OLD-77`及unknown原始夹具均保留。
数据库各只变换4个path/loader_path值，非路径metadata哈希相同。

round2离线交接时active仍为round1-old、sequence仍为1，没有激活或启动round2。
该次交接只完成旧版正常停机和正式capture，尚未运行新版switch及rollback；后续实际结果见下一节，不能据离线READY宣布M6通过。
`captured-round2/READY-OFFLINE.json` SHA-256为
`9f57fcbf9c5be96373a6ae7b2c5074b82b99c641bed5bf27b987e14447675499`；
`captured-round2/HANDOFF.json` SHA-256为
`e840f348911850895e7103d4ed987cd56f7cc363c566ac2e0b45804e37c185f1`。

## 77be887实际切换、回滚与资产列表阻断

后续已在sequence 2显式切换到round2-new并启动8245，实际重开旧编辑`RETRY-OLD-77`，
320×180上传图可读；在原unknown夹具上编辑`NEW-UI-77`并另存为`M6-new-ui-edit.json`，磁盘重开保留。
原`M6-synthetic.json`字节未变；新保存副本的`unknownWorkflow`、`extensions`及两个节点的
`futureNodeMetadata`均与原值相同。这只覆盖该合成夹具，不扩展为所有未知节点兼容通过。
比较记录`actual/new-ui-unknown-preservation.json`，SHA-256
`ba408ebfe536c8582e1f321dfb629cb4e526db98d1d8a40e0c54b77a9e10429e`。

旧3项收藏实际导入后已持久化，重复导入UI显示“处理3项，拒绝0项”；文本过滤能显示旧文本与新文本。
独立数据库采集确认assets=4、favorites=4、favorite_origins=3、asset_provenance=3，
jobs/attempts/events均0，导入来源身份未重复。但是混合媒体收藏列表GET实际HTTP 500，
宿主栈明确`KeyError: 'byte_size'`；**持久化成功不能代替列表功能通过**。
失败宿主stderr SHA-256为`64447ba7eb0a49b454b262e3f13a52064aeb062ef5b20ed70c100a80216ea0c9`，
对应`actual/1792880219661302900-round2-new.stderr.log`，初次失败截图/DOM原件均保留。
`3782d230b7022779a086c0d75f596ab75f33f83a`已提交查询字段与HTTP回归修复，但该77be887演练未安装此修复，
**仍待固定修复候选的真实UI复验，不把源码修复或自动测试回填为本轮通过**。

round2-new实际fence/observe、正常停止并确认进程退出和无sidecar后，取得新seal
`d498f09dd8c691e6396b9ae68c03cc7716aa10744d9edbdd0c2e61e2a223c6cb`。
`rollback-new-to-old`先保全实际新user/input/output，再发布sequence 3到round2-old；
重复调用返回完全相同的记录和sequence，没有重复切换。
新数据保全manifest的canonical SHA为
`ee4ea4c81f6db78ba7b58b2ae244aaf430904b30d1b49af7658e5df13e689976`。
独立逐文件核对10个文件：preservation/data、新profile、新seal及保全manifest中的路径/大小/字节SHA完全相同，
包含新studio.sqlite3与M6-new-ui-edit.json；原round1旧源和capture源仍完全不变。

回滚后8244实际启动round2-old，从磁盘重开`RETRY-OLD-77`和320×180图片；
再正常停止，确认两PID退出、无listener/SQLite sidecar，取得旧profile最终seal
`974fa57a020fbdf029da05b4148a44603c84dba66de3bb1842a85867d536c49e`，
raw inventory `004f42da1a89db4ef3d6b852e55ae2fefcc75ddfec615e7c544303be7743e946`与启动前相同。
合法新增的profile层runtime/seals证据不当作用户数据变动。
**本轮隔离的旧编辑→新编辑→保全→回滚→旧重开链条已实际跑完；资产列表缺陷仍阻断，未完成全产品或M6验收。**

本节证据均位于`.local/m6-e5-77be887-20261025/`：

- `actual/new-ui-disk-facts.json`：`c502b443dcc77b3799feb520286850500b83258425a3d9a1c75160417f80eb61`。
- `actual/rollback-preservation-independent-review.json`：`cd58cc9f3a820834cec7f26c5d0fe2245faec81cad9ac6e7c1bd972418367bee`。
- 最终旧seal调用`actual/1792880490519581200-seal-profile.json`：`a76314151ffdf82c78dbca717d3697ca8ef8ad9b3d7622935ec973a31cb54fa8`。

审查工具副作用单独留证：SQLite URI mode=ro/query_only读取已停机WAL数据库仍生成了空WAL和SHM。
主数据库字节未变；核对无绑定进程后，仅将这两个精确文件原样移入actual/read-only-inspection-sidecars独立目录，
未删除文件。随后新profile恢复10文件与seal完全相同；原因、完整path/stat/hash及移存前后事实保留在
`actual/new-ui-disk-sidecar-repair.json`，SHA-256
`2fbbecc110b44a087424df4a8f60c3b4e1e53cfe5f279dfe4af6d0d8ca192ef6`。
此后数据库审查只使用独立副本或内存快照，避免给被观察原件再建立SQLite连接。

## 3782d23固定候选的实际迁移链复验

本次独立试验根为`.local/m6-e5-3782d23-20261025/`，固定候选
`3782d230b7022779a086c0d75f596ab75f33f83a`，归档SHA-256
`d363bd5968c416ef673b00cca494c199694e0a4134e0d0afbc4ebb0ec6cc274c`。
前端仍为`891c76378b8d130639bf327c4bcff30dc277a4e7a671f1a4dbd990224217b2b2`。
旧包仍为指定Canvas/业务双基线，两个新安装和数据根独立；77试验和首次失败原件保留。

round1-old在8244真实从磁盘打开旧编辑及图像，本轮未编辑，正常Ctrl+C停止后取得seal
`721097fba688a8af97069cab6d9c03073d3bdc5c83ab6bab9c2d61530f61192f`。
旧8文件与prepared完全相同，因此复用已物化的round1-new；sequence2切换到新版8245。
新版真实导入3条旧收藏后，图像、视频、文本均在混合列表可见；重复导入未增加来源条数。
视频预览记录到readyState=4、320×180、3秒、error=null；此记录不等于全帧解码或生成质量验收。
三类素材通过UI复用到画布，另存`M6-new-reuse-378.json`并从磁盘重开，
资产ID、文件引用ID和内容SHA与原目录记录一致。另从原合成工作流编辑NEW-UI-378，
收藏、另存`M6-new-unknown-378.json`并重开后，混合收藏列表正常显示4项。

独立内存数据库核对为assets=4、favorites=4、favorite_origins=3、asset_provenance=6、
asset_references=2；jobs/job_attempts/job_events均为0。两份原工作流字节未变，
新编辑副本保留unknownWorkflow、extensions及两节点futureNodeMetadata；输入/输出3文件与capture相同。
所采新版stdout/stderr未记录HTTP 500、Error handling request、Traceback或KeyError，
结合实际混合列表和重开记录，闭合本次旧收藏列表`byte_size`缺项复验；日志无错误不扩大为所有接口通过。

新版fence/observe后正常停止，取得seal
`1f189cbb814209a2762a865e197d233d51ad797ce781ec4ff9edd273c8ee397b`，
raw inventory为`d2b7c3e849a5d7059b577305e8df49ac6d0ef38f7728caa1d1a5aeaa4a3e6302`。
`rollback-new-to-old`使用目标旧seal，先保全新版user/input/output，再发布sequence3。
重复调用的JSON记录、operation及sequence完全相同；原始stdout排版不同，不声称响应字符串逐字节一致。
保全manifest的canonical SHA为`abb7c59608b008c62cc72bdaa23c797fd0dce518898ec2574701cb88094ad7eb`，
manifest文件字节SHA为`259decc579e5d02a8e21ffde31ed7aff8a5f8c4ff7b204a0bcb1b54c8833c304`。
独立核对保全data、新profile、新seal和manifest的11文件路径、大小与SHA完全一致。

回滚后8244实际从磁盘重开RETRY-OLD-77及320×180图像；再次正常停止，
退出记录确认182504/56556两PID不存在、无listener/SQLite sidecar，最终旧seal为
`182a233fa9dd7d184e720230a24cc650729b33ba07d2431e2793ebb6ecf9d803`。
其raw inventory `39973c75a88495c34e32541fc897a5d25ff05f683ab0862511759e0b9825cc1c`
与首次seal及prepared完全相同；独立复核旧8文件、capture源8文件与原77试验旧profile均未变。
两份原工作流SHA分别为：M6-synthetic.json的
`bf10cf4b6d5fd7751ffc4f2f1ba557ce17be2759feb074a5f9870d7c9d308b6f`，
M6-old-ui-edit.json的`65f87ef783570b9bee487e2ccfe6a76c5055f1d47567ab0db6a69999ceae1f24`。

本次独立采集只普通读取字节，数据库解析在私有内存连接中完成；原DB连接、源写入、新增sidecar均0，
前后全文件哈希一致。首条采集断言曾误要求两次CLI stdout字符串完全相同，
`actual/rollback-review-first-diagnostic.json`保留失败诊断；实际解析后的JSON记录完全相同，未修改产品。
UI与退出证据由根代理实际采集，独立审查负责磁盘/数据库副本/保全比对，范围分别记录。

- `actual/new-ui-independent-review.json`，SHA-256 `1dd4071a0c69bfb1547e7ddcd054103953b7dd32b75158888b3d9a9f8d9a2e71`。
- `actual/rollback-independent-review.json`，SHA-256 `9f818ac3af398244089dfc1b1dda83cdf347ea5904e0ff1595f6d94fd8d78347`。
- `actual/new-reuse-reopened-dom.json`，SHA-256 `8f99a3fc653c5b3dd2c8dfdf8688b63b19ca6032aa7185a1f714fa0893fd3338`。

**此结果仅支持本次合成数据的M6迁移链子项，不代表所有TC、M6阶段或完整产品验收通过。**
正式前端891c76的五段缩放p95仍为40.1/40.0/40.1/40.1/40.1ms，仍FAIL20；
本轮真实GPU/模型推理为0，生成质量、完整性能门禁和发布未完成。

## Header变量隔离候选的正式失败与回退

候选`8f65023b46db46d53bf3e54d129495ef603ae9fd`，前端指纹
`9817235d336fe5f0e08b1ba28d6d396f36bae562b5f8bec4c003f5a6422958fc`，
在固定S无视频夹具、1920×1080、DPR约1、10秒预热和五段各30秒下正式采样。
独立从全部活动帧重新计算，五段p50均13.4ms，p95均40.0ms；
各段最大值80.0/106.7/80.0/80.1/93.3ms。五段完整、原始时间线连续、无隐藏页面、无observer错误。
选择的夹具SHA与`FX-PERF-S-no-video.json`一致；真实加载由操作记录声明，文件复核未读取宿主图。
操作记录为固定导航中心的真实指针放大/缩小；采样前记录无诊断样式覆盖。

**仍为FAIL：五段全部超过20ms预算。** 相比891构建40.1/40.0/40.1/40.1/40.1ms，
约0.1ms差值不足以证明实质收益；不筛选最好运行、不改预算或删除失败段。
候选已由`c758fd6f4482bed8478828276e032934600635b1`回退。
本次只记录缩放性能，**未完成标题UI验收**，不能据此声称标题交互或完整阶段通过。

原件位于`.local/performance-actual/new-S-no-video-zoom-981723-{raw,summary,operator,before}.json`：

- raw SHA-256：`ecea565cdd66186bd9de242f78d048f72693b3ade6830aa41ec2ca6322fb3e9c`。
- summary SHA-256：`cad419aeddbc696d77f0aa08485d8925f874cb859b0f6abbcc31a469bbdea4f4`。
- 独立核对`.local/validation/header-981723-independent-review.json`，SHA-256：
  `9a51eb78bf274e5aed6df3b3ea05634db7b1dc7f471dddbac36bbe1d7f5260b1`。

响应式证据另有后续实际平移：680×720下，150%的B页脚按钮和100%的A页脚按钮可移入画布并可见。
只闭合这两个样例先前“尚未证明平移可达”的缺项；不推广到所有控件或视口，
不从此推断此前截图位置、焦点或CSS候选的成因。
平移原件`.local/validation/body-zoom-891-actual/pan-680-actual.json`，SHA-256
`6e3a528c1a8b36c41b499217c7037d4bdfd52de6382444cd9309715b9635ff0b`；
独立`.local/validation/body-zoom-891-responsive-pan-followup.json`，SHA-256
`ba537e1cab4796ab69efab5fe7afa2a335ff847c44931b53d4526eb74acbfedf`。

## M场景保存/加载五轮与行高候选比较

此前M初查之后，891基线与初始行高批量读取候选各完成五轮原生保存、重开观察。
固定工作流为300节点/400连线、两张各500行×10列的表格，无视频；
`Studio-PERF-M-two-table-891.json`为2400456字节，当前只读复核SHA-256仍为
`72c75a4f2c2c3818590632b8c8e8cc25f2ddd159ccd49520ee6a53db366ea1bc`。
这确认当前文件与先前固定原件一致，不补称每轮加载时均单独采集了文件哈希。
基线前端为`891c76378b8d130639bf327c4bcff30dc277a4e7a671f1a4dbd990224217b2b2`，
候选`e91ef9138bdc987b9d3ec0e550b6e2bac89976b8`的前端为
`2e7b7d57da4ffd1b6075174daf3d2baf70fcfaf274f954433845b33ca7c5a97c`；
两组使用同一测试observer包`3080434958c50d4735cda2c0eed486ca04813ae42e3ede51bd9150d7e074392b`。

每轮各有1次save、1次精确路径关联的HTTP 200存储确认、1次load，以及9次独立serialize，
共每组60条调用，全部成功完成，停止后observer hooks均为0。每项save/storage/load每轮仅N=1，
下表是五轮全部样本的描述统计，不据此建立稳定p95或性能通过结论。单位均为ms。

| 边界/版本 | 第1～5轮 | 中位数 | 均值 | 最大值 |
| --- | --- | ---: | ---: | ---: |
| save / 891 | 924.2 / 1476.5 / 1700.6 / 1063.0 / 1229.7 | 1229.7 | 1278.80 | 1700.6 |
| save / 2e7 | 1544.0 / 1372.9 / 1751.7 / 1394.2 / 1370.9 | 1394.2 | 1486.74 | 1751.7 |
| storage / 891 | 98.7 / 214.2 / 116.7 / 100.2 / 182.4 | 116.7 | 142.44 | 214.2 |
| storage / 2e7 | 110.7 / 172.4 / 141.6 / 87.3 / 121.5 | 121.5 | 126.70 | 172.4 |
| load / 891 | 5500.1 / 5533.6 / 5083.0 / 5548.9 / 5600.5 | 5533.6 | 5453.22 | 5600.5 |
| load / 2e7 | 5739.0 / 5915.8 / 5927.1 / 5846.0 / 6126.8 | 5915.8 | 5910.94 | 6126.8 |

save是`saveWorkflow` Promise结束，storage是其HTTP响应，两者不可相加。
load仅为`loadGraphData` Promise结束，不含其调用前的文件选择/解析，也不证明后续布局、焦点或输入已就绪。
两组各45次serialize的中位数为11.7/12.4ms、均值15.39/36.31ms、最大值40.5/385.9ms；
候选保留272.4/365.9/385.9ms三次长调用。所有serialize的saveCorrelation均为null，
不能将其全部归入保存成本或当作额外保存样本，也不能据此归因GC或具体代码。

候选load中位数比基线高6.91%，均值高8.39%，**没有展示加载收益**。
但操作记录明确：两组之间新增空闲CPU宿主8246用于资产夹具，导入/采集在候选正式运行前结束，
候选期间未使用其浏览器；其他固定端口保留，操作视口仍为1920×1080。
这项环境变化未被CPU测量排除，不能将差异归因为候选造成的性能回退。
多数逐轮DOM未独立记录viewport/DPR/visibility，亦不补称环境完全相同。
候选已由`b83a9da584064fbe4e61ce6660301ee00fc59f10`回退，两组全部样本保留。

十份DOM均记录300 cards、1000 rows及两条预期首格文字保留；仅基线第1轮同时记录行ID，
其余九份不能独立证明同一行身份。十轮的load.editableCompleteMs、report.unmeasured.reopenToEditableMs与
DOM.strictEditableMs全部为null，**PERF-03仍未通过，不能将约5～6秒load称为重开可编辑时间**。
基线/候选observer会话分别为66.4～123.8秒/53.4～73.7秒，save结束至load开始间隔为
7.3～17.3秒/6.6～22.3秒；这些包括操作者与工具等待，不是产品加载时延。
基线DOM保留7条AX/CDP等工具失败记录，候选DOM没有toolFailures字段不等于证明无工具错误。
原始记录未提供performance.timeOrigin，无法把工具wall-clock期限精确换算为页面加载或可编辑延迟。

本地完整原始记录与独立分析（后者含十份DOM、两张完成截图和所有输入文件哈希）：

- `.local/performance-actual/M-baseline-891-five-rounds-raw.json`，SHA-256
  `ff3499502c741fb930130b171508c074e5075c632edbd7ce435ab26343d53fbe`。
- `.local/performance-actual/M-candidate-2e7-five-rounds-raw.json`，SHA-256
  `580420f394cf567731ea2854a18743f1721aacef2c8195230c0d4a0d7491d0e4`。
- `.local/validation/M-891-2e7-five-rounds-independent-comparison.json`，SHA-256
  `4f58c0289f3ae5bd55d6df3637d0fa519f130427658bb62ab8818be2d92fec6f`。

## 2000条文本收藏的五轮搜索与分页补测

独立CPU隔离宿主8246按预先声明的固定查询顺序完成五轮：
`合成收藏 0001`、`分组 3`、`黄色圆柱`、`1999`、`不存在的合成词`、清空。
预期总数依次为1/200/2000/1/0/2000，分页大小48。
首次探针保留在累计报告`reports[0]`且预先排除；正式轮次为`reports[1..5]`。
每轮29条可信输入记录，共145条（140条逐字符输入及5条清空）；
30次预定最终查询全部完成，115条中间输入均以superseded保留。
另有115条迟到rejected记录，逐一对应被替代输入；原始记录没有拒绝原因，不能全部称为AbortError。
最终查询无缺失、超时、unbound请求或stale完成，不将中间输入当作零延迟样本。

下表每轮N=6，全部最终查询纳入统计，单位ms。
R7为线性插值；nearest-rank在N=6时等于最大值，两种口径均明确保留。

| 正式轮次 | p50 | p95（R7） | p95（nearest-rank）/最大值 | 会话秒数 |
| --- | ---: | ---: | ---: | ---: |
| 1 | 38.60 | 50.450 | 52.90 | 54.56 |
| 2 | 32.60 | 40.950 | 42.80 | 37.75 |
| 3 | 33.60 | 38.725 | 39.40 | 33.30 |
| 4 | 36.90 | 39.925 | 40.30 | 41.25 |
| 5 | 34.75 | 46.975 | 49.10 | 39.79 |

五轮会话均超过30秒，但部分首输入至末次完成跨度不足30秒，会话包含等待。
10秒预热属于操作者协议，未单独埋点；同页时钟中首次探针最后完成至正式首轮开始相隔78.833秒，
这只能证明间隔，不能补称已独立测得预热活动。每轮记录1920×1080、DPR `1.0000000298023224`，
比较1时采用`1e-6`浮点容差，保留原读数。

独立分析从固定夹具内容计算资产身份，并依已采集oracle逐项核对响应和DOM的ID、顺序、总数、分页。
30次最终结果均匹配，显示文字/新结果子树校验标记均为true；原始报告并未另存完整DOM文字快照。
多结果页面渲染48项、视口可见11项，不称48项同时可见。
分页额外会话`reports[6]`单列：下一页offset48为31.7ms，顺序1952～1905；
上一页offset0为33.1ms，顺序2000～1953；均48项且与oracle一致，无缺失或超时。
这两次按钮观察未混入正式五轮，也不算第六轮。

操作辅助闭包在第三轮下载后仍使用第二轮目标名，独占写入拒绝覆盖；第三轮下载随后另存。
保留该事件及原operator元数据，轮号/空ops不能替代原始报告顺序和时间。
第1～4轮累计原件均为最终报告的精确JSON前缀；分页报告也保全此前六个会话。

运行前端为`2e7b7d57da4ffd1b6075174daf3d2baf70fcfaf274f954433845b33ca7c5a97c`。
宿主仍含后来回退的表格行高候选；本次只记录资产搜索。
已安装资产库面板、样式、服务桥、资产API及仓储五文件与回退后当前源码逐字节相同。
安装快照SHA-256为`5d02a53c921ec3821addb3d198d3527d389f09bc8fe840097cc8df14b1434fb1`，
测试包为`3080434958c50d4735cda2c0eed486ca04813ae42e3ede51bd9150d7e074392b`，
观察器为`b97280cd54ba3659c306248824f7276ebea98ff2a9fcfcf185a27d4a0578539d`。
报告中的buildIdentity仍是operator-supplied；磁盘安装哈希不冒充浏览器运行模块哈希。

这些实测最终查询均低于200ms，但只有文本收藏，不能覆盖混合媒体的解码限制。
完成边界是正确结果后的两次可见rAF机会，包含观察器开销，并非物理呈现证明。
**仅支持固定文本搜索数值子项；不判完整PERF-08、TC-CAN-041或阶段通过。**

保留的本地证据及SHA-256：

- 预声明计划`asset-search-ui-five-round-plan.json`：`5ca83879ac190291e2a133fe34c34be3a42a0f8db3d7ec7fd391dd9393ee8903`。
- 固定文本夹具：`5854d91c89f51b78fb23704b349f611516b8f9584b0365e8b20e5209fae611bc`；
  完整排序oracle：`75730f17385969339b29a273a77a384102c0e5d17cec681ca804ff385bee116e`。
- `.local/performance-actual/asset-2000-five-rounds-cumulative-raw.json`：
  `8402f1ace6b22a419b91c30c7ac434a47f47e503cd830582a1155b4c360d2163`。
- `.local/validation/asset-2000-five-rounds-independent-analysis.json`：
  `00dc733eebb81104f1f823935c490835ea1d1e015aceb6b4fc33ab14c7226560`。
- 分页补测`asset-2000-pagination-supplement-cumulative-raw.json`：
  `612448e410f65bc4f7372bd884aae7efc65a1654f33223c5cb58c0c41b5e0a88`。
- 操作事件`asset-2000-operator-closure-incident.json`：
  `887f62473130c28818a5749c47ecce064f64b7963fda8b790eb4c2f4f84d2b9d`。


## M场景1c166任务投影快路径的五轮观察

前端`1c1660936e05f9ed5d998ade82a08f65f7c5496957cf629c8e08c2485410fa62`
在隔离宿主8237完成预登记的五轮原生保存/重开；候选`9149225`跳过无生成列表格的完整任务投影。
工作流仍为同一300节点/400连线、两张500×10表格的无视频原件，复核SHA-256仍为`72c75a4f2c2c3818590632b8c8e8cc25f2ddd159ccd49520ee6a53db366ea1bc`。
测试包仍为`3080434958c50d4735cda2c0eed486ca04813ae42e3ede51bd9150d7e074392b`；
磁盘安装快照`b24358d1e89bf5dbc30a0f0680b8ea4160991993a935fb9a32dce66c09452a98`已另行核对，
它不替代浏览器每个运行模块的身份验证。

每轮1次save、1次精确关联的HTTP 200存储确认、1次load及9次serialize，共60条调用均完成，
停止后hooks均为0。第1～4轮累计原件逐项等于最终报告前缀，没有替换轮次。
每个save/storage/load边界每轮仅N=1，以下五样本描述统计不构成稳定尾延迟判定，单位ms。

| 边界 | 第1～5轮 | 中位数 | 均值 | 最大值 |
| --- | --- | ---: | ---: | ---: |
| save | 1524.8 / 987.6 / 1124.6 / 1310.2 / 1457.3 | 1310.2 | 1280.90 | 1524.8 |
| storage | 133.1 / 112.5 / 80.7 / 142.6 / 317.7 | 133.1 | 157.32 | 317.7 |
| load | 5438.6 / 5705.6 / 5094.3 / 5654.5 / 5746.8 | 5654.5 | 5527.96 | 5746.8 |

45次独立serialize中位数11.4ms、均值13.17ms、最大值29.8ms，saveCorrelation仍全部为null。
save与storage嵌套，不相加；load只到`loadGraphData` Promise结束，不包括文件选择/预解析或可编辑就绪。
相比历史891，load中位数高2.18%、均值高1.37%，没有展示整体加载收益；
此总时长也不能单独否定局部任务投影快路径。891之后新增空闲CPU宿主8246，背景负载差异未排除，
不能作因果回退判断；已回退的2e7行高候选只作历史参考。

五轮DOM均为300 cards、1000 rows，两个节点ID及预期首格文字保持；实际viewport均1920×1080，
DPR均为`1.0000000298023224`（与1比较容差`1e-6`），页面visible。
五份DOM都未记录recordId/fieldId，不能独立证明稳定行/列身份。全部严格可编辑指标仍为null，**PERF-03未通过**。
会话为67.8～76.5秒；save结束至load开始为7.6～12.0秒，包含操作等待。
10秒预热为操作者协议，未独立埋点；设置及前两轮的FrameTree/CDP超时保留，不能直接计为产品加载时延。
原始报告未提供performance.timeOrigin，不能将操作wall-clock补算成严格可编辑时间。

本地证据及SHA-256：

- 预登记`M-1c166-five-round-plan.json`：`2d07d9f1a497f16e627bbdf2ecb1e84bc155a2425575f362d91ba0d277fa56af`。
- 原始`M-candidate-1c166-five-rounds-raw.json`：`b9471efabd1769117cc5c48100675bb2ddc1f3b45d8bb2596ae006cb8221e4be`。
- 分析`M-1c166-five-rounds-independent-analysis.json`：`4274b464a30c19139330e9e4ce9e22eba46274312a4a363a4af5585d511a9277`。
- 独立复核`M-1c166-five-rounds-review.json`：`4ca5c997c0d5686c73bbae8646c4bff60946f3b3f8ed9dca875d30cca2ad8c1b`，含四个累计前缀和五份DOM哈希。


## M场景50次普通输入的语义观察

同一1c166前端在50%画布、1920×1080下，使用原始无视频M夹具
`79ecd59cf5bbd3022abda73c2368e3e45e3b9fed824494f813cd6109e381cc79`，完成预登记五轮各10次ASCII输入。
A/B分别绑定节点1/2、记录`M-table-00-row-0001`/`M-table-01-row-0001`及`field-00`；
全部50次目标、字符和顺序匹配。预备探针`p`的editing为317.9ms，按预声明单列排除；
正式样本ID为2～51，未把探针ID1或重试混入。

主指标为普通`insertText`事件的`event.timeStamp`至同一编辑目标精确文本经两次可见rAF校验后的机会，
50次均使用事件时钟，没有handler fallback或IME。所有editing检查在实际blur之前完成。
这是paint opportunity，包含观察器开销，不是物理像素呈现时间；进入编辑器动作不在此计时边界内。
操作日志的startedAt/typedAt是控制调用时刻，不能替代input事件时刻。

| 轮次 | editing p50 / ms | editing p95（nearest-rank）/最大值 / ms | 会话秒数 |
| --- | ---: | ---: | ---: |
| 1 | 359.45 | 512.6 | 93.52 |
| 2 | 374.00 | 582.7 | 55.34 |
| 3 | 257.75 | 381.5 | 60.76 |
| 4 | 269.40 | 391.4 | 61.35 |
| 5 | 339.05 | 409.5 | 65.05 |

每轮整体N=10、每个实例N=5，nearest-rank p95在两种样本量下均等于最大值，属于小样本描述统计。
但**50次editing全部超过100ms**（最小250.4、最大582.7ms），本次普通文本输入子项失败。
所有注册动作均完成，无缺失、超时、superseded或失效目标的正式完成；
另有116条outside-supported-identity拒绝计数原样保留，缺逐事件关联，不能全部解释为无害blur。
第一轮发送字符前的编辑态检查错误；实际属性确认已进入编辑且尚无input，修正检查后继续，未重跑输入。

display-exit从实际blur计至显示态两帧机会，独立50次中位601.15ms、最大702.3ms。
输入至blur的停留为621.0～1672.7ms；display.inputToPaintOpportunityMs包含这段停留，未混入editing指标。
轮次长度使用stoppedAt-startedAt，五轮均超过30秒；预热仍为操作者协议。
各轮结束的稳定node/record/field及最后文本吻合，最终另存文件含300节点/400连线、两张各500行表格，
实际保存重开后同两目标仍为`O`/`y`。此内容保全结果不消除输入延迟失败。

本轮没有视频、M拖动/缩放或实际IME覆盖，**不判完整PERF-02通过**；
没有匹配的891语义输入对照，也不据此判断快路径收益或具体耗时原因。
另一次LoAF诊断在进入编辑器时遇控制期限，实际发送0个计划字符，原始记录已保留；
它是观察器开启时的空闲/控制诊断，不能作为这50次输入的归因。

本地formal分析`M-table-semantic-1c166-formal-analysis.json`的SHA-256为
`ddfc97b2e50893afbd663b72e1f79e458492aba49068547f28a6297384e9936a`；
独立复核`M-table-semantic-1c166-formal-independent-review.json`为
`a863829c6b81bf6dd44c6785eee99489c23d1451b88619a227ef5cd46790e5a2`，包含五份raw/context哈希和全部样本复算。
最终保存原件SHA-256为`c2c6d69d526661223af8b4ced0bc984658bf3d17ead113c7be4a08b693fc247c`，
重开DOM原件`M-table-semantic-1c166-reloaded-final.json`为`d1785826a506dd1da2815f395c325e8a2cb91c7e370c7d80e70bb1a5c5287394`。
