# 业务节点宿主适配

把表格、分镜、文稿、LLM 和独立生成功能绑定到原生节点、widget、编辑历史和公开画布适配器。

源码入口：business_bootstrap.js：端口装配；business_document_host.ts：原生文档绑定；data_table_nodes.mjs、table_serializer.ts：表格；video_generate.js：生成节点唯一面板所有者；dynamic_widget_lifecycle.mjs：动态控件清理。

协作边界：原生图负责编辑数据；业务面板必须取得文档绑定和稳定身份。正式生成入口为 video_generate.js，旧重复 libtv_panel.js 已移除。

`table_column_targets.ts` 为普通表与剧本解析表共享列输入描述符，Slot 外观和定位由画布统一投影。解析表仅接收已有列类型允许的素材，通过原编辑器执行 `fillMaterialColumn`。新导入以四列初始化，源表分别保留章节身份；明确章节不按 10 行切开，无章节源表分别按 10 行分页。导入后的表格沿用普通编辑和输出能力。

生成面板由 `workflow_node_lifecycle.ts` 合并安装请求：原生工作流加载及历史恢复完成后再安装，按当前图和节点身份丢弃过期请求；加载期间停止自动输入同步。真正缺少历史方法时仍由历史桥可见拒绝编辑。

生成面板在线路变更完成后同步输入；创作画布通过适配器 `refresh` 继续同步表格内容，不依赖原生画布绘制。

文本节点在原生 `onConfigure` 载入数据后重建面板与文档绑定，撤销配置前的票据并清理旧 DOM widget。这样 `onAdded` 提前安装的空面板不会阻止已保存批量结果确认；输入签名、当前工作流与文档票据仍需匹配。

云端提交通过 `comfy_submission_auth.ts` 获取当前 ComfyUI 工作区凭据；凭据仅放入请求头，不进入工作流或任务数据。本地生成不读取云端凭据。

`comfy_pricing.ts` 读取已安装官方节点的 `price_badge`，用本地 JSONata 计算当前参数和参考素材的预计积分。复用官方公式和默认值，不保存价格、不发起计费请求。定向检查：`tests/migrated_business/comfy_pricing.test.mjs`。

创作画布中多维表格与剧本解析表的输出仅可新建并连接图片生成、视频生成节点；拉线新建菜单将其他类型置灰，拖向已有节点也遵守同一限制。已有工作流连线保留。

表格列头末尾的“＋”接收素材连线，按内容新建图片／视频列或文本列，从首行按组内顺序填充，行数不足时补行；单个内容仅填首格。混合组分列填入。使用现有可撤销的快照填充，不创建持续同步的隐藏输入。

多维表格的原生 `source_table` 仅接受表格输出。恢复旧工作流时断开误接的文本等非表格来源，保留本地表格内容及有效表格连接，避免隐藏旧连线阻塞生成节点读取。

本目录的可编辑源位于 `frontend/src/integrations/comfyui/business/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/business_entrypoints.test.mjs tests/migrated_business/generation_entrypoints.test.mjs tests/migrated_business/table_widget_serializer.test.mjs tests/migrated_business/dynamic_widget_lifecycle.test.mjs
```


`generation_output_nodes.ts` 负责生成请求的自动占位、真实来源连线、状态回填与输出组排序。创建归入提交编辑，回执投影经宿主历史合并；轮询只更新已存在且仍连接原来源的目标。行为与验证见 [生成模块](../../../features/generation/README.md#自动输出素材)。
