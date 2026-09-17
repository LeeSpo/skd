# skd 文件管理器简化研究

研究日期：2026-09-17。范围仅限路径/导航、常用与次级文件动作、传输状态披露；不涉及实现或像素规格。

## 文档事实

### 1. 路径与导航

- **Finder 帮助 [3]**：路径栏可通过 View > Show Path Bar 显示，也可按 Option 临时显示；位于窗口底部附近，展示项目所在的目录层级。点击路径中的文件夹可导航，Control-click 可复制其路径。路径栏与状态栏是不同功能：后者显示项目数量、可用磁盘空间，也可显隐。
- **Transmit 5 [4]**：支持单栏或双栏浏览；聚焦栏的路径栏以蓝色显示当前目录，多数命令作用于聚焦栏。支持进入文件夹、返回父目录、Go to Folder 手动输入路径，以及前进/后退历史。
- **ForkLift 4 [5]**：路径栏位于文件面板上方，并包含显示选中数量、大小、剩余空间的状态栏；侧栏承载设备、连接和分组收藏。它与 Finder 的布局不同，不能据此推导唯一的“macOS 标准位置”。

### 2. 常用与次级动作

- **Apple HIG Toolbars [1]**：优先呈现主要任务及常用命令，按功能和使用频率分组，避免拥挤；必要时用 More 菜单收纳较次要动作。macOS 工具栏上的动作也应在菜单栏提供，但不必把每个菜单命令都放进工具栏。
- **Apple HIG Lists and tables [2]**：行内容应简短、便于扫描；选中反馈要明确。macOS 表格在有价值时应支持列标题排序，并允许调整列宽。窄列中的文本应尽量保持可辨识，例如保留文件名首尾，而不是一味增加行高。
- **Transmit 5 [4] / ForkLift 4 [5]**：都支持工具栏定制。手册说明能力，但没有给出 skd 用户的操作频率统计；不能把竞品全部功能直接当成 skd 的常用动作清单。

### 3. 传输状态披露

- **Transmit 5 [4]**：Transfers 列表展示当前聚焦标签页的活动与待处理文件操作；可通过工具栏 Activity 按钮或 View > Show Transfers 显隐，也可将弹出内容拖成独立窗口。详细队列并非必须一直占据主浏览区域。
- **ForkLift 4 [5]**：右侧 Preview Pane 可切换 Info、Activities 或 Log，将详细活动与文件内容分区。已读取的手册段落未明确说明空闲时是否自动隐藏、失败时是否自动展开，不作推断。
- **边界**：Finder 的项目数/剩余空间不是传输进度；文件选择摘要、传输摘要和诊断日志不宜混为一类状态。

## 对 skd 的设计建议（非文档要求）

1. **保留一处清晰的位置表达**：显示当前主机/本地身份与目录路径，支持点击祖先目录及按需输入完整路径；前进/后退与父目录跳转语义应区分。避免同时常驻面包屑、完整路径输入框和重复目录标题。若采用双栏，明确当前动作针对哪一栏。
2. **让列表成为主体**：文件名与清晰的选中反馈优先，大小/修改时间按需要呈现并可调整；权限等次级信息可移至详情。不要为简化界面牺牲完整路径查看、文件名辨识或选择状态。
3. **缩减常驻动作，不删除能力**：先把上传/下载、新建文件夹视为主动作候选；重命名、复制路径、删除及权限等放在选择相关菜单或 More，并保留可发现的菜单/快捷键入口。该排序只是待用户任务验证的假设，不是 Apple 或竞品规定；删除与常规动作应清晰区分。
4. **摘要常见，详情按需**：有传输时显示紧凑的任务数/进度入口，点击展开队列；空闲时折叠详细区域。失败或冲突保留明显入口，不因收起队列而消失。项目数/选中数与传输摘要分开，日志作为更深一层信息。这是基于上述产品模式的 skd 建议，不宣称竞品均有相同自动显隐规则。

**收敛方向**：一处路径导航、少量主动作、以文件列表为中心、可展开的传输摘要。无需照搬双栏、常驻详情面板或完整专业客户端功能。本文不指定像素尺寸，更不将行高、图标大小或工具栏高度称为 Apple 强制要求。

## 主要参考（五篇官方文档）

1. Apple HIG — [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)
2. Apple HIG — [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)
3. Apple Finder 帮助 — [Get file, folder, and disk information on Mac](https://support.apple.com/guide/mac-help/get-file-folder-and-disk-information-on-mac-mchlp1774/mac)
4. Panic — [Getting started with Transmit 5](https://help.panic.com/transmit/transmit5/getting-started/)（页面标注更新于 2018-05-04；仅作为 Transmit 5 文档事实）
5. BinaryNights — [ForkLift 4 Quick Start Guide / 官方手册](https://binarynights.com/manual)（当前页面是 ForkLift 4，不是 ForkLift 3）

## 抓取与核验限制

- Apple Toolbars 官方页面经 Exa 抓取返回 “An unknown error occurred”；随后成功读取同一文档的 [Apple 官方 JSON](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/toolbars.json)，核验上述工具栏结论。Lists and tables 官方正文读取成功。
- 初期搜索命中 `apple-docs.everest.mt` 第三方 HIG 镜像；镜像不作为官方证据。最终采用的工具栏、表格结论已由 Apple 官方来源复核；未采用仅由镜像取得的 Path controls 定位规则。
- Finder 与 Transmit 相关正文抓取成功。ForkLift 的 Exa 输出截断于 GUI 段落，随后直接读取官方 HTML 核对路径/状态栏、Activities/Log 和工具栏描述；未声称完整审阅手册或实际运行产品。
- 研究阶段没有统计真实操作频率或进行可用性测试；以下补充为主代理对当前源码的检查，不是产品实测。建议用于简化方案讨论，不是已验证的实现规格。

## 当前实现对照与最小试点

- `src/components/integrated-file-browser.tsx`：同一行工具栏包含后退、前进、上级、Home、可编辑面包屑、刷新、跟随终端、新建文件夹、分别上传文件/文件夹、过滤输入、项目数与选中数。使用横向溢出容器；缩窄时路径与按钮竞争空间。
- 目录树默认占 22%，最少占 14%，当前此处没有折叠入口。远程文件列表常驻名称、大小、修改时间、权限、所有者五列。已有可排序与可调整列宽能力，应保留。
- `src/components/transfer-queue.tsx` 已有折叠队列，并非需要重做：当前新增活动任务会自动展开。建议评估改为摘要更新、用户按需展开，失败仍有显著入口。
- 建议第一批只整理工具栏：保留后退/前进和一处路径；将文件/文件夹上传合并为 Upload 菜单；Home、刷新、新建文件夹、跟随终端等在次级菜单分组；跟随启用时保留可见状态；项目/选中数移至底部摘要；保留目录过滤入口并明确它不是递归搜索。完整路径编辑与现有导航能力不得丢失。
- 后续再评估目录树显隐与可选高级列，不与第一批混做。不要照搬竞品双栏、额外收藏侧栏或常驻预览栏，skd 外层已经是工作台。

