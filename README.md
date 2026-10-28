# watchman-client-json

A typed, bounded **newline-JSON Watchman wire client** for Node-compatible sockets.
It does not discover or start Watchman, negotiate BSER, reconnect, or interpret
filesystem inventory. Supply the daemon's socket path explicitly.

Extracted from [effect-watchman](https://github.com/rektide/effect-watchman) at
[`a2cae66e57e8f0485cb850590ff1adb3353c0cbe`](https://github.com/rektide/effect-watchman/tree/a2cae66e57e8f0485cb850590ff1adb3353c0cbe).
The extraction preserves the reviewed S1 segmented framing and command-correlation
implementation. Its prior correctness evidence is the independent
[S1 G review](file:///home/rektide/src/opencode-watch-rebuild/design/filesystem-watch/source-materialization-s1-review0.glm53m.md)
(clear with advisory, 2026-10-27); extraction-specific checks and boundary choices
are in the [extraction receipt](doc/extraction0.sol61x.md). That review covers the
source, not an independent review of this new package.

## Consumption

Version **0.1.0**, MIT. The sole runtime dependency is the **`effect@4.0.1` peer**,
used for Effect v4 Schema decoding. Install that peer alongside this package.
There is no Effect runtime/layer requirement and no dependency on
`effect-watch-plus`, `@effect/platform-node`, globbing, or a Watchman executable.
Keeping the exact schema implementation is a proposed interface choice, not a
claim that a dependency-free rewrite would be equivalent.

This package ships **raw TypeScript**: `main`, `types`, and `exports` point at
`watchman-client-json.ts`. Use Bun, a TypeScript-capable loader, or a bundler;
plain JavaScript-only runtimes cannot consume it directly. Constructors use
TypeScript parameter properties, so Node's strip-only mode alone is insufficient.
`build` only typechecks; there is no `dist` directory or generated JavaScript.
The repository has not been pushed or published as part of this extraction.

## API

```ts
import { Connection, Delivery, type Reply } from "watchman-client-json"

const connection = new Connection({
  socketPath: "/path/to/watchman.sock",
  requestTimeoutMs: 3000,
  maxFrameBytes: 1024 * 1024,
  maxPendingCommands: 128
})
const signal = new AbortController().signal

try {
  await connection.connect(signal)
  const project = await connection.command(["watch-project", "/my/project"], "watch", undefined, signal)
  const root = project.watch
  if (!root) throw new Error("Watchman omitted watch root")
  const boundary = await connection.command(["clock", root], "clock", undefined, signal)
  const name = "my-unique-subscription"
  const delivery = new Delivery<Reply>(1024)
  const detach = connection.listen(name, {
    push: (frame) => delivery.push(frame),
    fail: (error) => delivery.fail(error)
  })
  try {
    await connection.command(["subscribe", root, name, {
      since: boundary.clock, fields: ["name", "exists", "new"]
    }], "subscribe", name, signal)
    for await (const frame of delivery) {
      console.log(frame.files)
      break // Example only; returning from the iterator closes this delivery.
    }
  } finally {
    detach() // Local routing first; this does NOT send an unsubscribe.
    delivery.fail(new Error("Subscription scope closed"))
    // A cleanup boundary deliberately absorbs errors before closing the socket.
    // Give an abandoned subscribe its wire deadline, then cleanup its own deadline.
    await connection.command(["unsubscribe", root, name], "unsubscribe", name,
      new AbortController().signal, 500, 3500).catch(() => {})
  }
} finally {
  connection.close()
}
```

`command` checks the reply's named string field and, when supplied, its expected
value. It supports the exported acknowledgement schema, **not arbitrary Watchman
command-specific payloads**. `watch`, `clock`, `subscribe`, `unsubscribe`, and
`version` are typical reply keys. Arguments are JSON-serializable arrays.

| Surface | Contract |
| --- | --- |
| `new Connection(options, onFailure?)` | One socket lifetime. Nonempty `socketPath`; positive safe-integer numeric options. Failure callback runs once on terminal failure, including explicit close. |
| `connect(signal)` | Call once, before requests/listeners. Signal controls connection establishment only. Construct a new connection after failure; no reopen/reconnect. |
| `command(args, key, expected, signal, timeout?, queueTimeout?)` | `Promise<Reply>`. FIFO request with string-field acknowledgement validation. Pass `undefined` when any string value is acceptable. |
| `query(args, signal, timeoutMs, maxBytes)` | `Promise<QueryReply>`. Caller supplies query command/options. UTF-8 result-byte budget excludes LF. Query rows may be strings or rich objects. Warnings reject rather than claiming a complete result. |
| `config(root, signal)` | `Promise<ConfigReply>` for `get-config`, preserving `ignore_dirs` and `ignore_vcs`. |
| `listen(name, { push, fail })` | Attach local routing **before** wire subscribe; returns local detach. Use unique names per connection. Neither operation sends commands, terminates a delivery, or owns cleanup. |
| `listeners` | Typed listener map retained for low-level integration compatibility. `set`/`delete` have the same local-only meaning as `listen`/detach. |
| `idle`, `check()`, `fail(error)`, `close()` | Wire/queue idle state, terminal-state assertion, explicit terminal failure, terminal socket close. Closing is synchronous; it does not unsubscribe gracefully. |
| `new Delivery<A>(capacity)` | Bounded **single-consumer** `AsyncIterable<A>` with `push` and latched `fail`. Supply a positive capacity and non-`undefined` values. No normal completion protocol; iterator `return()` closes it with a latched error. |

`Reply`, `Envelope`, `QueryReply`, and `ConfigReply` are exported as both Effect
schemas and inferred types. `ConnectionOptions`, `SubscriptionListener`, and
`SubscriptionCanceled` are also exported. Framing and attribution diagnostics are
internal, not package exports. Listener callbacks and `onFailure` must not throw.

Defaults: connection timeout **3000 ms**, on-wire request timeout **3000 ms**,
frame payload limit **1 MiB**, total pending/queued command bound **128**.
`queueTimeoutMs` defaults to each operation's on-wire timeout. Explicit command
timeout arguments override those defaults. Timeouts and query budgets supplied
per call must be positive finite integers. Delivery capacity is separate from
connection options; cleanup deadlines belong to the caller.

## Preserved wire and failure semantics

- Exactly one transmitted command owns the reply slot. Further commands queue;
  subscription frames do not consume that slot. Commands encode as JSON + LF.
- Aborting an **unsent** command removes only that command and frees capacity.
  Aborting a **transmitted** command rejects only its caller: the original slot
  and deadline remain until its reply or terminal timeout. Late replies cannot
  settle the next command. Queue and wire deadlines are separate; either expiring
  is connection-terminal. A cleanup queued behind an abandoned request needs
  enough queue budget to preserve that ownership.
- `maxFrameBytes` counts UTF-8 **payload bytes**, including unfinished payloads,
  excluding the LF delimiter. Equality is legal; each frame has its own budget
  even when several arrive in one chunk. Fatal UTF-8 decoding occurs only after
  framing, so split code points are legal and malformed UTF-8 is terminal.
- S1 scans each newly received byte once, coalesces small fragments into 16 KiB
  pages, and materializes a split frame at most once. Whole contiguous frames
  are delivered without assembly copies. Retained large segments must have
  backing storage at most twice their length; a tiny tail cannot pin a huge read.
- Socket errors/closure, malformed JSON/envelopes/subscription payloads,
  oversized frames, mismatched acknowledgements, unsolicited responses, command
  queue overflow, and deadlines latch a connection-wide failure, clear framing
  storage, reject outstanding/queued requests, and fail all listeners.
- Daemon command `error` replies reject that operation without poisoning the
  socket. Query schema errors, result-byte overruns, and query warnings are also
  operation-local **after valid framing, UTF-8, JSON, and envelope decoding**.
- A cancellation with a subscription name removes and fails only that listener
  with `SubscriptionCanceled`, before ordinary delivery discrimination. A
  cancellation without a name is connection-terminal. Unknown subscription
  names are ignored after validation. Ordinary subscription `error` and
  `is_fresh_instance` fields are delivered unchanged for the caller's policy.
- `Delivery` overflow clears buffered hints and latches its first failure;
  future reads reject rather than silently losing events. This is local to that
  delivery; its owner decides when to detach/unsubscribe. There is no recovery,
  observed-inventory epoch handling, filtering, or automatic reconciliation here.

This is still the synchronous S1 decoder: no receive yielding, transport
backpressure redesign, or S2 performance claim is included.

## Development

```sh
pnpm install --frozen-lockfile
WATCH_TEST_DIRECTORY=/tmp/opencode bun test ./test/transport.test.ts ./test/query-transport.test.ts ./test/framing.test.ts
bun run typecheck
bun run build
```

Tests use private scripted Unix-socket peers, not a Watchman daemon. Override
`WATCH_TEST_DIRECTORY` with an existing directory on another machine. The default
is `/tmp/opencode`. Framing tests retain the source's counter-based linearity
proofs; transport tests cover cancellation ownership, sibling isolation, byte
limits, fatal UTF-8, and bounded failure/cleanup. Source filesystem-policy tests
remain the integration library's responsibility.
