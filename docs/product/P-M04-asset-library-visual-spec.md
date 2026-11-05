# 资产库视觉规范 v1（shadcn 视觉语言 · 只借规范，不引组件）

2026-11-05，产品侧（Golajah-Product-Designer）。触发：用户 b5294a2f 提出「接入 shadcn 样式/组件库」，
用户于 07:06 确认走「只借用视觉规范」路径。本稿把 shadcn 的视觉语言翻译成现有 `--dae-*` 变量体系可表达的
规则，**不引入 React / Tailwind / Radix，不装依赖，不动后端**。范围先锁资产库这一屏。

## 结论

shadcn 的「视觉语言」可完整用现有主题变量表达，不需要换栈。它与当前界面的本质差异只有三点：

1. **圆角**：胶囊（999px）→ 矩形（6–8px）；
2. **选中态**：蓝色容器块（`--dae-primary-container`）→ 中性表面 + 前景；
3. **层级表达**：靠中性 surface/muted/border 分层与明确的区域标题，而不是靠彩色块和大胶囊。

真正「丑」的部分——旧收藏导入区占一整行、筛选/面包屑/目录按钮都是大胶囊、目录卡片与素材卡片混作同类——
是形状、密度和层级问题，不是缺组件库。本轮只改样式与布局，不改功能逻辑与交互事件。

## 一、范围与硬边界

**改**：`.dae-library-drawer` 内的颜色、圆角、间距、控件尺寸、工具栏与目录布局。

**不改**：
- 功能逻辑、事件绑定、`folderId`/`parentId`、收藏/素材身份、后端目录服务；
- 资产库以外的任何屏（现有胶囊按钮、彩色选中态仍用于全产品其它位置）；
- 字号层级（沿用已确认的 15/14/12 基线，见 [TYPE_SCALE.md](TYPE_SCALE.md)）；
- 不新增依赖、不引入打包、不改构建链。

## 二、圆角（胶囊 → 矩形）

新增三个**增量变量**（不覆盖现有 `--dae-radius-*`，现有值继续服务全产品其它屏）：

| 新变量 | 值 | 用途 |
| --- | --- | --- |
| `--dae-radius-sm` | 6px | 输入框、筛选分段、目录行 |
| `--dae-radius-md` | 8px | 按钮、缩略图、文件夹卡、菜单项 |
| `--dae-radius-lg` | 12px | 抽屉、预览弹窗 |

资产库内映射：

| 控件 | 现值 | 目标 |
| --- | --- | --- |
| 筛选按钮 / 搜索输入 | 12px（胶囊几何由共享按钮覆盖）| `sm` 6px |
| 缩略图 `dae-library-thumb` | 12px | `md` 8px |
| 按钮（新建/分页/预览/加入画布）| 999px 胶囊 | `md` 8px |
| 文件夹卡 `folder-card` | 12px | `md` 8px |
| 目录树行 `folder-tree-row` | 12px | `sm` 6px |
| 抽屉 `dae-library-drawer` / 预览 `dialog` | 16/24px | `lg` 12px |

## 三、颜色层次

现有变量已是成体系的暗色中性（zinc 系），无需改色，只需把「选中态」从蓝色容器改回中性。shadcn 角色映射：

| shadcn 角色 | 沿用变量 | 值 | 资产库用途 |
| --- | --- | --- | --- |
| background | `--dae-bg-canvas` | #141414 | 画布底 |
| card / popover | `--dae-surface` | #222222 | 抽屉、预览弹窗 |
| muted | `--dae-surface-low` | #1c1c1c | 侧栏底、缩略图底、输入底 |
| secondary | `--dae-surface-raised` | #262626 | 次级按钮、选中分段、卡片 |
| accent（选中/激活）| `--dae-surface-high` | #303030 | 当前目录、选中项（替代 primary-container）|
| hover | `--dae-surface-hover` | #3a3a3a | 悬停 |
| foreground | `--dae-text` | #ededed | 正文 |
| muted-foreground | `--dae-text-muted` | #b5b5b5 | 辅助、计数、空态 |
| primary | `--dae-accent` + `--dae-text-on-accent` | #b8c4ff / #222e61 | 主操作填充 |
| border / input | `--dae-border` | #404040 | 分隔与输入描边 |
| ring / focus | `--dae-focus` | #b8c4ff | 焦点环 |
| destructive | `--dae-danger` | #ffb4ab | 错误、删除 |

