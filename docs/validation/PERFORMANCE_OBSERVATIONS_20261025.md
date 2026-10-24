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
不能算1280/680响应式矩阵通过。窄屏实际布局、溢出与焦点仍等待根代理补测，原36条不改写。
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
