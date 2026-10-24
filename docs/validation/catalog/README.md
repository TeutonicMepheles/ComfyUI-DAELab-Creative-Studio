# 执行追踪与证据合同

本目录只记录规格、任务和验收合同。生成文件初始全部为 `not-executed`，没有任何产品通过证据。工具自身的测试通过不能代替 ComfyUI、真实推理、性能、迁移或发布验收。

`traceability.json` 从四份权威 catalog 生成：118 F、260 AC、41 UC、131 TC、七类 EV。32 个任务按阶段与唯一负责模块合并；同一功能只归属一个任务，其他模块通过原始 `target` 合作。跨模块要求关联同一负责模块，不能再为同一实现另建账本、资产目录或控制器。

`acceptance_ids` 存在原始功能记录中。插入、重排要求时一同保留既有 ID；新要求追加未使用 ID，不能重新编号。每个 TC 的 `specificationHash` 同时包含 TC、关联 AC 的 ID/文字、关联 UC、测试策略和证据 schema；本地真实测试还包含 Eval 排程与批次 schema。修改这些条件会使旧证据失效，不能仅因 TC 本体未变而继续沿用。AC→TC 表示规格中的覆盖关系；执行结果只通过具体 assertion 证明实际断言，不因某一相关 TC 通过而自动宣称整个 F 完成。

```powershell
node docs/migration-blueprint/render_catalog.mjs --check
node tools/evals/traceability.mjs --check
node tools/evals/traceability.mjs --select --phase M3 --changed frontend/src/features/table/panel.ts
node --test tests/contract/test_eval_traceability.mjs
```

选择器列出 `TC.phase <= 当前阶段` 的全部 P0/P1，同时标注改动影响。未知路径保守标记全部当期用例需回归。未实现、缺宿主、缺模型及没有预算均不能被改成不适用。M6 累计全部 P0/P1。M0 没有分配产品 TC，工具返回 `baseline-review-required`，仍需人工核验真实样本、参考机、行为和来源，不能用空集合推断通过。

证据使用 `evidence.schema.json` 的严格字段。每次运行记录一个 TC，带 F/AC/UC/EV、版本与提交、完整环境、实际夹具和权重哈希、完整参数、任务身份、逐项断言、评分、输出、trace、偏差和缺陷。原始参数必须脱敏；禁止凭据字段。真实宿主通过还要求公共 UI 矩阵，真实模型通过要求本地白名单、采样执行证明、非缓存/非账本复用和盲评记录。具体 44 次排程与比较条件见 `local-eval-plan.json`，一次推理不能替代整批验收。

```powershell
# 原始文件在忽略目录；这些命令不会提交模型或修改宿主。
node tools/evals/traceability.mjs --record .local/prepared-run.json --evidence-dir .local/evidence
node tools/evals/traceability.mjs --gate --phase M1 --fingerprint .local/current-fingerprint.json --evidence-dir .local/evidence
```

指纹文件必须提供 `implementation`、`environment`、`fixtures`、`configuration` 四个 SHA-256；工具按当前 TC 自动计算第五项 `specification`。阶段执行者应从实际代码/构建资产清单、完整环境清单、夹具清单和执行配置计算并冻结这四项，不能自行填写稳定常量来维持旧证据。有关实现、环境、夹具、配置或规格变化均使对应证据为 `stale`。普通提交可用完整产品树/构建摘要作实现指纹；若使用按 TC 影响集摘要，影响清单本身须版本化。

`--record` 采用排他创建，不覆盖同名运行；每个输出和 trace 在记录及 gate 时验证真实文件 SHA-256。通过记录的逐项断言、网络审计和采样 trace 都必须指向该哈希清单中的真实文件。失败、追加比较和后续成功均保留。相同指纹下按 ISO 时间转换后的真实时刻选择最后一条执行；时刻相同时失败优先。后来的失败会阻塞早先通过；新指纹下旧证据保留并标 stale。不适用必须有真实范围理由与审阅人记录。门禁失败返回非零退出码。

通过 `provider-live` 用例必须提供 `localBatchArtifact`，指向已记录哈希的 JSON 报告，并满足 `local-batch.schema.json`。报告包含10个固定样例全部44次独立推理，或两版都配置相同 LoRA 时的50次；20次成对冒烟必须先完成且计入总数。每次关联唯一执行/request/provider-task/attempt 身份、完整请求、实际权重/预处理图片哈希、采样证明、输出属性和分段耗时/峰值内存。独立文本与图片反推沿用8192上下文/768输出；表内入口沿用16384上下文及原快照的32–1024输出预算。两版展开请求只自动忽略 `runId` 和 `outputPrefix`，其他实际差异必须逐路径记录说明及审阅人。有效参数和实际权重不允许改变。

盲评记录用 `executionId` 对应每次输出，并绑定报告中的盲标签；所有适用维度必须完整。工具计算关键维度中位数、可用阈值、非关键下降、总体均分与匹配冷热状态下的耗时/峰值内存门槛，不自行生成视觉或语义评分。恢复记录必须保持原身份且新增采样次数为零。额外争议比较尚未接入批次报告合同，不能把它混入已登记44/50次或挑选替换结果；出现争议保持阻塞，先完成显式预登记合同扩展及其审查。失败运行及后续比较仍须以不可覆盖记录保留。

七类 Eval：

| EV | 证据职责 |
| --- | --- |
| EV-ARCH | 依赖、端口、节点目录、资源与版本合同 |
| EV-UI | 两实例、模式、焦点溢出、保存重载、缩放视口、IME 与销毁 |
| EV-DATA | 身份、引用、事务、未知字段、迁移与回滚 |
| EV-JOBS | 持久账本、幂等、恢复、资源调度、零云调用 |
| EV-PERF | PERF-01～08 原始五次数据、长时与资源释放 |
| EV-LOCAL | 指定本地 Qwen/H3 的请求一致、真实执行、盲评与模型性能 |
| EV-E2E | 单包安装、完整创作流程、迁移切换与发布 |

工具验证结构、记录完整性和已采集数值的阈值，不执行模型、媒体解码或人工评审；这些必须由真实执行器与人工作业产生原始证据。不得将门禁的合成测试数据用于产品通过记录。发布仅复制脱敏报告及可公开合成夹具；本地原始日志、私有工作流、媒体、权重和凭据不能进入公开仓库。
