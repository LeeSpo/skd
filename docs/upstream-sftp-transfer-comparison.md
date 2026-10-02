# 上游流式文件传输实现核对

核对日期：2026-10-02。依据 GOODBOY008/r-shell 的 GitHub PR 元数据和固定提交源码；未把上游作者报告的测试成绩或吞吐量当作本机复测结果。上游独立克隆放在 `/tmp/skd-upstream-transfer-20261002`，未切换或修改 skd 的工作区分支。

## 对照点

| 阶段 | 固定提交 | 内容 |
|---|---|---|
| 最初流式实现 | [`da4ac6481b85aa18384daa93580e65fd4ad2dd8a`](https://github.com/GOODBOY008/r-shell/commit/da4ac6481b85aa18384daa93580e65fd4ad2dd8a) | 流式读写、自定义下载 pipeline、实时进度、FTP 流式化 |
| 后端取消 | [`4a63fb8403bbb958aec797bee647b1e26a23ea70`](https://github.com/GOODBOY008/r-shell/commit/4a63fb8403bbb958aec797bee647b1e26a23ea70) | 注册传输任务、CancellationToken、断连取消、释放客户端锁 |
| #168 合并点 | [`f1ecfaee7d8dfcf88af4533f7996b8b90f6a98ea`](https://github.com/GOODBOY008/r-shell/commit/f1ecfaee7d8dfcf88af4533f7996b8b90f6a98ea) | 全局前端队列和状态保护；[PR #168](https://github.com/GOODBOY008/r-shell/pull/168)，2026-09-19 合并 |
| 后续性能升级 | [`558665125304546da5bc8d5e1e1c87c5cae63702`](https://github.com/GOODBOY008/r-shell/commit/558665125304546da5bc8d5e1e1c87c5cae63702) | 滑动 pipeline、多 SSH 连接分段、russh 0.63；[PR #187](https://github.com/GOODBOY008/r-shell/pull/187)，2026-09-30 合并 |

PR #168 的最终范围已经超过“基础流式传输 + 进度”，不能只看 PR 标题就把所有代码当作此次 skd 需求。PR #187 的最终提交也比 PR 描述早期部分更广：最终下载同样使用独立 SSH 连接分段，而非仅上传分段。

## 最初实现 da4ac648

### 内存与协议读写

- 下载使用 `RawSftpSession` 手工发带 offset 的 READ 请求，每批并发 **64 × 32 KiB = 2 MiB**，按顺序消费；遇到短读丢弃后续错位请求并从实际 offset 重开批次。磁盘写入用 **256 KiB BufWriter**。内存不会随整个文件大小增长，但不是单个 64 KiB 应用缓冲区。[常量及读循环](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src-tauri/src/sftp_transfer.rs#L27-L41)，[下载核心](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src-tauri/src/sftp_transfer.rs#L165-L259)
- 上传循环读取本地文件到 **256 KiB** 缓冲区，再 `remote.write_all`；源码依赖高层 SFTP File 的内部写 pipeline。因此最初上游上传本身很接近普通有界 copy loop，下载部分才是明显不同的自定义引擎。[上传源码](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src-tauri/src/sftp_transfer.rs#L262-L322)
- 每次传输在已有 SSH transport 上开专用 SFTP subsystem channel，隔离 shared listing session；**不新建 SSH 连接、不重新认证**。配置 SFTP 请求 timeout 为 **120 s**，并尝试协商 OpenSSH limits。[session 建立](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src-tauri/src/sftp_transfer.rs#L20-L115)
- SSH 与独立 SFTP 都保留原无进度方法包装，并进入同一传输引擎。旧包装不是 skd 独有设计。[SSH 包装](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src-tauri/src/ssh/mod.rs#L935-L1001)，[独立 SFTP 包装](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src-tauri/src/sftp_client.rs#L299-L343)

### 目标文件、关闭与错误

- 下载先远端 open/fstat，再本地 `File::create`；上传先本地 open，再远端 create。**直接写目标，没有临时文件或 rename 提交**。因此“失败保留部分目标”的方向与 skd 方案一致。[下载入口](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src-tauri/src/sftp_transfer.rs#L134-L159)，[上传入口](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src-tauri/src/sftp_transfer.rs#L262-L279)
- 正常下载 `writer.flush()` 后 **best-effort raw.close**，close 错误被忽略；正常上传 `remote.flush()` 和 `remote.shutdown()` 错误均传播。最初循环的读取/写入错误用 `?` 提前返回，没有一个覆盖所有错误分支的统一“尽力 close，同时保留原错误”收尾。[下载收尾](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src-tauri/src/sftp_transfer.rs#L213-L259)，[上传收尾](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src-tauri/src/sftp_transfer.rs#L295-L321)

### 进度与前端

- IPC payload 是 `{ transferred, total }`，**未知 total = 0**。传输命令使用 **必填 `Channel<TransferProgress>`**；发送失败忽略，不中止传输。编辑器这类无 UI 调用者改成传 no-op Channel。[payload](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src-tauri/src/sftp_transfer.rs#L43-L55)，[commands](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src-tauri/src/commands.rs#L2547-L2554)，[必填参数](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src-tauri/src/commands.rs#L2619-L2685)
- 后端约 100 ms 节流，强制初始/末尾快照。前端使用 **EMA 速度平滑**：至少 200 ms 采样，旧值权重 0.7，新值 0.3；已知总量最多 99%，COMPLETE 后才 100%。后端 unknown=0 时可回退文件列表大小。[前端适配器完整源码](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src/lib/transfer-progress.ts)
- 目录和同步用“完成字节 baseBytes + 当前 event.transferred”，避免每个事件重复相加。这种累计方式同样已经在上游存在。[目录](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src/components/directory-transfer-dialog.tsx#L273-L312)，[同步](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src/components/sync-dialog.tsx#L312-L359)
- FTP/FTPS 同时改成流式 RETR/STOR，属于 skd 此次明确排除的范围。[FTP 变更](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src-tauri/src/ftp_client.rs#L201-L325)

### 测试与依赖

最初引擎包含 6 个内存 SFTP 服务驱动的下载协议测试（多窗口、未知总量 EOF、短读、空文件、零长度 DATA），另有常量断言；使用 duplex 而非真实 SSH transport。另有被 ignore 的 Docker 上传/下载往返测试，作者在 PR 中报告实际执行结果。最初引擎测试没有独立的固定 64 KiB 生成式大文件证明，也没有上传/写入/flush/close 失败矩阵。[引擎测试](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src-tauri/src/sftp_transfer.rs#L325-L593)，[SSH 测试](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src-tauri/src/ssh/tests.rs)

该提交 Cargo.lock 固定 russh **0.44.1**、russh-sftp **2.3.0**、suppaftp **6.3.0**，未靠升级 russh 完成最初流式能力；Cargo.toml 增加 dev 依赖 opt-level=3。[Cargo.toml](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src-tauri/Cargo.toml)，[Cargo.lock](https://github.com/GOODBOY008/r-shell/blob/da4ac6481b85aa18384daa93580e65fd4ad2dd8a/src-tauri/Cargo.lock)

## #168 后续取消与全局队列

后端注册 `(connection_id, transfer_id) → CancellationToken`；新 `cancel_transfer` 命令；传输命令增加必填 transferId。断连/连接淘汰先取消 transfer token。传输 engine 的 select! 可中断等待，取消时 flush 保留 partial，close 最多等 500 ms。不能把这些行为归于最初流式提交。[registry](https://github.com/GOODBOY008/r-shell/blob/4a63fb8403bbb958aec797bee647b1e26a23ea70/src-tauri/src/connection_manager.rs#L225-L279)，[取消引擎](https://github.com/GOODBOY008/r-shell/blob/4a63fb8403bbb958aec797bee647b1e26a23ea70/src-tauri/src/sftp_transfer.rs)

前端改成模块级全局 queue service，浏览器、目录、同步、编辑器共用一次只跑一项的 pump，submit 返回 done promise 和 cancel；PROGRESS/COMPLETE/FAIL 只有 transferring 能接收。它重构原每面板循环，超出此次 skd 明确保留原面板调度的范围。[queue service](https://github.com/GOODBOY008/r-shell/blob/f1ecfaee7d8dfcf88af4533f7996b8b90f6a98ea/src/lib/transfer-queue-service.ts)，[状态保护](https://github.com/GOODBOY008/r-shell/blob/f1ecfaee7d8dfcf88af4533f7996b8b90f6a98ea/src/lib/transfer-queue-reducer.ts#L120-L173)

## #187 后续吞吐优化

- 原按批次等待下载改为 `FuturesOrdered` **滑动窗口**，每收到一个结果补新请求；下载预算 **32 MiB**，根据 limits 调整请求长度/深度。上传改为 RawSftpSession 自定义滑动 WRITE pipeline，预算 **4 MiB**。这些预算均不等于最初 2 MiB，也不等于 skd 单 64 KiB copy buffer。[常量](https://github.com/GOODBOY008/r-shell/blob/558665125304546da5bc8d5e1e1c87c5cae63702/src-tauri/src/sftp_transfer.rs#L42-L109)，[滑动读](https://github.com/GOODBOY008/r-shell/blob/558665125304546da5bc8d5e1e1c87c5cae63702/src-tauri/src/sftp_transfer.rs#L680-L817)，[滑动写](https://github.com/GOODBOY008/r-shell/blob/558665125304546da5bc8d5e1e1c87c5cae63702/src-tauri/src/sftp_transfer.rs#L1138-L1263)
- 文件 ≥64 MiB 时下载默认 4 段，每连接 8 MiB window；上传按 RTT 自适应 1–8 streams。额外 **独立 TCP/SSH 连接重新握手和认证**，不是仅追加同一连接的 SFTP channels；proxy/jump host 场景放弃额外连接，失败时退回。没有临时 rename，仍保留直接写目标/partial 方向。[分段策略](https://github.com/GOODBOY008/r-shell/blob/558665125304546da5bc8d5e1e1c87c5cae63702/src-tauri/src/sftp_transfer.rs#L111-L232)，[建立额外连接与认证](https://github.com/GOODBOY008/r-shell/blob/558665125304546da5bc8d5e1e1c87c5cae63702/src-tauri/src/ssh/mod.rs#L803-L899)，[分段下载写目标](https://github.com/GOODBOY008/r-shell/blob/558665125304546da5bc8d5e1e1c87c5cae63702/src-tauri/src/sftp_transfer.rs#L557-L669)
- 正常 raw 上传 ACK drain 后 fsync 是 best effort（失败日志继续），close 也是 500 ms best effort；下载 close 同样非致命。因此“成功必须 close 成功”与 skd 此次方案存在实质语义差异。[下载收尾](https://github.com/GOODBOY008/r-shell/blob/558665125304546da5bc8d5e1e1c87c5cae63702/src-tauri/src/sftp_transfer.rs#L801-L816)，[上传收尾](https://github.com/GOODBOY008/r-shell/blob/558665125304546da5bc8d5e1e1c87c5cae63702/src-tauri/src/sftp_transfer.rs#L1241-L1262)
- russh 升到 **0.63.3**，russh-sftp **2.4.0**，suppaftp **12.1.1**；迁移 auth/key 等 API、compression 默认关闭，含 compression/rekey 回归、分段组合/取消/兄弟失败测试及额外连接 Docker e2e。[依赖](https://github.com/GOODBOY008/r-shell/blob/558665125304546da5bc8d5e1e1c87c5cae63702/src-tauri/Cargo.lock)，[协议/分段测试](https://github.com/GOODBOY008/r-shell/blob/558665125304546da5bc8d5e1e1c87c5cae63702/src-tauri/src/sftp_transfer.rs#L1531-L2496)，[SSH e2e 与 rekey 测试](https://github.com/GOODBOY008/r-shell/blob/558665125304546da5bc8d5e1e1c87c5cae63702/src-tauri/src/ssh/tests.rs)

## 可复用边界

### 与本地 skd 工作区的直接对照

本地对照对象为核对时 `2fe758f` 加未提交实现，不是另一版已发布产品。下表的“上游最初实现”均指 da4ac648；取消和全局队列另按 #168 最终版本区分。

| 方面 | 上游最初实现 | 本地 skd | 判断 |
|---|---|---|---|
| 下载 | 64 个 32 KiB READ 在途，256 KiB BufWriter | 单 64 KiB 应用缓冲、顺序 read/write_all | 已确认方案排除了自定义流水线；没有获得这部分上游吞吐优化 |
| 上传 | 256 KiB read/write_all，库内部 8 路写 | 64 KiB read/write_all，同样依赖库内部写管线 | 循环本可复用，只需调整缓冲区及收尾 |
| 请求超时 | 专用传输 session 120 s | 仍用 SftpSession::new，库默认每请求 10 s | 本可复用但未吸收；64 KiB 流式化不等于解决所有请求停顿超时 |
| 速度 | 200 ms 采样、0.7/0.3 EMA | 相邻有效事件字节/时间差，无平滑 | 本可复用但未吸收；本地速度/ETA可能更易抖动，未作实测对比 |
| IPC | 必填 Channel，transferred/total，unknown=0 | 可选 Channel ID，bytesTransferred/totalBytes，unknown=null | 适配已确认接口，保留省略参数的旧调用 |
| 完成与错误 | 下载 close best effort；上传 flush+shutdown | 两方向成功须 shutdown 成功，异常最多 1 s 尽力 shutdown 并保留原错误 | 有意按本地方案加强收尾 |
| 目录与同步 | baseBytes + 当前文件快照，完成后原文件列表大小累计 | 完成字节 + 当前快照，成功响应实际字节校正总量，未知大小单独展示 | 基本结构可复用；本地增加实际大小及生命周期处理 |
| 任务生命周期 | 最初适配器直接 dispatch；#168 最终有全局 queue/backend cancel | per-call Channel 关闭标记、组件 generation、transferring 状态保护；面板队列仍串行 | 保留局部调度范围；没有真正停止后端进行中的传输 |
| 测试 | 读 pipeline 协议边界及作者报告的真实 SSH 往返基准 | 9 项 Rust 传输测试、20 项新增前端测试；无真实 SSH 基准 | 覆盖目标不同，不能用测试数量或上游报告推断本地更快 |

本地依据：[后端模块](../src-tauri/src/sftp_transfer.rs)、[SSH 包装](../src-tauri/src/ssh/mod.rs)、[独立 SFTP 包装](../src-tauri/src/sftp_client.rs)、[IPC 命令](../src-tauri/src/commands.rs)、[前端适配器](../src/lib/transfer-progress.ts)、[队列状态保护](../src/lib/transfer-queue-reducer.ts)、[Rust 测试](../src-tauri/src/sftp_transfer/tests.rs)、[队列组件测试](../src/__tests__/file-transfer-progress.test.tsx)、[目录与同步测试](../src/__tests__/directory-sync-progress.test.tsx)、[适配器测试](../src/lib/__tests__/transfer-progress.test.tsx)。默认请求超时与 8 路写核对了已安装 russh-sftp 2.3.0 的 `src/client/mod.rs`。

能直接摘取并局部适配的部分包括：无进度包装结构、进度节流/Channel 构建、99% 完成门槛、EMA 速度估算、目录 baseBytes 累计、transferring 状态保护、内存 SFTP fixture 架构。它们无需把 #168 的全局 queue/backend cancel 或 #187 的多连接/依赖升级一并带进来。

自定义下载 pipeline 会偏离此次“单 64 KiB copy loop”的具体方案，应该显式选择。**120 s timeout、EMA 速度平滑、dev 依赖优化则没有被此次范围禁止，属于本可吸收却未吸收的上游改进**，不能解释为必要适配。专用 SFTP channel 不等于额外 SSH 连接或重新认证。上游上传最初也是常规读取/write_all循环，完全重写并非由版本不兼容所迫。

本地 russh 为 0.62.3，russh-sftp 为 2.3.0；对照最初上游 russh 0.44.1 时 SSH API 接口可能需要局部适配，但 SFTP 同版本，不能据此声称必须升级到 #187 的 russh 0.63 才能复用。两者当前库写管线均为 8，普通 read/write_all 并不代表所有网络操作完全串行。上述本地版本与库默认值由主代理核对。

对于性能，仅能据协议结构推断：skd 的常规高层顺序 read/write_all 并未包含上游减少每块 RTT 等待的自定义下载并发逻辑，因此不能把“不会整文件进内存”自动等同于“获得上游吞吐提升”。实际 skd 吞吐需要同一服务、同一版本和网络下测量；上游 PR 报告的数字不能套用到 skd。
