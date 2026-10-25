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

## a956与d599同夹具普通输入正式失败

后续两个固定候选继续使用原始M无视频夹具`79ecd59cf5bbd3022abda73c2368e3e45e3b9fed824494f813cd6109e381cc79`，
即300节点、400连线、两张500×10表格；目标仍为节点1/2的`M-table-00-row-0001`/`M-table-01-row-0001`、`field-00`。
实际视口1920×1080、画布50%、DPR约1；主指标仍为普通input的event.timeStamp至精确编辑态两帧机会，
不是控制调用耗时或物理呈现时间。两次各五轮、每轮N=10，nearest-rank p95等于该轮最大值。

| 固定候选 | 第1～5轮editing p95 / ms | 超过100ms | display完成 | 结果 |
| --- | --- | ---: | ---: | --- |
| `e35592c` / `a9561917…` | 274.0 / 233.1 / 248.1 / 235.6 / 240.1 | 50/50 | 44/50 | failed |
| `67e692b` / `d5990507…` | 316.6 / 214.6 / 207.0 / 210.8 / 202.5 | 50/50 | 50/50 | failed |

a956保留六次display超时（第一轮样本1、2、6、8、10；第二轮样本11），没有用0或后续成功样本替换。
前11次动作的分离控制调用曾超过观察器5秒display窗口，之后改为同次调用内输入、读取、600ms停留和Tab；
该节奏变化及首次分析exit 2均保留，不能把六次超时单独归因为产品显示缺陷。后三轮完整，但整组仍不完整。

d599从首键起使用同次调用内600ms停留，五轮会话分别约36.46/31.04/31.02/31.04/31.02秒。
50次输入身份、顺序、值及editing/display均完整，无正式完成缺失或超时；115条outside-supported-identity拒绝计数保留，
没有逐事件来源，不能改称115次无害blur或迟到任务。600ms停留与display-exit分开，未计入editing指标。
首次设置、文件选择和重开控制错误仍保留，不折算成产品加载耗时。分析exit 0只说明本次数据协议完整，
**50次editing仍全部超出100ms，不能判PERF-02通过**。

两组末值`O`/`y`均经实际另存和重开保留。a956保存文件SHA-256为
`c2c6d69d526661223af8b4ced0bc984658bf3d17ead113c7be4a08b693fc247c`；d599为
`bbd50009c1a59da37ab60ad374edad419255c795b802ada282d1d421b6e4b186`，二者仅优化文档documentId不同，
节点、连线和表格内容相同。与原始夹具相比10000个表格值中9998个不变，仅两目标变为`O`/`y`；
原始夹具保留，未以保存副本冒充原始输入。该数据保全核对不替代任意旧Slot迁移验收。

两个正式失败都绑定`TC-SYS-024 / F-SYS-012 / AC-SYS-012-001 / UC-SYS-010 / EV-PERF`：
AS-SYS-024-001为failed，视频分支AS-SYS-024-002为not-executed；不覆盖此前1c166失败。
尚无M拖动/缩放、可见视频、IME或完整视口矩阵的本轮证明。背景进程身份与首尾队列快照已保留，
但没有连续CPU/GC/网络/推理审计；相关telemetry保持null，不从CPU/offline启动标记推导0。
不同时间段、控制节奏和背景条件不足以将数值变化归因于某项修复，也没有达标的性能复测。

正式记录及SHA-256：

- `.local/evidence/TC-SYS-024-M-table-a956-20261025-ascii-5x10-first.json`：
  `eeb71c6480abfe71d8c74dad8bfba6234f49c2aea2eb400f621d7cf3c896ba1e`，37份附件哈希已逐项复核。
- `.local/evidence/TC-SYS-024-M-table-d599-20261025-ascii-5x10-first.json`：
  `b5be9c1a8c50b6ee4ce0caa71a357f32e1fd51c13ef81b6668d68da24f4ec642`，43份附件哈希已逐项复核。
- d599独立复核`.local/validation/M-table-semantic-d599-independent-review.json`：
  `5da8e86d11678c13046606a4ee77932f1828df9ad83fc23651966708d98721c2`。

## 两表两LLM交互范围与撤销显示缺陷

独立的小夹具含无生成列Table A、真实生成列但不提交的Table B，以及各自连接的两个LLM节点。
d599在1920×1080、50%画布完成四节点各Mute→Active→Bypass→Active共16个模式状态，
保存数据的mode与被操作节点一致、其他节点保持Active，最后全为Active。
Table output0→LLM input3的两条STRING连线分别断开/重连，再经Graph/Canvas往返保留对应输入和要求。
A断线后的旧文本曾延迟消失，稳定读取已为空；保留该时序记录，不将其描述为永久失效。
另已执行B生成列删除→撤销→重做→恢复和A第三行内容撤销/重做，另一实例未串改。

两个LLM各追加要求文字、停留1100ms后caret仍为[6,6]；随后原生撤销使两份保存instruction回到旧值，
但可见文本框仍有`D599-LLM-A/B`后缀，构成真实UI同步失败，不能说原生历史没有撤销。
修复现已让render读取最新已保存instruction，仅值不同时写DOM；23项定向回归通过且独立代码审查无阻断。
首轮三条新回归失败日志保留；当时实际复验仍待进行，后续f6实测范围见下文。
本小夹具未提交生成，也未完成三视口×50/100/150%矩阵、IME或整个前端验收。

本地交互证据位于`.local/performance-actual/prompt-llm-d599-ui/`：

- `05-modes.json`：`897b816f3f4e054c98d62c31105d493897fcfbb99b348f317d8a8418b81df8f5`。
- `04-connections-roundtrip.json`：`048cdbf9c59e0e75f95250461ad8ab6be5f0f6069e76d2dc83151a823d9699a0`。
- `06-llm-edit-focus.json`：`e3fdb846756b1a9cd0f1655d92c73a094547ff8fc5bcea0402b68ce3e5d4c021`。
- `06-after-undo-save.json`：`f56ca55eba2ebd3a7c757dd0d70855cc7df4077c0b8b2b278da1fe57221e6867`；
  与撤销前原值文件`05-modes-restored-save.json`字节完全相同，和最后DOM形成数据/显示不一致证据。

## d599四键持久化方法分段诊断

另在8226的d599候选、原始M夹具上采集A:P、B:z、A:O、B:y四键，两目标各两次，
实际1920×1080/50%画布；其他观察器关闭。方法wrapper仅在目标input事件同步派发期间记录，
四次均精确恢复八个方法描述符、无冲突或截断。前后约2秒无输入窗口没有包装方法，不能当空后台性能基线。

DocumentController.edit的同步含子调用时长为88.1/86.2/89.7/88.0ms；
其中OptimizationRevisions.observe为23.2/21.4/24.0/21.6ms，每次另观察到三次rootGraph.serialize，
同标签区间合计27.3/27.1/28.9/27.8ms。serialize中两次嵌在history内，所有这些边界又包含在edit内，
**跨标签不可相加，也不是CPU、自身耗时、完整input回调或输入至显示完成时间**。
两个table_data widget边界可安装但零span，只能写未观察到，不能断言没有执行。
原型方法receiver只与本次输入派发关联，不捏造其具体A/B归属。

这四键只用于缩小后续审查范围，不混入正式五轮、不生成正式百分位、不判100ms预算达标；
也不能据此把某次JSON拷贝、序列化或扫描确认为全部瓶颈。缓存模块字节未独立证明等限制继续保留。
原始`.local/performance-actual/M-input-stages-d599-first-raw.json` SHA-256为
`4bee84c1358a2ef850ca4c2833c1bcca45d6ce4bc6a83dd3b2b2cc7fcdafad15`；
独立分析`.local/validation/M-input-stages-d599-first-analysis.json`为
`1bac6ca274a701eb899e3f37e6c574233795f391d41c53f26d9a0e8fe1c6c926`。
以上失败和诊断不改变M6未达、完整性能未通过、44次真实本地推理未启动及不发布的状态。

## f6的LLM指令显示修复实际复验

固定`3f8437b1889baa2279876c03e14ddef16384ab7b`、前端
`f6e57c9bd4122d9f15d1188e725c348bc590721a1a5e76577cad5d72d19296bd`，
继续同一两Table、两LLM小夹具，在真实1920×1080、Canvas50%执行；不提交生成。
两LLM真实追加独立后缀，停留1111/1126ms后仍获焦且caret为[6,6]，另一实例未串改。
原生历史以可见render检查点逐步执行undo-B、undo-A、redo-A、redo-B，
每步即时及稳定DOM的两份instruction均符合目标历史状态，修复了d599中“数据撤销而显示未同步”的已知样例。
这不是周期延迟预算测量，也不声称即时快照代表零延迟。

分别删除LLM B、Table B时，仅目标节点及相连边从原生保存中消失；撤销后两份文件均与
`08-before-lifecycle-saved.json`的18781字节完全相同，四节点及两条Table output0→LLM input3连线恢复。
Table B删除时宿主曾重算存活LLM B的order，已单独记录，不混同原生slot索引改变。
随后在Table A与LLM B嵌套编辑控件内Ctrl+S，新增文本保留到磁盘；原生文件重开、整页重载后DOM与保存一致。
`12-nested-LLM-save.json`、`14-final-saved.json`和`15-post-reload-saved.json`逐字节相同，
均为18817字节、SHA-256 `2eabe9d89664f154a37730dd12f201b97397fce9a72cda89a110df5080043144`。

首次模式按钮Ctrl+Z没有改变保存数据，快速连续历史读取曾观察到中间状态；后续有独立render检查点的成功
不覆盖这些原件。Save As快捷键/菜单定位、原生Open控件失败也保留，未把未确认操作记作成功。
整页重载及其后DOM仍带dirty-star，而再次保存字节不变；此观察只支持该次未发现序列化内容变化，
不能推断所有dirty状态或快捷键行为都正确。f6记录仍限一个视口/倍率，不替代完整焦点/溢出、IME或模式矩阵。

本地原件在`.local/performance-actual/prompt-llm-f6e57-ui/`，关键SHA-256：

- `01-instruction-focus.json`：`5904fa31c96884d955c474b77735bff72a6cfedcb24791f86227d0041b023562`。
- `06-history-with-render-checkpoint.json`：`69c6722bd688cc561bd84315d62a5faae372312ea54b88177d50c76dc1f71d1a`。
- `08-before-lifecycle-saved.json`及两份删除后恢复文件：`859f611c261e2276addb83d498af993263419bb61d57de8c9d194ce76df22b82`。
- `13-reopened.json`：`8ff5ef50d9dbe96d2df824167e42a9f280052d42e732213df4626de5879abd57`。
- `14-reloaded.json`：`c5d50e380320d71f455879a5f42f12211375be45c946279119b5e0fcd64d778b`。
- 本轮独立文件/DOM复核`f6-cfc8-public-progress-review.json`：`82ef67de51df93046bde40753fed91cf9a05cc802c6d1886558c7137c47d0c98`。

## cfc8正式五轮输入失败与缺测保留

