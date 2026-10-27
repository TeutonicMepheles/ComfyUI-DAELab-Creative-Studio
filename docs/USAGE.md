# 首次使用

完成 [安装](INSTALLATION.md) 后，先使用合成 Showcase 检查编辑流程。它是原生可编辑工作流，演示数据不代表模型执行结果。

1. 在仓库根执行 `./Showcase/Install-ShowcaseAssets.ps1 -InputDirectory '你的独立 ComfyUI/input'`，将公开合成素材复制到指定环境。脚本遇到不同内容的同名文件会停止。
2. 在浏览器按 Ctrl+O 打开 [Showcase JSON](../Showcase/Creative-Studio-Showcase.json)，进入创作画布。点击“适应”查看布局；中键平移，Ctrl+滚轮缩放。
3. 在 A/B 两张表分别编辑文字，检查素材顺序、提示词引用与生成配置。单格可以追加多个素材；列 Slot 是一次填充，普通原生 Slot 保留真实连接关系。
4. Ctrl+S 原生保存后刷新重开，核对两表内容。工作流保存编辑输入；运行任务事实保存在宿主的 Studio 数据库，不能用工作流 JSON 代替任务备份。

完整逐项清单见 [Showcase](../Showcase/README.md)。日常顺序可从素材/文稿导入、表格和提示词编辑，继续到生成结果复用、剪辑导出。生成前先按 [模型配置](MODELS.md) 确认可用能力；未连接服务时保留配置，不视为任务成功。

开发者无需 ComfyUI 即可运行 `npm run dev:table` 检查真实表格组件；该页面的素材和生成结果均为合成模拟，内存保存随刷新清空。详见 [独立预览](../dev/table/README.md)。