核心改动——**选中态改中性**（不再用 `--dae-primary-container` 蓝块）：

| 控件 | 现状 | 目标 |
| --- | --- | --- |
| 类型筛选 `aria-pressed=true` | `primary-container` 蓝块 | `background:var(--dae-surface-raised)` + `color:var(--dae-text)` + `border:1px solid var(--dae-border)`；未选中透明 + `text-muted` |
| 目录树 `data-current=true` | `primary-container` 蓝块 | `background:var(--dae-surface-high)` + `color:var(--dae-text)` + 左侧 2px `var(--dae-accent)` 竖条；hover 用 `surface-hover` |
| 文件夹卡 `data-selected=true` | `primary-container` 蓝块 | 同上中性表面 + 2px `accent` 左边条 |
| 缩略图 `aria-pressed=true` | `accent` 2px 描边 | 保留（已正确），半径改 `md` |
| 收藏星标 `aria-pressed=true` | `accent` + `primary-container` 底 | 仅 `accent` 图标前景，透明/低背景，不用色块 |
| 主操作 `data-primary=true` | `accent` 填充 | 保留 `accent` 填充 + `text-on-accent`，半径改 `md` |

## 四、控件尺寸

沿用现有高度档，统一到矩形、去除胶囊几何：

| 控件 | 目标尺寸 |
| --- | --- |
| 默认按钮（新建/预览/加入画布/分页）| 36px（`--dae-control-height`）|
| 紧凑控件（筛选分段、搜索输入、面包屑段）| 32px（`--dae-control-height-compact`）|
| 图标按钮（收起/返回/删除/星标/切换目录）| 32×32，图标 18px |
| 目录树行 | 40px 行高，缩进 16px/级（沿用）|
| 文件夹卡 | 44px 高（图标前置，见布局节）|

现状问题：筛选按钮 `min-height:30px`、多处 28/30px 图标按钮不一致。本轮统一为 32px，矩形。

## 五、间距

沿用 4px 基数（`--dae-space-1..6`），资产库内具体取值：

- 抽屉 header：`12px 16px`（沿用）；tools：`0 16px 10px`（沿用）；
- 网格 `gap`：14px → **12px**，tile 之间与行距一致；
- 侧栏 padding：12px（沿用）；树缩进：16px/级（沿用）；
- 面包屑段间距：`gap 8px`（沿用）；文件夹卡区 `gap 10px`（沿用）。

## 六、工具栏与目录布局

当前 DOM 结构（`asset_library.mjs` + `asset_folders_panel.mjs`）自上而下为：

```
drawer
 ├─ header（标题 / 计数 / 关闭）
 ├─ importTools（旧收藏导入一行：导入按钮 + 旧服务地址 url + 文件导入）  ← 占整行的元凶
 └─ layout
     ├─ sidebar（目录树）
     └─ main
         ├─ tools（筛选 + 搜索 + 新建文件夹）
         ├─ path（面包屑）
         └─ content（folder-cards + grid）
```

目标结构调整为四层，**importTools 移出主流程**，目录与素材分区：

1. **头部行（固定）**：资产库标题（15/500）+ 计数（12 muted）+ 弹性空隙 + 「导入旧收藏」次级入口 + 收起。
   「导入旧收藏」把原 `importTools` 的三个操作（导入此浏览器旧收藏 / 旧服务地址 / 导入旧目录文件）收进一个入口，
   交互逻辑保留，展现方式由实现自定（下拉或行内展开），**不新增依赖**。