固定提交`d5dbe17be7181b7f8f13206a86c823ad82fc6492`，前端
`cfc8aaeb5a2c28d4ca9f25f710b196722a42183dcf5df02909ea558b5b32c0be`包含LLM显示修复、
普通字符串快照冗余拷贝消除与Canvas同值DOM写入guard。使用同一原始M无视频夹具79ecd，
同A/B稳定目标、1920×1080/DPR约1/Canvas50%，预登记五轮各10键，未重载或替换正式样本。
计划SHA-256为`4352e4bc4af019c03906e9de7b0171af43a63417c59254b23693e649d55bfc52`，冻结先于首轮Start。

| 轮次 | editing已测/计划 | 已测editing p95 / ms | display完成 | 会话秒数 | 状态 |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 10/10 | 284.2 | 10/10 | 46.492 | 超过100ms |
| 2 | 10/10 | 306.8 | 10/10 | 31.429 | 超过100ms；另留599ms操作偏差 |
| 3 | 10/10 | 271.6 | 10/10 | 31.340 | 超过100ms |
| 4 | 10/10 | 278.4 | 10/10 | 31.165 | 超过100ms |
| 5 | 5/10 | 1012.7（仅N=5描述值） | 10/10 | 30.648 | 缺5个editing观测，不能替代N=10 |

全部45个可测editing值均超过100ms。第五轮ID45/46/47/48/50为
`not-observed-before-display`，没有editing第二帧时间，不填0、不插值、不用display值代替；
ID49的1012.7ms保留，不剔作异常。全部50动作的目标/值/顺序和display完成相符，
但**动作完成不等于editing测量完整**。冻结分析器首次退出码2，`fiveRoundsComplete=false`，
`PERF02Passed=false`；前四轮完整但超预算，整组仍失败。

原始预热记录10005ms；操作者从首键起安排同次控制调用内600ms停留再Tab。
第二轮第10动作B=`j`的Date.now停留差为599ms，保留为操作协议偏差，不能据timer意图改成600或事后加容差。
其余停留记录保留，未混入editing主指标。每轮23条、共115条outside-supported-identity拒绝未给逐事件归因；
无IME组合事件，不能把它们全部归作无害blur。观察器检查开销最大约0.8ms，未从结果扣除。

后台比d599多了独立CPU宿主8247，测试包由17文件308变为19文件0f589，新增两个未启动的方法诊断模块。
这些环境差异明确保留。六个已归属宿主的前后PID/birth、命令和listener匹配，首尾队列快照为空；
八个服务文件前后与安装字节相同，冻结时511产品文件对固定Git、19夹具文件核验一致。
端点证据不能证明持续CPU/GC/网络负载等价；浏览器缓存模块字节也未独立证明，不作候选因果收益或回退结论。

实际保存重开保留300节点/400连线与O/y，9998个未编辑表格值保持。保存文件
`83759b4c61a24d15dfea693296fa52740851b932b5005657f1e991dde8d2c7a3`
与d599保存文件仅优化文档documentId不同；原始夹具及所有历史失败不变。
最终重开两次控制读取错误后，一次已打开文件的有限读取确认内容；没有补做Open或正式输入，
不由工具超时推算产品加载耗时。

本轮绑定`TC-SYS-024 / F-SYS-012 / AC-SYS-012-001 / UC-SYS-010 / EV-PERF`，
AS-SYS-024-001为failed，AS-SYS-024-002可见视频分支为not-executed。
经独立窄审后，主代理已正式追加不可覆写记录；55份附件保全、格式与哈希校验通过。network/inference仍为null，
M拖动/缩放、视频、IME及其他未测分支不被该失败运行覆盖。

- 首次分析`cfc8-table-semantic-preparation/candidate-analysis-first.json`：
  `7630de87442ded97e4572c4be5cf5b0549e24a9fa1ec0cc931f4d109d55bda42`。
- 首次退出记录`analysis-first-execution.json`：`5f25957256f157e03a915e1c38f89014f5cac519a4b26b10278d3a19ffce6a21`。
- 独立原始数据复核`M-table-semantic-cfc8-independent-review.json`：
  `ec8f81476544745591240f5b6df901a88a9d07dcc3ec5a83c9500002f5f8d14c`。
- 正式记录`.local/evidence/TC-SYS-024-M-table-cfc8-20261025-ascii-5x10-first.json`：
  `91a0f75a94d2fcd1ccaf46647805ad0341ef49b31e0295575e1019295f5b22c0`，与保留的原草案
  `M-table-semantic-cfc8-failed-record-v1/failed-evidence.draft.json`逐字节相同。
  记录内最初的“LOCAL DRAFT ONLY”备注作为原始编制历史保留；本段记录后续审核和正式追加事实，未改写原件。
- 草案独立窄审`cfc8-failed-draft-independent-review.json`：
  `f2eaf2c091af8a5bc66b99f1aeb60dc8c87f30d365a5c96e54a9648176788558`，55附件与52原件/副本核对一致，无阻断。

当前干净8247宿主的四节点×三视口×三倍率36项交互矩阵正在执行，尚不计通过；IME仍待真实输入。
本地自动检查237项中234通过、3跳过，业务383项通过；d5dbe17的PR CI run40164647495成功。
CI与纯检查不替代上述实际性能失败，四键方法诊断也不是达标复测。
真实本地模型推理仍为0/44，M6未通过，不发布。

### 6469候选已构建，真实复测待执行

新候选`1e5a19df6b9067fd48c03c5589264c3e580b88f9`的前端指纹为
`6469dd8a8069415fbc7753354fd8c8a55b0d51997deb5575971df88395993eb8`。
可选`projectedMaterialTargets`让表格Slot投影复用同一缓存中的列目标；完整元素拖放目标、原生槽位、
无该能力的adapter路径及输出投影顺序保持。两个500×10合成表的计数检查从每表5510次目标快照变为10次，
这只证明重复快照减少，不能换算CPU时间、输入延迟或正式性能收益。

