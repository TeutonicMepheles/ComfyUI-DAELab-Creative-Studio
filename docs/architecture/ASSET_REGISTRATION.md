# 输入资产登记合同

资产目录使用现有 `AssetCatalog` 和同一产品 SQLite。输入登记与收藏分开：登记不会
创建收藏或更改收藏墓碑。浏览器仍只编辑原生工作流中的 `asset_data`、文本 widget 和
素材组数据；服务返回的资产身份、引用与哈希是派生元数据，不是第二份可写文本。

`AssetLibraryPort.register(input)` 对应同源 POST
`/daelab/studio/asset-library/register`。输入沿用 `FavoriteInput` 的文本或本地文件形状，
可另附 `source`（operation、documentId、nodeId、tableId、recordId、fieldId、requestId、
occurrenceId、sourceAssetId、sourceReferenceId）。后端验证来源字段、根内相对路径、
文件完整 SHA-256 和大小，按内容幂等登记，返回 `schemaVersion:1` 与 `registration`。
回执包含 assetId、contentSha256、byteSize、kind、status；文件另含 referenceId 和带
同一身份字段的精确 `asset` 引用。只读 `sources` 投影来自服务保存的来源记录。
客户端已有身份只作校验断言，内容改变时不能静默采用旧身份。

`resolve({assetId,referenceId})` 对应同源 POST `/resolve`，重新验证引用归属及当前文件
完整性。文本只需要 assetId。公开文件合同继续限定 input/output；temp 不因这个接口
自动成为可持久保存或可收藏的引用。临时生成/导出资产的冻结仍由现有对应服务负责。

上传先由宿主写入新文件，再登记。两步成功且节点、工作流、上传 epoch、原 widget 和
模式仍匹配，才以一次原生历史事务替换 `asset_data`。登记失败不清除原 widget，也不
删除用户原文件；可能留下未引用的新上传文件，应由明确的后续清理流程处理。原有
`id` 继续代表素材出现实例，独立保留服务的 assetId/referenceId/hash/size。收藏加入
画布同样登记/校验精确引用并保留这些字段，不能用同内容的另一条路径替换本次来源。

文本只在 textarea 的明确 change 提交或显式消费/收藏时登记不可变快照。每次 input
仅编辑原 widget、失效待完成登记并清除过期元数据，不发送请求；onConfigure/reload
也不发送请求或开启历史事务。change 的异步回执复核当前文字、来源、节点生命周期，
只通过历史派生修改写 `properties.studioTextAsset`（identity/hash/size），永不回写
文本。过期回执可保留在后端目录，但不得写回当前工作流。原生执行的 TextInput 也按
实际消费 STRING 登记；输出文本与槽位保持不变。

组序列化附加有序 texts/textSources；执行登记文本快照与媒体引用，保留素材实例、
成员顺序及未知原字段。未就绪来源允许保存原工作流，但拒绝消费。素材输出服务由
组装层注入相同目录，保留原文件路径、素材出现 ID 和已有 provenance，并登记可识别
的行/字段/请求来源。

组装需在两处传入同一对象：

```python
canvas_nodes.register_nodes(asset_catalog=services.assets)
canvas_nodes.register_routes(server, export_service=exports, asset_catalog=services.assets)
```

未注入目录不妨碍导入、节点 schema 或查看旧工作流；素材消费会明确失败。模块导入
不创建目录、数据库、路由、模型或任务。现有 ExportService 的冲突预检/显式绑定顺序
保持不变。实际两实例、上传/文本/编组、保存重开及故障视觉验收由宿主测试记录承担；
纯契约测试不能代替这些验收。
