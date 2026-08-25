# PTY output waiting: native terminal patterns and guidance for skd

Research date: 2026-08-25. Sources are first-party documentation and upstream
source trees, pinned to the inspected revisions where applicable.

## The important boundary

There are two different waits in skd and they should not be implemented the
same way:

1. **Child PTY master FD -> backend producer.** This is OS I/O. On macOS it can
   be handled by a blocking reader thread, or by a nonblocking FD registered
   with `poll`/`kqueue` (usually through a runtime/reactor).
2. **Backend `mpsc` receiver -> WebSocket sender.** This is already an async
   notification mechanism. `Receiver::recv().await` sleeps until a sender
   publishes data; adding a 1 ms timeout around it merely recreates polling in
   user space. Tokio documents bounded `mpsc` as providing backpressure and
   waking a receiver when data arrives ([Tokio `mpsc` docs](https://docs.rs/tokio/latest/tokio/sync/mpsc/)).

The current staged change addresses both layers: the local PTY is owned by a
dedicated reader thread with an explicit quit socket, while the internal path
waits on `output_rx.recv()` and uses `tokio::select!` to race data with
cancellation and the batch-flush deadline. Tokio explicitly lists
`mpsc::Receiver::recv` as cancellation-safe in a `select!` loop
([Tokio `select!` docs](https://docs.rs/tokio/latest/tokio/macro.select.html#cancellation-safety)).

## What mature terminals do at the PTY FD layer

### WezTerm: dedicated blocking reader

WezTerm deliberately runs each pane's blocking PTY reader on a dedicated
thread because nonblocking behavior is not portable across all PTY/TTY types.
It forwards bytes through a socket pair to a parser thread
([reader and socket-pair setup](https://github.com/wezterm/wezterm/blob/f93d90350075d3e42566e0557ca36e82ffdcbec1/mux/src/lib.rs#L268-L348),
[thread spawn per pane](https://github.com/wezterm/wezterm/blob/f93d90350075d3e42566e0557ca36e82ffdcbec1/mux/src/lib.rs#L795-L801)).
The socket buffer is finite, so a slow parser eventually blocks the producer.
The parser briefly coalesces output using a bounded deadline, but flushes the
remaining batch before exit
([coalescing and final flush](https://github.com/wezterm/wezterm/blob/f93d90350075d3e42566e0557ca36e82ffdcbec1/mux/src/lib.rs#L140-L245)).

### Alacritty: nonblocking PTY in a dedicated readiness loop

Alacritty owns the PTY inside a dedicated I/O thread, registers it with a
portable `Poller`, and blocks in `wait` until PTY, child-exit, explicit wake, or
parser-timeout activity occurs
([event-loop construction](https://github.com/alacritty/alacritty/blob/7dd7b5b09e06ca58daadfb12bd45a9aa8fa716f2/alacritty_terminal/src/event_loop.rs#L42-L84),
[registration and wait loop](https://github.com/alacritty/alacritty/blob/7dd7b5b09e06ca58daadfb12bd45a9aa8fa716f2/alacritty_terminal/src/event_loop.rs#L205-L253)).
After readable notification it keeps reading/parsing until caught up or until
its bounded work/lock budget is reached; `Interrupted` and `WouldBlock` are
normal readiness outcomes
([PTY drain loop](https://github.com/alacritty/alacritty/blob/7dd7b5b09e06ca58daadfb12bd45a9aa8fa716f2/alacritty_terminal/src/event_loop.rs#L104-L169)).
Input/resize/shutdown commands wake the same poller rather than waiting for a
periodic tick
([sender wakeup](https://github.com/alacritty/alacritty/blob/7dd7b5b09e06ca58daadfb12bd45a9aa8fa716f2/alacritty_terminal/src/event_loop.rs#L383-L393)).
Its `polling` dependency uses `kqueue` on macOS
([official `polling` repository](https://github.com/smol-rs/polling#supported-platforms)).

### Ghostty: explicit poll + wake pipe, with bounded buffers

Ghostty's current macOS-oriented path uses a nonblocking PTY gather thread plus
a parse thread. A fixed four-slot, 64 KiB-per-slot ring bounds how far the
reader can run ahead; when full, it stops draining the PTY and lets kernel flow
control propagate back to the child
([pipeline rationale and bounds](https://github.com/ghostty-org/ghostty/blob/8867c37c55b578b9eb4cfaba41cb9023e557176d/src/termio/Exec.zig#L1268-L1325),
[bounded ring/backpressure](https://github.com/ghostty-org/ghostty/blob/8867c37c55b578b9eb4cfaba41cb9023e557176d/src/termio/Exec.zig#L1358-L1408)).
Its blocking `poll(..., -1)` watches both the PTY and an owned quit pipe, then
examines `revents` for cancellation and hangup
([FD set and bounded-buffer wait](https://github.com/ghostty-org/ghostty/blob/8867c37c55b578b9eb4cfaba41cb9023e557176d/src/termio/Exec.zig#L1521-L1562),
[blocking wait and exit checks](https://github.com/ghostty-org/ghostty/blob/8867c37c55b578b9eb4cfaba41cb9023e557176d/src/termio/Exec.zig#L1695-L1729)).
For bulk output it may bridge tiny refill gaps, but the spin count, individual
poll timeout, and total batching budget are all bounded; interactive trickles
are delivered immediately
([bounded bridge behavior](https://github.com/ghostty-org/ghostty/blob/8867c37c55b578b9eb4cfaba41cb9023e557176d/src/termio/Exec.zig#L1569-L1665)).

## macOS and Tokio implications

Apple's `kqueue` API waits indefinitely when `kevent` receives a null timeout,
reports FD readability through `EVFILT_READ`, and removes registrations when an
FD is closed. It also exposes EOF separately; callers still have to drain and
handle EOF/error correctly
([Apple `kqueue(2)`](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kqueue.2.html)).

Tokio's Unix `AsyncFd` is the suitable reactor adapter only if skd can provide
an **owned** `AsRawFd` object, set it nonblocking, and perform the standard
read-until-`WouldBlock` readiness protocol. `AsyncFd` takes ownership of the
wrapper and caches its FD; readiness may be a false positive and must only be
cleared after observing `WouldBlock`
([Tokio `AsyncFd`](https://docs.rs/tokio/latest/tokio/io/unix/struct.AsyncFd.html),
[readiness guard rules](https://docs.rs/tokio/latest/tokio/io/unix/struct.AsyncFdReadyGuard.html)).
A copied `RawFd` does not provide that ownership or lifetime guarantee.

An infinite blocking syscall inside `spawn_blocking` is also not a complete
cancellation design: Tokio states that a started `spawn_blocking` task cannot
be aborted and recommends a dedicated thread for long-lived blocking loops
([Tokio `spawn_blocking`](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html)).

## Recommendation for skd

- **Keep the staged layer-2 change.** `output_rx.recv()` plus cancellation and
  flush-deadline branches is the correct replacement for the 1 ms internal
  channel poll. Preserve bounded channels and the awaited WebSocket send so
  backpressure continues through WebSocket -> output channel -> SSH window or
  local PTY kernel buffer.
- **Keep the completed local-PTY reader module.** One long-lived thread owns
  both the `portable-pty` reader and an independently duplicated readiness FD,
  reuses its buffer, and uses bounded-channel `blocking_send`. Its `poll` also
  watches an owned quit socket; cancellation closes the receiver to release a
  backpressured send, wakes the thread, terminates the child, and joins the
  thread. EOF/read failure cancels the same session lifecycle.
- **Do not regress to a bare-`RawFd` `poll(fd, -1)`.** A copied descriptor without
  an owned lifetime and explicit wake FD is unlike the complete ownership and
  cancellation protocols above.
- **Use `AsyncFd`/`kqueue` only as a deliberate Unix backend redesign.** Obtain
  an owned duplicate/handle with an explicit close policy, set it nonblocking,
  drain to `WouldBlock`, and select readiness against cancellation. If using a
  direct blocking `poll`, monitor both the PTY and a self-pipe/event FD and
  always inspect `revents`, including EOF/HUP and `EINTR` retry.
- **Tune batching only after measuring.** Separate interactive latency from
  bulk throughput with a small bounded time/byte budget, and never use an
  unbounded queue to hide a slow browser/WebSocket consumer.