2. **工具栏行**：`[全部|图片|视频|文本]` 分段（32px 矩形）+ 搜索输入（32px，`sm` 圆角）+ 弹性空隙 + 新建文件夹（32px 次级按钮）。
3. **面包屑行**：返回按钮（32px 图标）+ `资产库 / 子目录` 路径段；段为紧凑矩形按钮，悬停 `surface-hover`。
4. **内容区（右，可滚动）**：
   - **文件夹区**（有子文件夹时）：区标题「文件夹」（12 muted）前缀，文件夹卡改为图标前置的紧凑行
     （文件夹图标 + 名称，高 44px，`md` 圆角，`border` + `surface-raised`），不用 16:10 媒体缩略图冒充目录。
   - **素材区**：区标题「素材」（12 muted）前缀，沿用现有 16:10 缩略图网格。

移动端（`max-width:700px`）保持单列目录/内容切换（沿用 `directory-toggle`），不新增溢出。

## 七、状态

| 状态 | 表现 |
| --- | --- |
| hover | `surface-hover` 背景；幽灵按钮前景提亮 |
| 选中/当前 | 中性 `surface-high` + `text`（+ 目录项 2px `accent` 左边条）|
| disabled | `opacity:.38`（沿用）|
| focus-visible | `outline: var(--dae-focus-width) solid var(--dae-focus)`，`offset 3px`（沿用）|
| error | `--dae-danger` 文本 + 输入处就位提示（沿用）|

选中/悬停/禁用均**不改变字号与字重**（沿用 TYPE_SCALE 原则）。

## 八、实施映射（选择器 → 目标）

| 现有选择器 | 目标 |
| --- | --- |
| `.dae-library-filters button` | 32px 矩形 `sm`；选中改 `surface-raised` + `text` + `border`，去掉 primary-container |
| `.dae-library-search` | 32px、`sm` 圆角、`surface-low` 底 + `border` |
| `.folder-tree-row[data-current=true]` | `surface-high` + `text` + 2px `accent` 左边条 |
| `.folder-card` | 高 44px 图标前置紧凑行，`md` 圆角，`surface-raised` + `border` |
| `.folder-card[data-selected=true]` | `surface-high` + `text` + 2px `accent` 左边条 |
| `.dae-library-thumb` | 半径 `md` 8px；选中保留 `accent` 2px 描边 |
| `.dae-asset-favorite[aria-pressed=true]` | 仅 `accent` 图标，透明底 |
| `[data-primary=true]` | `accent` 填充 + `text-on-accent`，`md` 圆角，36px |
| `.dae-library-remove` / `.dae-library-icon-only` | 32×32，`md` 圆角，透明底 |
| `.dae-library-grid` | gap 12px |

## 九、验收口径

- 逐项对照：筛选/搜索/新建/面包屑段为 32px 矩形；缩略图与卡片圆角 8px；抽屉/预览 12px。
- 选中态：目录当前行、文件夹选中卡、筛选激活段均为中性表面，无蓝色 `primary-container` 块。
- 层级：文件夹与素材有明确区标题且形态可分（图标前置 vs 媒体缩略图）。
- 旧收藏导入区不再占一整行，三个操作仍可从同一入口触达。
- 回归：进入/返回/面包屑/新建子目录/折叠/空目录/搜索/预览/加入画布功能不变；缩放、禁用、错误、焦点与可访问性不变。
- 前后对照截图：改前/改后同屏截图交 Reviewer 复验；功能以 Reviewer 断言为准，非目测。

## 十、边界与后续

本轮只落资产库一屏。三处新变量（`--dae-radius-sm/md/lg`）与「中性选中态」是全产品后续推广的候选，
但**未获用户确认前不扩散到其它屏**。字号层面 F03/F05/F06 仍等用户对「同族单档 / 字重收敛」的裁决，
不在本稿范围。

追踪：F-CAN-005–008 / F-SYS-008（素材与资产库）。
