---
type: ImplementationReceipt
title: JSON-lines Watchman client — standalone extraction
description: Boundary, proposed dependency and interface decisions, preserved S1 behavior, test portability, and verification for the pure extraction from effect-watchman a2cae66e into watchman-client-json 0.1.0.
resource: /doc/extraction0.sol61x.md
status: implemented and locally verified; interface choices proposed; no independent extraction review, push, or publication
author: GPT-6.1 Sol
model: openai/gpt-6.1-sol#xhigh
date: 2026-10-28
sources:
  - resource: "opencode://ses_e7c90f1d6ffeviS28mp5Msdsk1"
    title: Human approves GitHub publication and authorizes the JSON log-routing parity fix; implement bounded ignore and pin command-slot ownership before, between and after replies
  - resource: "opencode://ses_e7c9cffdbffe7o9wLw1Zgf0N2h"
    title: Commissioned standalone JSON client extraction; boundary and peer-dependency decisions, direct transport test ports, raw-TypeScript packaging, and local verification
  - resource: "https://github.com/rektide/effect-watchman/tree/a2cae66e57e8f0485cb850590ff1adb3353c0cbe"
    title: Exact source revision; local checkout verified at this tip before extraction
  - resource: "https://github.com/rektide/effect-watchman/blob/a2cae66e57e8f0485cb850590ff1adb3353c0cbe/src/Connection.ts"
    title: Socket lifecycle, schema definitions, FIFO command ownership, dispatch, and bounded Delivery source read and extracted
  - resource: "https://github.com/rektide/effect-watchman/blob/a2cae66e57e8f0485cb850590ff1adb3353c0cbe/src/Framing.ts"
    title: Reviewed S1 single-scan, segmented framing with 16 KiB page coalescing copied without algorithm changes
  - resource: "file:///home/rektide/src/effect-watchman/src/Diagnostics.ts"
    title: Internal bounded attribution copied unchanged for source comparability and counter keepers
  - resource: "file:///home/rektide/src/effect-watchman/src/Owner.ts"
    title: Higher-layer lifecycle/root ownership reviewed to exclude recovery and retain positive connection-limit validation at the new boundary
  - resource: "file:///home/rektide/src/effect-watchman/src/Backend.ts"
    title: Subscription local registration and caller-owned unsubscribe deadlines read to document the same wire-cleanup discipline without filesystem policy
  - resource: "file:///home/rektide/src/effect-watchman/src/SignalBackend.ts"
    title: Recovery-specific listener behavior reviewed and deliberately left with the integration library
  - resource: "file:///home/rektide/src/effect-watchman/test/transport.test.ts"
    title: Scripted transport regressions ported to public wire calls; filesystem-specific tests intentionally not copied
  - resource: "file:///home/rektide/src/effect-watchman/test/query-transport.test.ts"
    title: Canceled-query ownership, sibling isolation, rich reply decoding and terminal deadline tests ported without enumeration policy
  - resource: "https://github.com/rektide/effect-watchman/blob/a2cae66e57e8f0485cb850590ff1adb3353c0cbe/test/framing.test.ts"
    title: All S1 deterministic scan/copy/materialization and storage-bound keepers copied
  - resource: "file:///home/rektide/src/effect-watchman/package.json"
    title: Original MIT declaration and exact Effect 4.0.1 dependency version confirmed
  - resource: "file:///home/rektide/src/opencode-watch-rebuild/design/filesystem-watch/source-materialization-s1-review0.glm53m.md"
    title: Independent G source review establishes prior S1 correctness and records advisory gaps; not a review of this extraction
verification:
  method: Scripted Unix-socket peer tests, deterministic framing counters, 10 repetitions of the complete focused suite, tsgo typecheck and build, and normalized source equality checks
  scope: Standalone package only; source repository read-only; no real-daemon interoperability run or independent extraction review
---

# Standalone extraction receipt

## 2026-10-28 authorized follow-up

The human has approved effect-watchman's dual-backend ledger, accepted its
documented BSER UTF-8 degradation permanently, and authorized both this client's
GitHub publication and the previously blocked JSON log-classifier fix.

The client now decodes optional string `log` metadata and ignores a log frame
after cancellation/named-subscription discrimination, before considering the
pending command. This matches the BSER classifier: no reply-slot consumption,
no retained log queue and no user logger callback. Existing frame limits and
bounded phase diagnostics apply. Malformed non-string log metadata still fails
the connection. `Envelope.log?: string` is the corresponding additive schema
surface; version remains **0.1.0**, raw TypeScript, no build artifacts or npm.