独立读取完整`material-projection-capability-full-check-first.log`确认244项检查中241通过、3跳过、0失败，
业务383通过、0失败；类型检查、构建、架构及字体/许可证检查完成。
日志SHA为`4674fbd8e93f03f59c0e79a637371fef9edf35addba205e64a9e02dc411bf6e7`。
工作区构建清单与该提交相同，209份列出文件逐字节哈希匹配；清单SHA为
`84a29dc3c78fcc166afe328e7ecb6abafa6a8d5ea5cb268da811f510e53eeff8`。
本候选尚无实际M五轮复测结论，独立/组合安装和受影响Slot交互仍待实际核验；不能沿用cfc8为新候选通过。
后续只读查询确认1e5a19d的PR CI `Pure checks`成功（[run 40166157195](https://github.com/TeutonicMepheles/ComfyUI-DAELab-Creative-Studio/actions/runs/40166157195)）。
6469独立性能页已加载原始M夹具，尚无新正式输入分析结论；此前d5dbe17的CI仍保留为历史事实。

### cfc8交互矩阵的部分证据与异常

8247上的四节点×三视口×三倍率矩阵仍未完成最终验证。中间快照
`four-owner-matrix-cfc8/partial-raw-snapshot-01/minimum-gaps.json`
（SHA `a6d9a52033dc363ea256429c1d6c74f56177719bc3fe2b868500c1dd3e12f960`）
仅涵盖当时23项焦点观察、66份JSON；目录后续追加不能被该中间数代表。
早期表格采集用DIV的`.value`得到空值，缺实际正文、recordId、fieldId、connected；这是采集不完整，
不证明产品文本为空。页面/构建/原生加载关联及逐张截图可达性、溢出判断也须按实际记录补充，不能从模板推造。

680×720、50%的A菜单首次查找改写要求失败，记录焦点在A第二行。随后空改写要求的重试截图原样保留；
清除旧选择、重新选择并核对A第一行后得到其已保存草稿。
`table-keyboard-toolbar-cfc8-readonly-review.json`指出源码已有td focus选择、inline编辑清选区和focusin更新；
工具栏固定定位可能遮挡其他格，点击工具栏本身不会切换目标。当前缺首次pointer命中证据，
尚不能区分遮挡、操作目标或工具栏同步问题，不认定Enter失效，也不将恢复后的正确草稿回填首次成功。

1280×720、150%的A菜单操作又出现目标缺失，随后DOM显示新增空白`Unsaved Workflow (2)`；
`1280x720-z150-A-menu-first-error.json`及截图保留，JSON SHA为
`0bcd76bfa18bcc69e1ddf26b1cb9c73ce12a29c798cd7006bb516a160b211c83`。
原因尚未建立，不能计该次菜单通过，不能推断工作流数据丢失。上述矩阵仍为部分证据，IME仍待真实输入；
cfc8正式输入失败不变，0/44、M6未通过和不发布的门禁不变。

### cfc8焦点终局复核与85c5根滚动候选

后续复核覆盖36组最新焦点记录，67次焦点尝试原件全部保留。
两表实际正文/recordId/fieldId、两LLM指令、owner、connected、各自选区6/6及四路peer值在1111–1128ms停留前后相符。
`cfc8-matrix-final/focus-image-review.json`（SHA `39507daee1022dc45a05a9dfb27a9556898b94eeaf7708dc3f742c2bd54723f0`）
记录逐图检查：100/150%可辨caret，50%的caret线太小，视觉判定保留不确定，不能把DOM选区等同像素可辨。

12张报告1920×1080的焦点图和12张菜单图均实际1791×1080像素，未建立截取或缩放映射；
不由这些图片推出完整视口/右侧控件可见。680×720、150%的Table A编辑区DOM right约897.26，超过680，
该裁切由实际矩形支持；1280×720、150%的LLM B截图可见根覆盖控件左移。
`root-scroll-first-observed.json`（SHA `ae450cfe2eca51f575b41ac366a1c59e69c8887b8068f81a8794d0b012b605c6`）
记录根rect为58/96/622/624、clientWidth621、scrollWidth1818、`overflow:hidden`、scrollLeft约42.67。
36个菜单图路径及SHA全匹配，但root视觉结论仅针对菜单，native select popup矩形仍为null；
1920×1080、50%的A stable截图没有同名stable JSON，不把早期JSON回填为后续状态。

独立复核`cfc8-matrix-final/workflow-menu-independent-review-v2.json`
（SHA `0cc185a4c3d3ef816dced1856df2d38c4a2191fa75ac175fdd57e8e888d46c0f`）确认：
保存前相对f6原件只改Canvas viewport x/y；fit后只改x/y/zoom，页面重载后文件与fit后逐字节相同
（SHA `ce5b5b3619220fc22a6c7eb58b448aea993240238563d655140e70e242ab0400`）。
四节点、序列化槽位、两条output0→input3连线、业务值、extra.ds及所有其他JSON字段均相同。
递归比较未忽略未知键，但该小夹具没有专门注入的未知字段测试，不能据此宣布完整未知字段/迁移验收。
根滚动失败和编辑区裁切仍阻断完整矩阵通过；首次错选、空白工作流异常及早期采集缺口不被补充记录抹去。

修复提交`7e30994e9301c6ddad6cb943b411023c6bb719ab`构建指纹为
`85c5f071533bf7db2161438e2d6fcdce7d5251b25a3a5f2dea8bef6a2714914f`。
仅根画布增加`overflow:clip`来禁止焦点驱动的根滚动，保留旧引擎hidden fallback、内部auto滚动和world transform。
针对性首失败保留；完整`canvas-scroll-boundary-full-check-first.log`退出0，247项中244通过/3跳过/0失败，业务383通过，
209份构建文件哈希匹配。该提交PR CI [run 40166616781](https://github.com/TeutonicMepheles/ComfyUI-DAELab-Creative-Studio/actions/runs/40166616781)
首次查询仍在运行，文档冻结前再次只读核验已完成并成功；clip实际两实例焦点、Tab、内部滚动、覆盖控件、模式与保存重载仍待主代理部署后验证。
6469正式性能候选与85c5界面修复候选分开记录，未以新构建替换已部署6469；纯检查、36组数据稳定均不改变PERF失败、IME待测、0/44和M6未通过。


## 6469 同一 M 夹具：输入仍失败，首轮控制偏差保留

固定提交`1e5a19df6b9067fd48c03c5589264c3e580b88f9`，前端指纹
`6469dd8a8069415fbc7753354fd8c8a55b0d51997deb5575971df88395993eb8`，安装包SHA
`d58cb60b8169aa7fc4f6f91f26ea18dfc0996394ed6b2f879fcf116141571826`。本轮继续原始
`FX-PERF-M-no-video.json`（`79ecd59cf5bbd3022abda73c2368e3e45e3b9fed824494f813cd6109e381cc79`），
8237、1920×1080、DPR`1.0000000298023224`、预检及后态Canvas50%，不修改原件。
测试包仍为19文件`0f589b53989d4e0225b6bbb47b863f8b55992c2e1c1610cac890afdae358f646`；
只启用同一`834d0668…`表格语义observer。冻结计划SHA为
`196789569e2888aba835b87c48e8be2e8fe5c9872efbea0054422219e54cde3d`，实际明确预热10012ms。

| 轮次 | 会话秒数 | editing / display观察数 | editing p95（ms） | display退出p95（ms） | editing超过100ms |
| --- | ---: | --- | ---: | ---: | ---: |
| 1 | 297.826 | 10 / 10 | 281.2 | 566.6 | 10 / 10 |
| 2 | 31.088 | 10 / 10 | 241.3 | 608.4 | 10 / 10 |
| 3 | 31.058 | 10 / 10 | 239.1 | 534.6 | 10 / 10 |
| 4 | 31.108 | 10 / 10 | 266.9 | 618.5 | 10 / 10 |
| 5 | 31.101 | 10 / 10 | 225.6 | 489.1 | 10 / 10 |

每轮最近秩p95以N=10计算；全部50个editing超过100ms，**PERF-02输入分支仍为失败**。
50个editing、50个display均observed，各有4次身份/值正确的可见语义检查，没有缺失或超时；
全部为`insertText / event.timeStamp`，没有fallback时钟或IME样本。115个`outside-supported-identity`
拒绝完整保留，不猜其原因。display退出指标只描述blur之后；输入到display包含人为停留，不作为纯渲染耗时。
两个rAF只证明绘制机会，不是物理显示或完整性能验收。

首次原冻结分析器输出exit 0、`fiveRoundsComplete=true`，只说明原始数据中50次注册动作与两个阶段完整，
**不说明干净五轮协议或性能通过**。R1 A1使用原locator键盘路径；B1的Ctrl+A locator两次超时，
当时B仍为原文、observer仍只有1个输入。随后原生Ctrl+A确认只选中B，再唯一输入a；之后48键改为原生键盘，
Enter仍使用精确td定位。R1第一/第二输入间隔约257秒，会话297.826秒；恢复B1跨工具调用，
因此原同调用/同路由执行条件有明确偏差。R2–5为约31.1秒，全部50键实际dwell600–615ms。
保留长中断和路径变化，`cleanFiveRounds=false`；不补采、不改冻结计划、不从后来样本推断优化收益。

计划列出的独立round-context文件没有生成，实际保留累计roundN-operator与各轮raw。各轮raw记录视口/DPR；
Canvas50%与其他observer停用的DOM上下文只在预热前后、postflight和重开有快照。
此缺口不能回填为逐轮独立UI核验。加载/文件选择的控制错误、最终重开的两次CDP读取失败全部保留，
不能从工具deadline推出产品加载时间或根因。

实际CtrlS保存后，原生CtrlO重新打开宿主磁盘文件，最终DOM为300cards、两张500×10表、A=O/B=y、
干净标题和原视口；截图随记录保存。保存件SHA
`83759b4c61a24d15dfea693296fa52740851b932b5005657f1e991dde8d2c7a3`与cfc8最终保存件逐字节相同，
对d599只变化`extra.daelabPromptOptimizationV1.documentId`。300节点ID顺序及400条连线一致，
10000个表格值中只两目标变为O/y，9998个未编辑值精确保留；原始工作流经宿主规范化的其他差异完整列出，
没有据普通合成夹具声称未知字段的全部迁移覆盖。保存重开是输入计时之外的后续检查。

前后9份服务文件（原协议8份及补充adapter1份）与安装字节一致，6个已有宿主PID/生日/参数/安装/fixture/
listener及点时空队列一致。这不是连续idle、CPU/GC、浏览器缓存模块字节或零外连审计；
网络/推理遥测保持null，不能写成已测0。只覆盖ASCII无视频输入；M拖动/缩放、视频比较、IME及完整UI矩阵仍未完成。

本地首次结果与保全：

- 原始5份：`.local/performance-actual/M-table-semantic-6469-round{1..5}-raw.json`。
  `M-table-semantic-6469-round1-raw.json` SHA `c72065bacd6cbf400ec5459e00eb155db17a0c2990b9624b5e9e3a492545c18d`。
  `M-table-semantic-6469-round2-raw.json` SHA `b056825574e8f57d5002ef1f326471357cbb48196f1708a897691dde0554162f`。
  `M-table-semantic-6469-round3-raw.json` SHA `20b5934419c4a24da27cc897beac9b2d3fb91acdade3ffd6c1e151fa32e1903d`。
  `M-table-semantic-6469-round4-raw.json` SHA `5495516c31125ccfaf4a416708b5436804097c68ce92fffe3ea42119483d0cf3`。
  `M-table-semantic-6469-round5-raw.json` SHA `e2b50b60348f8c6bf52be4420bb7b6406b393254de28365188ecaf52755a3ffc`。
- 首次分析：`.local/validation/6469-table-semantic-preparation/candidate-analysis-first.json`，
  SHA `7f2627c20e4449d61d22c3d77506ea93cb558b7f8c023a2f6d7300ca0a6ec037`；
  首执行记录`analysis-first-execution.json` SHA `821f7c303a81962b4fa8c4af81b44182f21a4a75d0908004ce8590897f497763`，
  首exit 0与原raw前后哈希不变均保留。
- 独立离线核验：`.local/validation/M-table-semantic-6469-independent-review.json`，
  SHA `3e9fa63bf20087073a19f675b2c43677f07b30642196d5b8728c4a12d71e3efa`。
- 失败草稿：`.local/validation/M-table-semantic-6469-failed-record-v1/failed-evidence.draft.json`，
  SHA `4018795f7536ad2239a4d908007a28430004f613b346ffe89885cb627c582607`，61份原附件独立窄审无阻断，草稿原件不改。
- 独立窄审：`.local/validation/6469-failed-draft-independent-review.json`，
  SHA `3b28e1ba863c26a10eb0a5c0371d60abb4a8ed82888db0ebaba8b91d8d871d5f`。
  按root授权将该审查及截图覆盖附注附入63份附件后，通过schema/catalog与字节校验并不可覆盖追加。
  正式记录`.local/evidence/TC-SYS-024-M-table-6469-20261025-ascii-5x10-first.json`，
  SHA `b6e489b1ef9e78664ef901c93f3c8b4bf477a6d71fdec66ad96f5118794e9f73`；首append exit 0。
  AS-SYS-024-001 failed，AS-SYS-024-002 not-executed；正式追加只留存真实失败，不等于退出门禁通过。

此前1c166/a956/d599/cfc8原始失败不覆盖、不supersede。当前85c5 clip候选已在8247开始真实回归：1920×1080/50%的两表两LLM前4组焦点/root与Tab滚动0已核，
其余视口/倍率/完整矩阵进行中，不能由前4组或构建/CI成功宣布完整修复；
cfc8根滚动、680×720/150%编辑区裁切及1920DOM/1791截图覆盖限制继续保留。真实推理0/44，M6未通过，不发布。


6469重开截图的格式/覆盖附注：`M-table-semantic-6469-native-reopened.png`实际为JPEG、1791×1080，
DOM报告视口1920×1080；保留原名和字节，不当作完整右边界视觉证据。它仅作补充，保存数据以完整JSON及DOM为依据。
85c5本轮另已取得显式请求1920×1080的完整截图；这不追溯填补此前1791宽原图。

## 85c5 四实例界面矩阵：根滚动观察正常，尾部编辑仍失败

独立干净CPU宿主8247固定`7e30994e9301c6ddad6cb943b411023c6bb719ab`，前端
`85c5f071533bf7db2161438e2d6fcdce7d5251b25a3a5f2dea8bef6a2714914f`，包SHA
`d4fa2844d215648125b02f36e86c33274d398ffc4e03016fa0d724c048dab5e1`，未安装测试fixture或observer面板。
以同一final15四节点文件及仅改变Canvas zoom的三个副本，完成1920×1080、1280×720、680×720，
各50%/100%/150%，两表提示词和两LLM要求共36组焦点及36组菜单观察；这些是功能取证，不是输入性能样本。

36组实际正文、逻辑owner、connected、选区6/6及四路peer值在1102–1116ms停留前后相符。
每组焦点前后及Tab后根scrollLeft/scrollTop均为0、overflow为clip，固定缩放/资产控件矩形未变化。
这支持本次采样端点未复现cfc8根滚动，不代表全程监控、跨调用DOM对象身份或所有滚动路径通过。
独立逐图查看36张完整焦点图与36张菜单图：18个表格composer及18个原生LLM选项弹层均在视口内；
原生弹层依据实际像素，不以select控件矩形替代。100/150%的caret可辨，50%的线太小，仍保留图像判定不确定。
首个A菜单原记录缺selected，后来独立补图/DOM确认第一行与正确草稿；原缺测不被倒填。

首4张焦点图实际JPEG1791×1080，其中两张虽名为.png且原记录误按PNG头读取尺寸，原文件及错误读数均保留。
随后4份明确1920×1080截图补全对应静态焦点画面；它们不替换先前停留样本，也不重写原图。
其余32张焦点图及36张菜单图均按当时DOM视口显式截图、实际像素尺寸匹配；完整右边缘结论仅用于这些对应图。

**680×720、150%的Table A尾部编辑仍失败。** 活动编辑框right约946.59，超过680；真实End后
caret=50/文本长度50，但caret x=791.8125仍在视口外。随后空白区域平移的即时DOM得到x=648、正文不变，
实际后续截图未能确认完整尾部与caret持续可见，再次Tab定位失败时active为BODY。不能用即时坐标替代持续可编辑证据，
也不从跨调用时间差猜具体失焦根因。该首失败保留，矩阵不判整体通过；真实IME仍未执行。

另完成四节点各Mute→Active→Bypass→Active共16状态，逐图及DOM复核：只目标面板折叠，
8个恢复端点的四卡正文和控件均与参考Active端点精确相同。表格停用时对应LLM输入清空并提示不可用，
其要求保留，另一路不受影响；最终四节点全部Active。原生模式动作和面板恢复不等于生成执行验证。

NativeSaveAs、原生CtrlO、页面重载、App Mode欢迎页进入后返回Graph/Creative Canvas并CtrlS，
最终文件`saved-after-reload-app-return.json`与`saved-before-reopen.json`及f6的`15-post-reload-saved.json`
三者18817字节完全相同，SHA
`2eabe9d89664f154a37730dd12f201b97397fce9a72cda89a110df5080043144`。
四节点ID、mode=0、表格2入1出、LLM5入2出、原槽位、两条output0→input3连线及全部业务/现有未知字段均未变化。
没有专门注入的未知字段夹具，不扩大为任意未知字段或迁移验收。最终DOM标题无星、四路值保留、根滚动0，随后tab53关闭。

App Mode只观察欢迎页及返回，**没有构建或执行应用**。进入时DOM确认rootHidden，但三次显式完整截图失败，
成功的默认图仅JPEG1791×1080，不能证明1920完整右边界；返回后的图为完整1920×1080且四卡恢复。
页面重载首次截图失败、派生初始化dirty-star及后续CtrlS clean均按时间保留，不用最终成功抹去中间状态。

本地独立记录（原件目录`.local/performance-actual/prompt-llm-85c5-clean-matrix/`）：

- 完整36组复核`85c5-matrix-readonly/full36-focus-menu-review-v2.json`，SHA `bfd743cb7452d1fe0b744f30eb1da4dfe071c4e7b3b4a1a7d143d311aadf8237`。
- 首格式纠正`85c5-matrix-readonly/first-image-format-correction.json`，SHA `a91767cba77983a045ce6835db957c1e76ce92533ea15bfe9d80f2f8549d34d0`。
- 尾部首失败独审`85c5-matrix-readonly/tail-first-independent-review.json`，SHA `109943eacbae0cc4bbb6a6acb4f07c95b2493b331da1c0b640cd84cdbc7564c6`。
- 16状态/初次保存附录v1，SHA `2775a2b01d686739d020754653400916c9da685a00c8175c6ece0159706af926`；
  后续`85c5-matrix-readonly/mode-save-appendix-v2.json`，SHA `e0abbc67b604574db3d2772f1a5f57f657815d7790fe24d316633d65d1e5cae4`，v1保留不覆盖。
- 累计`operator-all-final.json`，SHA `2f4c0f0451cbea8f3ec87fd74df8d5609db90cd338de01e6a04797afcc88347e`；
  `final-dom-before-close.json`，SHA `d85c594af86303c0c7b6599c667036daaab60f647213c322954189e8b6f1357b`。

### 5105端口投影候选仅完成构建与自动检查

后续提交`72aaf06cc0006b353714bc664350b823db1e6722`，构建
`510538aaa7878945ca242282fc9236ea8106bcc9216216389caf7af026c8f6c3`，只对已有、唯一、归属受限的输入端口
先读几何再写样式；首次端口、输出端口及不满足边界的adapter沿用原顺序。完整检查250通过/3跳过、业务383通过，
209份构建产物校验一致，首机制失败保留。主代理已核[PR CI 40168001794](https://github.com/TeutonicMepheles/ComfyUI-DAELab-Creative-Studio/actions/runs/40168001794)
及[push CI 40167999036](https://github.com/TeutonicMepheles/ComfyUI-DAELab-Creative-Studio/actions/runs/40167999036)成功。
这些结果不把85c5界面观察归给5105，也不证明性能收益；该候选尚无正式性能通过证据，后续分段诊断不能替代五轮测量。
既有PERF失败、尾部编辑失败、IME待测、真实推理0/44及M6未通过仍保留，不发布。

### 5105四键分段诊断，未作为正式性能样本

在同一原始M夹具、1920×1080/50%、8237固定5105安装上，预登记执行A:P、B:z、A:O、B:y。
方法观察器和LoAF同时启用，其他观察器停止；四次操作停留为606/612/601/602ms。
四个输入的被观察方法区间并集为98.4/101.9/96.2/87.5ms，capture到方法租约恢复为
208.4/195.3/189.2/175.7ms。两者之差是未归属的经过时间，不能当作CPU或绘制耗时。
八个方法租约均按原描述符恢复；前后约两秒无输入对照仍有3/2个长帧，不是零后台工作。

共保留24个LoAF、55个脚本记录。四个input回调包络合计518.8ms，其中88.4ms被浏览器标为
强制样式/布局；四个Tab-keydown回调包络合计783.0ms，其中731.8ms为强制样式/布局。
强制样式/布局已包含在脚本时长内，不能相加；源位置仅定位回调及其子调用，不能认作函数self-time。
本次同时开启的观察器与旧方法单独诊断不同，不能把差异全部归因于5105产品修复。

原始方法报告SHA `6cdec47a54d22d4537e559996d7ca07a1a404e3a66c86f0f00eb9d5b9f86fdff`，
LoAF报告SHA `63b2e27e298a3a1fb31166483539d7d0ea3d410a3a0cf540e57f98a08f34493f`；
独立分析`.local/validation/M-input-stages-5105-first-analysis.json`，SHA
`2d56594879459ca78bcce273c550d1a2e5796889d57ce68932af344959feda39`。
停止观察后保存文件与6469最终文件字节相同。随后为正式测试重新打开原始M时遇到多次浏览器控制超时，
没有发出正式输入；错误与未执行决定保留。5105未执行正式五轮，四键诊断不用于100ms预算判定。
后续候选减少普通替换的重复验证快照并增加光标视口揭示，须在最终构建上重新执行完整协议。

### a2da四实例复验与正式输入失败

固定提交`cdeead8c9f15d1a1279c35a20fe6fae004fd9a23`及来源补充`2974711d46c63998303e13c765ccbf047d765295`，
构建`a2da4e1a97e1294f6d9f8c5d0659acfaf99114c51bc6f3274a4ca0516b930061`。
完整检查268通过/3跳过，业务395通过；只读节点测试的data-URL加载器首次失败保留后修正。
PR CI `40169108432`和push CI `40169105002`均成功；这些检查不证明实际性能改善。

8247干净安装在相同final15四实例夹具完成三视口×三倍率的36焦点/36菜单、16模式状态、
保存重开、页面刷新和App欢迎页返回。36焦点正文/owner/选区6及peer值保持，根滚动为0；
100/150%截图可辨caret，50%细线判定仍有限。680×720/150% A尾部End后caret在x=664，
手动平移24px后的约10秒端点保持当前编辑者、选区与正文；未复现85c5的尾部不可见现象。
这里的平移幅度与85c5不同，不能宣称所有旧失焦路径已排除。
模式、保存与App独审`a2da-modes-save-app-independent-review.json` SHA
`9947afe75f6e3adfd549d32aeecfc1a70a68eb50389ee7a1018accf8fa8db6a4`，
三份18817字节工作流均为`2eabe9d89664f154a37730dd12f201b97397fce9a72cda89a110df5080043144`。
本轮未修改四实例正文，不扩展为普通替换编辑/撤销验收。

**完整键盘交互仍失败。** 独审Tab后态发现9个表格TD和2个LLM按钮完全在屏幕外，另2个按钮部分越界；
`a2da-post-tab-focus-gap-readonly-review.json` SHA
`5f50f9e08b9919fea7059315bdd84f2427020b0539ef36170df78088b0140bdf`。
caret显露只覆盖编辑者，不能替代非编辑焦点可见性。最小Tab候选已保留旧源码首红并通过25项回归；
后续与同值文本节点复用合并为`70a56c6c6ca10be091ca98010afb5c0a71941c81`，构建
`7b5e90f99f27bfceb80c4e35bf58fbff3f850b180747a38d5f7f163bd5d9d702`。
完整检查275项通过、3项跳过，业务401项通过，两次来源清单校验失败及修正日志保留。
该候选尚未部署或实际复验，不继承a2da的CI、交互或性能结论。
真实中文IME也未完成：Chrome恢复并打开隔离8247后，Windows电脑控制
仍因无法可靠验证当前网址而结束当轮；未用粘贴或合成composition事件替代真实输入法。

8237正式输入计划SHA`e55508b589a593705d093b6502dbd9610975f8ef13a3724424def0b4570d454c`，
使用原始M SHA`79ecd59cf5bbd3022abda73c2368e3e45e3b9fed824494f813cd6109e381cc79`，
300节点/400连线、两张500×10表，1920×1080/50%、DPR约1；仅语义观测器启用。
32秒实际预热后执行预登记五轮、每轮十次A/B交替ASCII替换；从首键采用相同原生Ctrl+A/key/Tab路线。
每次600–616ms编辑态停留在单次控制调用内完成；50次无输入错误或重试，各轮前后实际DOM上下文保留。
只读DOM环境未暴露performance.timeOrigin，context诚实保留null；五份raw提供相同timeOrigin，
上下文依靠同页URL和操作记录关联，不能称独立DOM时钟证明。

| 轮次 | editing样本 | editing p95 / ms |
| --- | ---: | ---: |
| 1 | 10 | 505.5 |
| 2 | 10 | 440.3 |
| 3 | 10 | 411.8 |
| 4 | 10 | 397.6 |
| 5 | 10 | 356.4 |

50个editing与50个display均observed；editing最小298.2ms，全部超过100ms，PERF-02失败。
原分析首次exit 0只表示样本完整。独立协议审计
`replacement-caret-table-semantic-preparation/protocol-audit-first.json` SHA
`09113cf4a5c493af8828db22d33303b29bc0fd81a43312c4424a2cb5e055dea5`；
五轮原始SHA依次为`c51dc372e8ed7511a767b67c2091f56bfd899979331fe585e5a7350d12fbeea9`、
`fab2b37b5113cfa2f161a17a8063a2721e65213d7ca8808c7f0d7a69f117daf6`、
`b175d2f864eed92034b714a5fe2b9b849b42283041f6be88f4a41ae7e9090e07`、
`1709d9423d049b7ee3d72a68ada79d3cc9a377dbea988ee9efeef8342100c2fc`、
`78bca1d74335468e9d71584d84721ef8481a71aa5a83fe3ceccb5fb7297a59e4`。
六个既有隔离CPU宿主前后身份/marker相符且采集时queue0，11份服务文件及health前后相同；
这不是连续系统负载监控，不能把相较6469的增长直接归因于单一函数。

最终保存文件2400204字节、SHA`83759b4c61a24d15dfea693296fa52740851b932b5005657f1e991dde8d2c7a3`，
与6469/5105最终值文件完整字节相同。独立比较10,000个cell值仅A=O、B=y两处预期变化，9998格不变，
行列身份/顺序及300节点/400连线保留；派生元数据规范化不被误称为全JSON仅两leaf变化。
原生重开后实际DOM再次确认O/y、两表各500行、300卡和clean标题。
准备/重开控制超时、显式截图失败以及首次焦点留在测试summary导致Ctrl+S/Ctrl+O未触发均原样留存；
首次保存副本不冒充最终文件。返回工作流按钮焦点后保存与文件选择成功。
此次更慢的正式失败、Tab缺口及WindowsIME阻塞继续保留；M6未通过，不发布。

独立审核原86份附件后，追加审核报告作为第87份附件，正式失败记录已写入
`.local/evidence/TC-SYS-024-M-table-a2da-20261025-ascii-5x10-first.json`，SHA
`19636df14f41b67c6aef2c1f8121923a2884e59cd10b6a5154b36455eb79f45d`。
原草案SHA`67f40edb5d8190e58ddef5bffc6449fb0cd753cfd69a697c0b56fed74f4e0465`保持不变。
AS-SYS-024-001为failed，AS-SYS-024-002为not-executed；首追加脚本在写入前因导入路径错误失败，
保留首次错误后修正，第二次追加成功。文件验证成功不改变性能失败结论。

### a2da四键LoAF诊断与观察器干扰

同一原始M、8237/a2da、1920×1080/50%预登记执行P/z/O/y四键，仅启用LoAF；
停留613/607/609/601ms，前后无输入窗口2011/2013ms。原始报告SHA
`916e237c308c09d40dfbe1c1d0a5770b36c362fc3c041fc074c6833dc017e648`，
首次分析SHA`ac63ac6ba4b67e01f2cfffd2dc82c344be7964d5ca68c1cf77d854bdd6986fe1`。
21.3155秒内125个长帧、300个脚本记录；脚本区间并集6755.8ms，强制样式/布局1692.9ms已包含在内。
Start/Stop约束的时钟偏移范围仍有465ms宽度；在该不确定性内，前后无输入窗口仍确定完整包含16/19长帧。

观察器每批报告改写body中的输出文本，可能触发Canvas菜单MutationObserver与syncMenu；
源码独审确认可触发链，原始数据没有逐条MutationRecord因果归属。不能把125长帧直接认作产品退化，
也不能与5105同时启用方法观察器的24长帧作单变量比较。Tab回调包络938.7ms中含强制样式/布局842.2ms，
是回调及子调用归属，不是函数self-time。实际无caret模块归属不证明它零调用或零成本。
只读DOM控制的开销未被量化，不能从正式输入延迟中扣除；原正式50次失败继续有效。

### 7b5首次实际Tab复验仍失败

固定代码`70a56c6`及构建`7b5e90f9…`部署到干净8247，513份产品文件与Git一致，12份服务文件匹配，fixture为空。
ready记录SHA`ac5526dde58a29cb7b3758f30d171720f558679367550ad12b77b5dad946b026`。
沿用final15四实例及仅改变zoom的副本，已执行1920×1080/50%、680×720/150%的8组焦点/Tab/Shift+Tab。
**Table A的下一行行头在Tab后仍完全屏外**，另行1100ms保持观察未恢复。
剩余28个焦点组合、全部36个菜单组合及本候选的模式、编辑历史、保存重开尚未执行；停止重复扩展失败矩阵，待修正后重新完整复验。

150%补证显示行头left=-636.890625，内部滚动容器left=-637.890625、宽1710，CSS宽1140、边框0.666667px。
现实现使用整数clientLeft=1乘1.5，将左内边界算为-636.390625，误判约0.5px的内部裁切。
CSS浮点边框及矩形序列化精度仍需在修复中处理，不采用任意像素容差掩盖真正裁切。

首收集器对非表单元素误用了value优先读取，active.text空值不是数据丢失证据；peer正文读取保留。
行头的行ID位于TR而非TD，已另存祖先记录，未回填原记录。Tab即时坐标也可能先于rAF平移；
680×720/150%的LLM B追加保持观察确认“恢复原结果”按钮x=510.67..664、反向textarea x=74..556可见，
不能把先前即时屏外坐标直接判为稳定失败。截图均为真实JPEG，尺寸为1920×1080或680×720。
63个原始及补充文件清单`.local/validation/7b5-partial-focus-files-first.json`，SHA
`48c6bd9ae7dd7b500e2f8ae06ed6d0b5dbcbef8d020645440efe0526fc9ab5f1`。

### a2da延后显式DOM读取的四键诊断未证明改善

原始M、a2da和834d语义观察器保持不变，输入P/z/O/y；把第一次按键后DOM读取移动到600ms停留之后。
新页实际DPR1.5，与旧正式系列不同；输入前补充登记SHA
`7a9ff71c091b8f42936062e68857ae2bffa0671a43cb5636a104b9695513cf7f`，原计划SHA`e6111f07…`保留不改。
这是N=4诊断，不是单变量实验或正式五轮；浏览器控制内部开销仍未知。
原始报告SHA`37f3e811bf371533fe35492f3488ed8e2ec58584a33204a512eb8331158e9f89`，自报DPR1.5。
四次停留为608/607/615/613ms，第一次显式读取均在停留之后，四个editing全部为not-observed-before-display；
首rAF间隔597.6/837.0/763.2/772.0ms不能冒充完成延迟。四个display完整，退出至第二帧为
1673.5/1864.1/1845.8/1832.6ms。缺测和更慢的结果全部保留，不证明时序调整改善，也不据此猜测CPU或节流原因。
最终DOM的document.hidden为false、visibilityState为visible；这不证明持续负载稳定。
原生CtrlS后clean标题及O/y已核；保存后态不补足缺失的editing观测。正式100ms预算仍未通过，M6未通过，不发布。

首次分析exit2，`.local/validation/M-table-delayed-dom-a2da-first-analysis.json` SHA
`e291bf6ba074c7c23b9a85480e0b6643b47e9027d85916f927f2e7b9e2131629`；
独立保存副本2400204字节、SHA`83759b4c61a24d15dfea693296fa52740851b932b5005657f1e991dde8d2c7a3`，
与旧最终保存件字节相同，9998个未编辑值和行列身份/顺序均保留。新页面准备中的两次CDP超时、DPR调整未生效、
预检对8227既有启动包装器的首次误拒均保留，后续补采不覆盖首记录。

### 41a8候选仅完成自动检查

提交`f616d281ce714f4d51312b5f7b22831960f87c6c`，构建
`41a8e1a2cfb2237d9579afce45a68372defde5c681556c69f1e9b15b0abd35dd`。
表格serializeValue只在完整旧路径证明当前不可变字符串已规范化后复用；每次重新读取当前值并核对节点、图、widget、
输入槽及实时link，连接、liveSource、非规范值或所有权改变均回旧路径。固定宿主customtext公开getter的miss额外读取一次，
不承诺任意第三方副作用getter等价；不缓存公开可变快照，不更改历史调用链。
两张500×10表各连续六次序列化，完整解析调用计数由6降为1，仅是机制测试，尚无实际浏览器命中率或延迟收益结论。

焦点修正只用于支持条件下的左/上浮点边界，使用CSS数字及矩形浮点精度界，保留右/下原始限制；
不是固定像素容差。当前几何的0.001px/0.01px真裁切回归通过，不扩展到任意大坐标或亚数值精度的保证。
两候选独审无阻断；完整检查一次通过：282通过/3跳过、业务413通过、211个构建产物、141个架构模块。
检查首日志SHA`11f9e4ed107a244dfc29f6323d62be635accac4a646854f8e617c421be64ab28`。
检查后打印摘要的GBK终端编码错误另行保存，没有重跑npm或把该包装器错误藏去。
完整产品515文件SHA`d9da878c38c20d41d7df466c8ad2d0ac153cba355b459d45ad97594c1efcfc9c`，19文件fixture仍为`0f589b53…`。
本候选尚未部署实际复验；不能继承7b5/a2da的运行结果，100ms、真实IME、0/44及M6门禁均未闭合。

### 41a8部署后的两例焦点复验仍失败

固定`f616d281 / 41a8e1a2…`已刷新8237与干净8247，两边均为515文件包`d9da878c…`；
8237保留19文件测试夹具，8247无夹具。首次就绪、服务文件核对与备份见
`.local/validation/refresh-41a8-execution-handoff.json`。文档提交`d218524`的CI `40174732280`成功，
与固定产品提交仅两份验证文档不同；就绪和CI不证明交互、性能或持续空闲。

实际仅执行Table A的1920×1080/50%与680×720/150%两组focus/Tab/Shift+Tab。
两组编辑焦点的正文、owner、6/6选区及peer值在保持观察前后相同；前向Tab的任务2行头现已可见，根滚动为0。
**680×720/150%反向Shift+Tab仍失败**：目标为`contenteditable=false`的prompt DIV，
宽838.59px超过安全可用590px，left840.89..right1679.48全部在680px视口外；
1127ms保持后及距首次18.501秒的补读均未恢复。源码的wholeControl超大矩形拒绝足以阻止平移，
与已修正的左/上边框误判分开；这不是将编辑caret可见等同整个控件可见。
21份原件（6张case图及1张预备图均为真实JPEG）清单SHA
`3ed860b8e501cefb21e10a3cded91ff2176fe7a95fb86fc31a9aca8992e27ef3`；独审SHA
`ea2bf72082be41c3af07d33ea7eaf1df5f2e7db825d350b49fbaedceb68a4a3b`。
对应`.local/validation/41a8-partial-focus-files-first.json`及`41a8-partial-focus-independent-review.json`。
剩余34组焦点、全部36组菜单、模式/编辑历史/保存重开/App等未执行，矩阵不通过。

后续oversized非编辑控件修正只在可信Tab路径显露起始区域，完整原矩形仍用于内部裁切检查；
源码`50cfbf29…`及focused 38/38首红/最终记录均保留。已提交`8910bd207ab8419d8943ba9113a6ee7510be77dd`，
构建`8965454852e269b1fb1989e4e08c50bd977739d070aea9522cb9e098c2d18f4e`，完整检查首次288通过/3跳过、业务413通过；
515文件包SHA`61efb02006d1777c26d58d9953ed843324453f236cd811fb694774837697e906`。
构建交接`.local/validation/tab-oversized-combined-check/combined-handoff.json` SHA`ef608b7f…`。
截至本次更新新候选未部署或实际复验，8237/8247仍为41a8；不承诺整个超大控件可见或性能改善。

### 41a8正式五轮失败与显隐对照未生效

原M夹具`79ecd59c…`、834d观察器、1920×1080/DPR约1、Canvas50%和固定50键计划保持。
50个真实输入顺序/目标/值全部匹配，动作错误0，实际停留600–615ms；50个display完成。
**editing仅9个可测、41个not-observed-before-display，9个均超过1000ms，正式性能失败且测量不完整。**
五轮可测N=3/2/1/1/2，最近秩p95分别1130.5/1123.1/1004.6/1074.7/1105.7ms；
这些是可测子集描述，不替代每轮N=10，也不为缺测填值。冻结分析首次exit2，
`.local/validation/41a8-table-semantic-preparation/candidate-analysis-first.json` SHA
`180ea4449cb35518b19e9d02d31a751c931bca9e1ecbaa31b720c2c80ab6c684`。
R5首动作DOM记录edited.at比operator dwellStart晚1ms，首次严格时序断言失败保留；未加容差或假定两时钟同域。
六宿主/17服务文件前后核验相同、队列点时为空，不代表全程负载或浏览器调度原因已知。

保存件SHA`83759b4c61a24d15dfea693296fa52740851b932b5005657f1e991dde8d2c7a3`，300节点/400连线、
两表行列身份与9998个未编辑值保留，仅两目标值为O/y；不是宣称完整JSON仅两leaf变化。
`M-table-semantic-41a8-reopen-context.json`与实际1920×1080 JPEG `M-table-semantic-41a8-reopen-final.jpg`支持原生重开后300卡、
两表各500行、O/y和clean标题。DOM列数采集仍为0，10列来自保存数据；重开成功不消除缺测。

另按计划SHA`116ca7deb4a1bf15b67cf0622761a9f45187fd7a14720ab43d3a16bf6d21e762`执行12键显隐ABA诊断，
三段原始文件为`M-table-41a8-visibility-{hidden-before,visible,hidden-after}-raw.json`，均保留。
工具请求visible=true后实际get仍false，三段observedBrowserVisibility均false；各段DOM端点仍报告hidden=false/visible，
两种可见性作用域不能混同。editing可测数1/1/0，其余10次缺测，display12次完整；目标可见干预未生效，
不能形成显隐对照或证明浏览器节流是根因。`open_in_codex`显示tab60仅返回queued，主代理已请用户切回本任务并保持Codex前台，
尚不以此推定实际前台状态。此诊断不替代正式失败；先前a2da50次失败和N4全缺记录不改。
真实IME待验、推理0/44、M6未通过，不发布。

### 8965部分矩阵与菜单首个裁切失败

干净8247已按固定`8910bd2 / 8965454852…`刷新，515文件包`61efb020…`、无测试夹具；
就绪原件`.local/validation/refresh-8247-8965-first/ready-first.json` SHA`de5e9b39…`。
同一四实例夹具`2eabe9d8…`已完成1920×1080/50%的Table A和680×720/150%的四实例，共5组focus/Tab/Shift+Tab。
每组有至少1100ms稳定观察，owner、四路值、6/6选区和root滚动保持。
窄视口Table A反向Tab现在显露左端，原完整矩形为x74..912.59；仅是超宽控件起始区域恢复，不承诺完整可见。

四个菜单key都已执行，但首批B/LLMA/LLMB截图过早，缺少展开菜单的视觉证明；首图保留，另存补图。
B补图确认完整composer；LLMA第一次展开补图的选项x−33.3949、左侧文字真实截断，属于保留的失败。
随后LLMA/LLMB经真实Tab导航到可见select再展开，选项完整，Qwen仍选中；这些不同条件补测不覆盖首次裁切。
实际样式为`appearance:base-select`，UA三个fallback都依赖锚点两端。候选共享CSS追加全横向区域回退，尚未实际部署验收。
这组补件DPR变为1.1，DOM680×720与JPEG680×720同时记录，但截图内容存在缩放和padding，不能按像素一比一推断CSS几何。
显示截图时一次相对路径ENOENT、视口guard失败及缩放调整记录也保留。

目录`.local/performance-actual/prompt-llm-8965-clean-matrix/`共62原件（23 JPEG、39 JSON），
冻结清单`.local/validation/8965-partial-matrix-final/originals-first.json` SHA`58b25797…`，
独审`review-first.json` SHA`1e44c8ac…`。覆盖仍为5焦点/4菜单，不因补图增加唯一key；
剩余31焦点、32菜单、尾部光标、模式、编辑历史、保存重载/App及序列化连线补充未完成。矩阵未通过。

### 41a8用户确认前台后的12键补充诊断

41a8正式失败已仅一次追加至`.local/evidence/TC-SYS-024-M-table-41a8-20261025-ascii-5x10-first.json`，
SHA`94cdbbad19cdbd3e932d15940143aa99d13075c4b1d1d77b747c12d46751ff63`，186附件；
AS-SYS-024-001为failed、002为not-executed，原185附件草稿未改，旧显隐ABA不混入正式数据。

用户确认本任务及右侧8237已前台后，首次工具仍返回false/queued，DOM为visible；
浏览器缩放复位后1920×1080、DPR1，后续工具读数true。这些不同时间与作用域原件全部保留。
预登记`.local/validation/41a8-user-foreground-supplement-plan.json` SHA`a3248b60…`，
继续同41a8/834d、同原始M身份与当前已重开O/y状态，无reload；三块各预热10秒、A:P/B:z/A:O/B:y，
仍为立即DOM读取、600ms停留后原生Tab，不改变观察器时限。背景8247已经8965，是明确记录的环境差异。

12次editing/display均observed，editing范围255.6–388ms、中位306.15ms，**全部超过100ms**；
三块N4最近秩p95为388/338.4/346.3ms，只作描述，不替代正式50次或声明预算通过。
退出编辑至display完成为469.1–675.2ms、中位631.05ms；实际停留601–614ms，0动作错误，33次outside拒绝原因不猜。
六次前后环境端点均为1920×1080/DPR1/50%、DOM visible和工具true，最终值仍O/y；不证明连续前台或因果。
首次setup字符串代码生成被拒在计时前、0输入，已保留；随后显式函数定义未重发任何已发送键。

原始系列`.local/performance-actual/M-table-41a8-user-foreground-supplement-*`；
分析`.local/validation/41a8-user-foreground-supplement-analysis-first/analysis-first.json` SHA`d11a91ab…`，
57份原件归档清单SHA`61999951…`，独审`.local/validation/41a8-user-foreground-supplement-independent-review.json`
SHA`6a29bca1…`。旧正式失败、旧ABA缺测和全部历史候选不变。

只读审计定位普通单格输入后的`updateFooter→refreshStates`会扫描500行/5000格，但尚未量化其占用；
测试分段观察器原先只包`DocumentController.edit`，实际输入使用`replace`，空edit记录不等于持久化成本为0。
新增测试专用replace边界保留原事件lease与身份检查，34项相关检查通过；既有wrapper的DOM身份检查成本未扣除。
这些源码与机制事实不构成性能收益证明。Chrome扩展新建8247页另报HTTP响应失败，拥有的错误页已关闭，
本机HTTP200不等同Chrome可达；真实Windows中文输入法仍未执行。M6未通过，不发布。

### 读取时序ABA与同步持久化分段

固定旧41a8/834d/0f589夹具，在同页1920×1080/DPR1/50%追加预登记12键A1/B/A2。
A在按键后立即读编辑态再停留600ms；B在按键返回后602–609ms内无显式页面读取，再读编辑态并Tab；A2恢复。
三块各四个editing/display均完整，全部editing超100ms；中位235.70/295.95/284.30ms，N4 p95为256.2/372.2/345.4ms。
B没有显示一致改善；不能因此证明工具读取有或没有因果影响。原生按键API内部行为未知，被动834d读取仍在，
实际key→Tab时长也不完全相同。原始系列`M-table-41a8-tool-dom-ABA-*`、30原件归档与独审均保留；
独审`.local/validation/41a8-tool-dom-ABA-independent-review.json` SHA`4adc850e…`，不作正式追加。

随后仅8237测试夹具更新到19文件`3663cd47…`，产品仍固定41a8/515/d9da；新方法观察器`52780a9d…`只补replace边界，
语义观察器834d未改。严格停机刷新保留原生保存件、SQLite逻辑备份、停止后的数据库/sidecars及旧夹具原字节，
v2显式关闭SQLite备份连接；首次ready SHA`2bcd4d12…`。这不是M6一致性封存。
真实页面重载后只开启方法观察器，按同M身份及O/y执行P/z/O/y四键，实际停留603/612/611/604ms；
4样本complete、9边界available，每次恢复exact且无冲突。replace包含时间104.7/82.7/82.3/86.0ms，
等于已记录区间union；history组union38.1/38.1/37.6/41.1ms，13次graph.serialize单次8.4–10.2ms均嵌套其中，不能相加。
这些是同步方法包络，既有身份检查扰动未扣除，不是CPU自耗时、输入延迟或100ms通过。

方法原始报告`M-input-replace-stages-41a8-first-raw.json` SHA`b5d0bfec…`，
独审`.local/validation/input-replace-stages-41a8-independent-review.json` SHA`e7882a12…`。
五项准备首错包括重载读取超时、重叠面板、选择器失配，全部保留；前控结束至首动作41.117秒空隙明确记录，不能充作CPU基线。
最终原生保存件仍与旧O/y文件逐字相同`83759b4c…`；8965四实例另存件`53507064…`保留原4个ID、2条连线及四份widgets_values。

### e9ea候选部署与四实例复验

代码提交`cd0cff8ed1de83c8a3d62c6494b7aa2da049cd4c`，构建`e9ea44f50e332962bae419775d0aae5e338f616b493442bda2e8135b225fe6e8`。
单格状态刷新只在内建generic/no-prompt_config明确恒空状态、编辑器私有content-cell路径及结构/配置/DOM身份不变时处理目标行；
未知或全表依赖、结构配置变化、派生和异步结果保持原全刷新。没有新增MutationObserver或状态值缓存。
真实编辑器机制测试从500行/5000格状态扫描降为0行查询/10格访问，未据此换算毫秒收益；整表快照、历史和revision观察仍在。
共享base-select保留原生主位置和已有候选，另加全横向区域候选；是否解决实际裁切仍待同边界复验。

完整检查首轮291通过/3跳过、业务421通过，212构建文件、142架构模块；方法观察器另有34项相关检查通过。
固定Git产品517文件SHA`09f2f04204fdc31373a858d29fc2d2fb11e857b9ffcdeac9bd729fce36d467c9`，
交接`.local/validation/row-state-picker-combined-check/combined-handoff.json` SHA`bf6107ee…`。
8237与干净8247按固定Git产品分别首次刷新成功，517产品文件及16个产品served响应一致；8237另核19文件测试夹具及3个served脚本。
刷新保留原生保存工作流和SQLite备份，ready SHA分别为`9f866dc0…`和`16ffa306…`；这些仍不是M6一致性封存或浏览器模块执行证明。
精确`cd0cff8`的PR/push CI `40181227559` / `40181223893`均completed/success。
旧测试页保存并关闭后，新8237页面仍实测DPR1.1、1745×982；工具快捷键未恢复登记的1920×1080/DPR1条件，正式50键尚未开始。
新页首次读取/原始夹具加载后的读取超时均保留；不重复发加载、不把工具超时当作产品加载计时。
原始M已通过原生文件选择加载并另存为本轮独立文件：300节点身份、400条完整连线、10000个表格值与原79ecd一致，仍为原始中文值。
初始保存件`d2efa268…`与此前41a8初始保存逐字节相同；原始夹具至宿主保存表示的slot metadata变化另记，不称原slot JSON逐字节等价。
用户手动复位后，性能页又实测DPR1.71、1123×631，显示请求一度queued；后续工具快捷键未恢复条件。
正式计划未冻结、正式输入0，所有准备原件在`M-table-semantic-e9ea-*`，不能用缺失数据宣称预算通过。

另一个干净8247页面63的四实例主矩阵实际DPR1，三视口×三倍率×四owner共36组焦点、36次Tab、36次反向Tab及36组菜单均已采集。
108阶段记录/216端点的正文、归属、connected、选区6/6、四peer和固定控件位置一致，停留1112–1151ms，根滚动均0。
全部36个Tab目标在根视口内；35个反向Tab目标完整包含，680×720/150% A返回目标宽837.16px、left74/right911.16，按已登记超宽左侧显露记录，不能称整个控件可见。
初始编辑态680×720/100% A、150% A/B共3处右侧局部越界仍保留；当前6位caret可见，不推定尾部或完整内容可见。
焦点独审`e9ea-focus-tab-back-independent-review.json` SHA`4e15602c…`核验108图hash/真实JPEG尺寸，实际逐图查看30张关键图，未声称已看其他78图。
后续独立报告`e9ea-focus-remaining-visual-review.json` SHA`2777bd91…`实际逐张查看其余78图，两集合互斥补齐108张。
未见新增完全不可见目标；1280×720/100% A的Tab单元格底部被固定快捷键提示条局部遮挡，标签/checkbox仍可见，不能称整个焦点轮廓无遮挡。
50%细光标和单帧闪烁仍有视觉不确定性，不用DOM选区替代像素判断。原始报告/全部图片未改。

36张实际展开菜单均逐图检查：18个表格对话框、18个原生LLM列表未见菜单边界/选项文字被视口裁切，图片尺寸与实际viewport一致。
每次即刻DOM→无输入停留1112–1155ms→稳定DOM/截图→Escape→关闭/peer核验均保留。
表格dialog没有内置owner属性，关联依据真实操作路由和唯一COMPOSER-A/B内容，不伪造直接owner字段。
菜单独审`e9ea-menu-visual36-independent-review.json` SHA`94e174de…`；348份主矩阵原件清单`e9ea-mainmatrix-raw-manifest.json` SHA`459d7feb…`。
这是DPR1主矩阵结果，不能追溯填补8965提前截图缺口，也不证明DPR1.1、部分屏外anchor的旧左侧裁切已按同条件修复。

尾部检查另存`prompt-llm-e9ea-tail-functional/`，不改冻结主矩阵。A/B End光标实测在视口内，正文与owner保持。
B平移前后world x相差24px，停留10秒后仍编辑原单元格。A首次意图24px但实际16px；另次补充实际36px，期间DPR由1变为约1，原因未建立。
两次A偏差均保留，不称A的24px协议通过；Home首个即时屏外读数和后续独立稳定可见记录也分别保留。
尾部独审SHA`66e5873e…`已实际查看五张680×720原图，13原件清单SHA`2695234f…`；主矩阵348文件重哈希仍一致。
A补充退出的两次DOM读取相隔约10ms且几何改变，只保留即时观察，不据此作稳定Tab通过或失败结论。
用户Esc停止期间没有继续界面采样，之后用户明确允许恢复。模式切换、编辑历史、保存重载/App、原生表间连线专项、真实IME和正式性能仍待完成。
M6未通过，不发布。

### 7f7196后续候选：无设置条时避免整表扫描

代码`085084f19f8a321be73a704731242eee651b6744`，build`7f7196fb5420dbb28986c0206d823f74d752f373523778b0bff4d3a36c13926c`。
generation panel只有在当前无生成列且该实例从未创建设置条时跳过row map和全TD扫描，仍先调用onRefresh并清理header。
曾创建过bar的实例始终保持原扫描，保留删列和分离后重插入cell的WeakMap清理。
同M真实editor机制首红中为500行映射/5000格扫描，修复为0；这只是回调遍历计数，没有换算实际延迟。
首轮完整检查291通过/3跳过、业务426通过，517产品文件`b14dee40…`，交接SHA`7ab0213c…`。
已推送草稿分支但未部署，e9ea主矩阵不替代此候选的受影响实际复验。全部旧失败与100ms门禁不变。

### 07c934输入链候选：资格扫描与同值文字赋值

在085084f之后合并两个限定变化：对已规范化且无生成列的表，私有syncFrameTags和syncPromptChanges入口只检查字段描述后返回；
不再先执行没有后续业务作用的prompt-column资格扫描。未知外层/字段形状回原路，公开model API与配置表的同步保持原行为。
updateSummary的两个按钮和普通状态文字在实际textContent相同时不赋值；选中行计算、禁用/隐藏状态以及配置表的问题定位控件仍按原路径更新。
只有parseButton位于generation childList观察范围内，不能把三次setter都称为三个实际观察器回调。

同M机制首红分别测得refresh及pre-save入口各5010次字段值读取，新候选均为0；同值summary的3次setter变为0。
真实editor/document/input链与有界DOM替身回归覆盖两owner、历史、配置帧同步、删列/重插清理和外部文字变化；不是浏览器布局、CPU或延迟测试。
首次测试替身递归遍历中止、后续替身修正和有效首红日志都保留在`.local/validation/generation-input-empty-chain/`。
72项相关检查通过；单次完整检查291通过/3跳过、业务430通过，142模块/212构建文件，日志SHA`b7797b47…`。
提交`3afdf061baa902087ed84e7d788bfaf9a94fb3c6`，构建`07c9345536f526b4da004de8ee4d92271c266f89923d8b2cef111eb04ba258aa`，517产品文件SHA`4ca9959998021646ff6917b22d3122733b917805fd31cca89ed9d58b3caacb2d`。
独审SHA`5dd75b05…`、完整交接SHA`66887f51…`。上述构建交接时未部署、未执行新的正式50键；后续实际结果见下文，不从旧replace时间中扣除估算收益。
Canvas全卡同步、历史快照/序列化、引用revision等剩余路径没有足够等价证明，因此本候选未跳过这些行为。M6与发布门禁不变。
固定Git归档SHA`73c30d62…`与517文件完整manifest逐项相等，归档准备handoff SHA`bfd50bfc…`；原e9ea包未变。
下一次正式采样优先最新07c934，e9ea保持未冻结/0正式输入/未执行，全部前态、首错和计划保留；原M、834d、50动作、100ms和环境合同不放宽。
此决策独立记录SHA`68913f64…`，不把准备文件当作实际运行证据。

### 07c934实际矩阵、尾部与历史失败

8237和干净8247已部署固定`3afdf061baa902087ed84e7d788bfaf9a94fb3c6`，构建`07c9345536f526b4da004de8ee4d92271c266f89923d8b2cef111eb04ba258aa`，
517产品文件包`4ca9959998021646ff6917b22d3122733b917805fd31cca89ed9d58b3caacb2d`；8237测试夹具仍为3663/19文件，语义观察器834d未改。
部署、291通过/3跳过及业务430通过均不构成产品或性能通过。

主矩阵`.local/performance-actual/prompt-llm-07c934-clean-matrix/`共349原件，清单`07c934-menu-independent-input-manifest.json` SHA`e740caa8…`已固定。
三视口×三倍率×四owner的36组焦点、Tab、反向Tab共108张原图均已逐图查看；216个DOM端点的owner、connected、正文、四peer和rootScroll=0一致，36组初始选区均为6/6。
稳定几何仍保留680/100% A、680/150% A/B三处编辑框部分越界，以及680/150% A反向Tab超宽控件仅左侧显露，不能声称整个输入框包含。
另在1280×720及680×720的100%/150%共4个A-Tab图中，固定键盘提示条覆盖任务2单元格下缘及部分焦点轮廓；标签仍可见，不称整个目标不可见。
collector没有hint rect，遮挡结论来自实际图审；50%细光标和闪烁仍有像素不确定性，不能用DOM选区替代视觉证明。
焦点独审`07c934-focus-tab-back-independent-review-v2.json` SHA`0df13bc0…`；提示条修正尚未部署或实际复验。

36张展开菜单原图也全部实际查看：18个表格composer、18个LLM选项列表未见菜单或选项文字被视口裁切，稳定/关闭/peer端点保留。
表格dialog没有直接owner字段，归属由操作前owner、唯一COMPOSER-A/B内容及关闭后的单元格身份共同支持。
菜单独审`07c934-menu-independent-review.json` SHA`66e4fe8a…`；截图capturedAt均为null，仅有275–357ms调用bracket，未补造精确拍摄时刻。
priority2要求第二项执行的680/150% A实际到第33项，另有collector角色/选区方向/内部滚动/可见性等缺项；`execution-deviations-first.json` SHA`4ee7f13d…`保留偏差。
这些记录不等于完整协议通过；手写build多一个字符的原注记及更正`3e72604e…`也分别保留，实际固定plan/安装身份未改。

尾部独审`07c934-tail-independent-review.json` SHA`db571718…`实际查看8图并核18个端点。
A/B的End、Home稳定caret均在根视口安全边界内，Home后Left仍为offset0，只覆盖起始边界no-op；超宽或部分越界的完整编辑框没有因此通过。
两实例手动平移后world和编辑框实测x均变化−24px，10028/10030ms后端点保持，正文、owner和选区不变。
A保持后的caret x50比画布左界x58更靠左8px，首字亦有裁切；B仍可见。这里证明手动导航端点保留，不能称A平移后caret持续可见，也没有后续按键重新显露的样本。

功能独审`07c934-edit-save-through17-independent-review.json` SHA`df276ffc…`核对两表编辑→原生Undo→Redo→Undo的正文端点，另一实例保持不变。
但两LLM首次Undo仍保留EDIT后缀，`08-after-history-saved-first.json` SHA`d9bb55d0…`也保存了这些后缀。
LLM A另次分段检查在编辑后1130ms稳定，再Undo并等待1203ms，DIAG后缀仍在；`11-LLMA-undo-failed-saved.json` SHA`3b071b35…`证实保存数据也未撤回。
后续显式恢复与Undo失败分开记录，不能算Undo修复或通过；不把端点结果推断成命令顺序或根因结论。
六份保存副本的table_data原字符串/解码值、节点ID/slots/links相同；13至15读到的文件逐字节相同`de607879…`，17原生重开四peer一致、标题clean。
这些副本相同不能证明各次Ctrl+S均成功；后续400独审及早读错位纠正见下，原件不改。
表格revision/stamp有明确变化，不能称全部properties回到原字节；本夹具未见其他静默字段删除，不代表未知schema专项覆盖。
本段实际环境为1097×617/DPR1.7500000521540642/100%，只作行为诊断，不替代登记的1920×1080功能条件；独审截至17，不扩展为后续模式、页面重载/App或全流程通过。

07c正式性能仍为0样本，未冻结正式计划、没有五轮raw。性能页初读DPR1.881，工具Reset后DPR1.1/1745×982，用户应用复位后DPR1.75/1097×617；均不符合1920×1080/DPR1。
准备独审`07c934-page-setup-audit.json` SHA`0db9f30e…`与后续`M-table-semantic-07c934-user-app-reset-followup.json` SHA`4e15f356…`分开保留，工具首错和中间变化不改写为产品性能数据。
原41a8正式FAILED、用户前台12键及读取时序ABA全部超100ms、a2da及更早失败保持有效；不宣称新候选解决100ms、真实IME或0/44已完成。M6未通过，不发布。

### 07c模式诊断补齐、保存400与历史v2定位

模式诊断目录`prompt-llm-07c934-mode-diagnostic/`冻结71份原件，清单SHA`15cd74241a84eb3bcd38b99d97740110631d5835f25d084c414612e472f90832`。
独审实际查看17张JPEG，并核16个DOM状态和15份保存副本；四owner的Mute/Bypass及Active恢复操作已有证据，两LLM另以原生Ctrl+B补齐4→0。
12个纠正后的延迟读取步骤均符合目标模式，全部保存副本的节点字段除目标mode外、table_data原字符串、LLM属性、槽位及连线与此前22号副本精确相同。
A首次Bypass/Active的两个副本与当时UI错位，不能算干净的即时保存检查；两LLM原生菜单缺Bypass未被快捷键补测消除。
最终25号原生重开四卡Active，但标题仍带星号，没有新的重开后干净保存证明。05恢复后的旧错误提示仍可见，不与新文件状态混淆。
该轮实际1097×617/DPR1.75，起初100%后fit约29%；不是登记的三视口/倍率验收，也未提交生成。
独审`07c934-mode-diagnostic-final-independent-review.json` SHA`d5b122fbacdf1d321347f36ce14d37b0114c7664a174fc7d73239ca2805bc7e6`。

保存400独审确认，宿主`user_manager.py`写临时文件后调用`os.replace`时返回WinError5 Access denied，随后被统一映射为“Invalid filename”400。
这不证明文件名非法、某个特定进程持锁或所有先前保存失败。首次01副本仍是Active，02副本已是前一Bypass；紧随异步保存立即读取可能参与竞态，但没有句柄证据建立原因。
05/08/11/13四份不同内容支持相应状态已落盘；14/15/22均与13字节相同，只证明读取时文件稳定，不能据此宣布三次独立写入成功。
重开、reload和App返回的DOM是可见状态端点，不补造HTTP200回执；原LLMA稳定Undo失败及11号不同保存件仍有效。
独审`07c934-save400-investigation-first/review.json` SHA`be82327b3bc77e4ae35d60bb9a722d42cc0c12dd168f8405a276adf83c674711`；原日志、错位副本和早先报告全部保留。

独立8250测试宿主的history v2仅作行为定位：原始记录有860个顺序快照、32个事件、19个状态转换，未包装原生方法。
Ctrl+Z前唯一undo尾部含原始instruction，当前值含完整后缀；随后，已blur的LLMA textarea收到可信`historyUndo`输入，先去掉末尾一个字母并新增第二个undo条目。
之后节点token改变，完整后缀恢复，而短一字状态进入redo；从该恢复状态的采样端点至停止，导出状态不再变化。
这与图撤销撤回刚新增的文字历史事务一致，不支持“起初保存了错误快照”的解释；未采到“先恢复原文再被后缀覆写”的状态，也不能排除采样间的瞬态。
原生Undo调用次数、beforeinput的cancelable/defaultPrevented边界均未观测；全部restoringState=false不等于没有恢复执行。
顺序读数非原子快照，观察器自身有调度扰动，不提供性能结论。其余三个owner的已导出投影稳定，但raw没有完整表格行值，不能扩大成全数据相等。
该轮同样1097×617/DPR1.75；诊断未修产品，也不清除原Undo失败。
原始`08-raw-history-first.json` SHA`546d40a146d7c95dcdddadd8b41567887e6b14e7467871db286e05bfb919ea66`，
独审`llm-history-observer-07c934-v2-first-independent-analysis.json` SHA`5416fc36222d26e8a374f279fee6bc30b9d1fcbcecc1a52219e4b80435156e86`。
最终11份原件冻结附录SHA`30c56a9deb22458535766f3ec822ca4be11a5f570d4a8d9a7b9bdf85b78104e8`保留后续图/DOM：图中可见DIAG后缀，但提示条覆盖部分正文，完整文字以该次DOM为限，标题仍带星号。

### 两个后续源码候选：尚未构建或实际复验

固定提示条避让仅补充可信Tab目标的可见区域，普通caret/input路径没有新增提示条几何读取；状态错误没有被隐藏。
旧源首红保留，46项定向检查和单模块严格类型检查通过，两份独立源码审查无阻断；实际4个遮挡端点仍待复验。
交接`canvas-status-hint-focus-reveal/handoff.json` SHA`3fb1d22cbeec21df40fdb4f114bedfa8a83785f1984ae6128199fe5a2db0f5e9`。

never-requested观察候选仅修改私有提示词编辑器：保留初始化observe；首次任一begin尝试前，跳过后续被动请求扫描；两个begin均先单调置位，之后永久保持原完整观察。
它不等同于“所有idle都可跳过”，不跳渲染、OptimizationRevisions或公共请求校验；完成、失败、比较弹框留存、关闭后均不复位。
旧源8项中7过1红，修后8项及相关回归共36/36；真实owning editor的两张500×10表验证写回/历史保留，并覆盖首请求当前基线、ABA、删除重插、比较、侧栏第二入口及延迟返回。
这些使用有界DOM替身，仅证明机制和请求生命周期；没有浏览器布局或实际输入耗时收益证据。
交接`prompt-never-requested-observation/handoff.json` SHA`e847b2c4ad4ece3b262a14e3a58ded74ac6ae98854b8f1337ed997a1b8f9ec02`。
独立源码审查`migration-inventory-independent-review.json` SHA`6a79414659f9bc8bda1b1626b2be3f8b139d331c0da6cd465fa41c4e5d760768`未发现阻断，不替代实际复验。
记录当时两候选均未生成新web或部署；07c正式性能0样本，旧41a8及更早失败、真实IME、真实推理0/44、M6未通过和不发布门禁不变。

### 457995合并源码候选

提示条避让与never-requested请求观察已与LLM失焦历史输入保护合并，构建`457995bd47edbfc7b822fe9ee4770bded712042c61522202f3402f4f7f4739c1`。
LLM原文/处理要求的绑定只取消仍有效、已失焦、连接中且可编辑字段的可取消historyUndo/historyRedo；聚焦文本、组合输入、只读/禁用及失效字段沿用原行为，不额外调用宿主撤销。
新只读isCurrent查询不序列化图；默认共享字段合同不变。guard首红1通过/4失败保留，相关25项及独立复核通过，真实浏览器可取消性仍待验。
一次完整npm检查主测试299通过/3跳过、业务443通过，143模块/213构建产物，冻结源码未变化；完整日志SHA`3869debd5a0cbe17ea95238c358130ab481bb4c518e4ec684665217288ad2978`。
记录该次构建时尚未部署；后续8250部署与实测见下一节，不能继承07c的界面结果或推断100ms收益。Chrome另开8247首次返回403，隔离服务health读取200；根因及真实IME未证实。
07c失败现场已通过原生另存保存，工作流副本SHA`c97c75554e8f8ba1aebb88e0189b6d72f9ee912b913fba8d62defb1d4648a55a`，原始history目录11份记录仍冻结。
所有既有失败、正式性能环境门槛、本地推理0/44、M6未通过和不发布要求不变。

### 457995部署及LLM分组诊断：首轮仍失败

固定提交`b1040310af3f648d30abe6c721c9a1700784a3d2`仅刷新8250，519产品文件包SHA`d3203df9d7225cd130ea45bc4c494497387e81771a780a81e23363ce9e92d712`，v3观察器4文件SHA`474522f4772e4621d3decdd5be2aa9ff7d53bb5a8c378a1a5ac4898e3961195f`。
旧产品、夹具、保存工作流与关闭后的SQLite备份保留；独审核对安装字节、CPU/offline启动参数及served文件，queue0仅为点时读数。8237/8247未刷新。

首轮731×411/DPR2.625的LLMA输入后形成两条事务，首次空格与后续字符分开；原生Undo只撤回后者，残留一个空格。
该状态采样保持约39.5秒，未继续Redo，原始`llm-history-457995-first/10-A-raw-first.json` SHA`43023f5d2ded56d375f8aabc8bce5b78a674f3ed2e614e1b1b574f09ab1d6613`，11份原件冻结。
取消边界已有cancelable=true的beforeinput historyUndo，之后未记录input historyUndo；旧版“失焦文字事务再被图撤销恢复后缀”的序列未重现。
capture阶段微任务记录的defaultPreventedAfterDispatch=false不能证明target保护无效，也没有直接记录保护函数调用次数。

恢复到1097×617/DPR1.75后的A/B分别输入一个后缀，均仅新增一个事务，原生Undo→Redo→Undo的正文正确，另一实例的导出投影不变。
A原始SHA`2fef2c08e76856b6066742f2164ddeddbfd3a8a84e2fc010d393f5c345d97e20`；B原始SHA`8e2b5b6794b2832872c98232a825158f284a954e743c44b83d105772865f4a8a`。
两轮初始均已有undo1/redo1，不能称重新打开原件清空了历史；A首次Undo至Redo前采样保持约21.2秒，B最终Undo后约30.1秒。
原生另存件的四节点widgets_values、inputs/outputs及两连线精确保留。完整JSON另有Canvas viewport x/y及Table A首行优化stamp/revision四叶变化：夹具中旧stamp缺少已存在的SAVE-F6-A，保存时revision1→2。
这是业务元数据变化，未被抹除或归为纯导航；没有本轮保存后再次原生重开的通过证据。
zoom100派生文件的原始字节身份与底层四节点夹具SHA`2eabe9d8…`分开记录，后者不是该派生文件的字节哈希。

新源码候选修正历史比较与导航合同的不一致：只对已知v1、有限合法viewport的x/y/zoom作比较投影，原生保存仍保留视角；未知字段、布局、业务revision与另一实例的修改仍切断分组。
首红8通过/4失败保留，最终13新增及相关测试30/30、定向严格检查通过。实现只有一次stringify和四层descriptor浅拷贝，没有整图parse/深拷贝或新缓存；宿主全图serialize开销仍在。
这不能证明首次分组由导航引起，原raw未记录比较stamp；Table A派生revision也是候选干扰因素。实际窄视口失败仍未关闭。
独审通过后一次完整检查exit0，冻结输入在运行中未变；主测试299通过/3跳过、业务456通过，144模块/214产物。
构建`590a1e7c5b9d3294c2b704df521672eecf646f8eb1307625c8e1c42169cabb97`，完整日志SHA`7a2496f3ef7676d54bbd7ef7795825a113bed26b069019532432ae3ed31f9498`；构建完成尚不等于部署或实际复验。

旧07c方法诊断计划保留原M、九个方法边界与P/z/O/y四键；当前页实际997×561/DPR1.925，不用于100ms正式验收。
在原页reload后读取状态超时，独立恢复页同样超时；恢复页可取得截图，四实例8250页仍可读取，因此不把工具超时直接归因为产品耗时或服务故障。
原生打开M、Start及四键均未执行，raw尚未产生；控制失败记录和恢复图保留于`M-input-replace-stages-07c934-dpr-diagnostic-*`。
既有失败、真实IME、正式1920×1080/DPR1性能门槛、本地推理0/44和M6不发布要求继续保留。
