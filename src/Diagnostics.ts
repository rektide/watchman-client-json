/** Internal, opt-in source attribution. Not exported by the package entrypoint. */
type Phase = "framing" | "copy" | "utf8" | "json" | "envelope" | "schema" | "lexical" | "sort" | "receive"
const phases: Phase[] = ["framing", "copy", "utf8", "json", "envelope", "schema", "lexical", "sort", "receive"]
export function capture() {
  const result = {
    phases: Object.fromEntries(phases.map((phase) => [phase, { calls: 0, bytes: 0, rows: 0, elapsedMs: 0, maxMs: 0 }])) as Record<Phase, { calls: number; bytes: number; rows: number; elapsedMs: number; maxMs: number }>,
    counters: { receivedBytes: 0, copiedBytes: 0, scannedBytes: 0, frames: 0, peakEncodedBytes: 0, peakSegments: 0 },
    samples: [] as Array<{ phase: Phase; start: number; end: number; bytes: number; rows: number }>,
    droppedSamples: 0,
    yields: 0
  }
  active = result
  return { result, stop: () => { if (active === result) active = undefined } }
}
let active: ReturnType<typeof capture>["result"] | undefined
export function begin() { return active ? performance.now() : undefined }
export function end(phase: Phase, start: number | undefined, bytes = 0, rows = 0) {
  if (start === undefined || !active) return
  const finish = performance.now()
  const value = active.phases[phase]
  value.calls++; value.bytes += bytes; value.rows += rows
  value.elapsedMs += finish - start; value.maxMs = Math.max(value.maxMs, finish - start)
  if (active.samples.length < 512) active.samples.push({ phase, start, end: finish, bytes, rows })
  else active.droppedSamples++
}
export function measure<A>(phase: Phase, run: () => A, bytes = 0, rows = 0): A {
  const start = begin()
  try { return run() } finally { end(phase, start, bytes, rows) }
}
export function count(key: "receivedBytes" | "copiedBytes" | "scannedBytes" | "frames", value: number) {
  if (active) active.counters[key] += value
}
export function retained(bytes: number, segments: number) {
  if (!active) return
  active.counters.peakEncodedBytes = Math.max(active.counters.peakEncodedBytes, bytes)
  active.counters.peakSegments = Math.max(active.counters.peakSegments, segments)
}