Verification: full client suite **41 pass, 0 fail**, 731 assertions; the new
before/between/after-replies log keeper repeated ten times **10 pass, 0 fail**,
110 assertions; build/typecheck clean. Its progress-subscription handshakes prove
the log was processed while the current command remained unresolved; no sleep
stands in for that ordering. GitHub publication follows this checked checkpoint.
The original extraction account below remains historical, not a claim that the
repository is still unpublished after the authorized follow-up.
The historical source connection/framer/test citations are now bound to the
recorded extraction revision because the consumer cutover replaced/removed their
old local paths.

## Outcome and ownership

`/home/rektide/src/watchman-client-json` now contains a standalone
`watchman-client-json@0.1.0` package. The destination already had a clean jj/git
skeleton (`38c7fb63`, `init`), empty README/entrypoint, package metadata, and empty
pnpm lock. I retained it rather than reinitializing or discarding it. Its existing
remote configuration was not changed. **No push or publication was performed;
either remains a deliberate later human decision.**

This is temporary duplication of the wire implementation, not a consumer cutover.
No file in `effect-watchman`, `effect-watch-plus`, the OpenCode host repository,
or `watchman-esm` was changed. The source checkout's substantive tip was
`a2cae66e57e8f0485cb850590ff1adb3353c0cbe` and its tracked/untracked git status was
clean at inspection.

## Extraction boundary

| In this package | Why |
| --- | --- |
| `src/Connection.ts` | Socket lifecycle, JSON+LF encoding, `pending`/`sendNext` FIFO correlation, separate queue/wire deadlines, cancellation ownership, and subscription dispatch are the transport. |
| `Delivery` in that module | Bounded local delivery with first-error latching and buffer discard is needed by both wire consumers, without choosing their recovery policy. |
| `src/Framing.ts` | S1 framing is inseparable from byte limits and fatal UTF-8 correctness. No algorithm rewrite. |
| `src/Reply.ts` | Exactly the existing acknowledgement/subscription, envelope, query, and config schemas; now also exported types/schema values. |
| `src/Diagnostics.ts` | Tiny internal opt-in attribution retained intact, including bounded samples, to avoid changing the reviewed measurement/counter behavior. Neither diagnostics nor framing is a package export. |

**Out:** recovery supervisor/probes/retry generations, root acquisition/cache and
approval policy, observed inventories/epochs/staging, glob/query construction and
enumeration backends, ignore rules, path validation/event conversion, and Effect
FileSystem/layer adapters. They own domain policy and attachment restoration, not
the socket's reply slot. No recovery code was trivially necessary for the wire
lifetime, so none was extracted.

The source `Connection` exposed a listener map; its higher layers separately
registered callbacks and issued `subscribe`/`unsubscribe`. This package retains
that map and adds only `listen(name, listener) -> detach` as a small convenience
over the same `check`/`set`/`delete` operations. **Attach/detach is local routing,
not wire subscription ownership.** Consumers must issue commands and bounded
cleanup themselves. This avoids inventing a second higher-level subscription
contract, automatic retry, or cleanup policy during extraction.

## Proposed interface decisions for integration

1. **Retain `effect@4.0.1` as an exact peer** (also a dev dependency). Using the
   same Effect v4 Schema decoders preserves validation and unknown-field behavior;
   a dependency-free rewrite was not authorized or needed. No Effect layers or
   platform packages are required by this client.
2. **Keep source-native promise APIs:** `Connection`, `command`, `query`, `config`,
   `connect`, terminal lifecycle methods, `idle`, the listener map, `Delivery`,
   and `SubscriptionCanceled`. Schemas/types are available at the root entrypoint.
   No arbitrary generic command decoder, BSER negotiation, daemon discovery,
   reconnect, or backpressure/yield scheduling is implied.
3. **Keep wire ownership after caller cancellation.** A transmitted subscribe or
   query still owns its FIFO slot and original on-wire deadline. Cleanup queues
   behind it with its own on-wire timeout and sufficient queue budget. Do not
   replace this with eager pending-slot cancellation or abort the whole socket
   merely because one caller lost interest.
4. **Keep failure scopes exact.** Framing/UTF-8/JSON/envelope failures and malformed
   subscription payloads are connection-terminal. Query decode/budget/warning
   failures are operation-local. Named cancellation fails/removes only its
   listener. `Delivery` overflow is local until the integration chooses cleanup.
   Fresh-history and ordinary subscription `error` fields remain data at this
   layer; epoch/reset/typed filesystem failure policy stays above it.
5. **Separate options by owner.** `ConnectionOptions` contains only `socketPath`,
   `connectTimeoutMs`, `requestTimeoutMs`, `queueTimeoutMs`, `maxFrameBytes`, and
   `maxPendingCommands`. Former `cleanupTimeoutMs` and `maxBufferedEvents` belong
   to the integration owner and delivery construction, respectively. A consumer
   owner options type should add those fields explicitly. Structural options
   objects with unrelated policy fields remain usable; only known connection
   limit values are checked.
6. **Raw TypeScript family packaging:** the entrypoint and all relative imports
   use `.ts`; `main`, `types`, and `exports` resolve source; `build` is
   `tsgo --noEmit`. There is no `dist` or emitted declaration contract.

The new constructor carries the former owner's positive-safe-integer validation
for connection limits. These invalid-input checks and `listen` are the only new
behavioral surface; valid transport requests retain the source implementation.
`cleanupTimeoutMs` and `maxBufferedEvents` were not actually read by the source
connection. The README makes connect-once, callback-nonthrowing, JSON-serializable
commands, and single-consumer/non-undefined Delivery usage explicit rather than
adding speculative lifecycle hardening.

## Test port and evidence

All source S1 framing tests are retained in [framing.test.ts](/test/framing.test.ts).
The transport/query suites now call the actual standalone client through the
package root export instead of importing the filesystem integration. Their
scripted-peer fixture is shared in [peer.ts](/test/peer.ts).

The [transport port](/test/transport.test.ts) retains canceled-subscribe cleanup,
mismatched acknowledgements, named cancellation, fatal UTF-8/JSON/schema failures,
split code points/multiple frames, silent request/cleanup deadlines, unsent
cancellation, and Delivery overflow. Filesystem-specific cookie/default-ignore
filtering, manager-owned cached project acquisition, and typed FileSystem failure
projection remain in the source library's suite; reproducing them here would
cross the extraction boundary. Fresh-history is intentionally passed to callers,
not turned into a new transport failure.

The [query port](/test/query-transport.test.ts) retains canceled-query wire ownership
and sibling delivery through oversized/schema/warning failures, string/rich/null
query rows, and terminal request timeout. Approved-root and enumeration-policy
checks stay out. A queued follow-up query is explicitly tested not to transmit
until the abandoned reply arrives.

Additional transport keepers cover queue overflow and independent queue deadline,
explicit listener detachment, sibling-local delivery overflow, config replies,
connect interruption, malformed cancellation, disconnect fanout, and stopping
later same-chunk frames after terminal failure. A handshake releases the UTF-8
remainder only after the subscribe acknowledgement was received; this prevents
the OS from coalescing writes and accidentally avoiding the incomplete-code-point
case. The every-byte socket-write splits are additional end-to-end checks, not a
claim that a kernel preserves every write as a separate read.

Two inexpensive advisory gaps from the G source review are now covered: empty
writes/frames and near-2x direct-segment backing accounting. S1's one-byte/adversarial
linearity proof remains deterministic at the framing layer; there is no claim of
a controlled one-byte kernel read schedule or S2 yielding/backpressure work.

Locally verified with Bun **1.4.4**:

- `WATCH_TEST_DIRECTORY=/tmp/opencode bun test ./test/transport.test.ts ./test/query-transport.test.ts ./test/framing.test.ts` — **40 pass, 0 fail**.
- Same command with `--rerun-each 10` — **400 pass, 0 fail**, 7160 assertions.
- `bun run typecheck` — clean.
- `bun run build` — clean (`tsgo --noEmit`; no output artifacts).
- `pnpm pack --pack-destination .test-agent/package-check` — local tarball
  contains only the root `.ts` entrypoint, four source `.ts` modules, package
  metadata, README/receipt, and LICENSE; no tests, node_modules, or `dist`.
- `rkt check README.md` and `rkt check --okf doc/extraction0.sol61x.md` — passed
  link/structure checks, plus receipt metadata/session provenance.
- Source comparison — `Framing.ts` identical except import extension;
  `Diagnostics.ts` identical; `Connection.connect` through lifecycle methods,
  `request`/`sendNext`/`receive`, and the full `Delivery` class identical.

No real Watchman daemon was required for these transport tests. The prior G
review establishes the extracted source's correctness, not independent approval
of the new public packaging or this receipt. Library rewiring and dual-backend
integration are a later wave.

## Preservation and commits

- `8b4b183f` — `feat: extract JSON-lines watchman wire client from effect-watchman`.
- `21dd360c` — `test: preserve extracted transport and S1 framing contracts`.
- The documentation/public-entrypoint verification commit follows this receipt;
  it does not amend or rewrite those checkpoints.

The original package declared MIT without a license file at its root. This
extraction adds the complete [MIT LICENSE](/LICENSE) with
`Copyright (c) 2026 rektide`, as commissioned; it does not assert a new license
for unrelated source material.
