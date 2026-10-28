import { expect, test } from "bun:test"
import { Framing } from "../src/Framing.js"
import { capture, measure } from "../src/Diagnostics.js"

const payload = Buffer.from(JSON.stringify({ clock: "c:1", files: [{ name: "café/😀\\escaped\nname", type: "f" }] }))
const wire = Buffer.concat([payload, Buffer.from("\n")])
const decode = (frame: Buffer) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(frame))

test("same JSON frame at every byte split, including UTF-8 and escaped newline", () => {
  for (let split = 0; split <= wire.length; split++) {
    const framing = new Framing(payload.length)
    const frames: unknown[] = []
    const push = (frame: Buffer) => { frames.push(decode(frame)); return true }
    framing.write(wire.subarray(0, split), push)
    framing.write(wire.subarray(split), push)
    expect(frames).toEqual([decode(payload)])
    expect(framing.stats.scannedBytes).toBe(wire.length)
    expect(framing.stats.copiedBytes).toBeLessThanOrEqual(2 * payload.length)
    expect(framing.bufferedBytes).toBe(0)
    expect(framing.retainedBytes).toBe(0)
    expect(framing.segments).toBe(0)
  }
})

test.each([1, 3, 127, 16383, 16384, 16385, 65536])("adversarial %i-byte fragments have linear scan/copy and bounded metadata", (size) => {
  const payload = Buffer.alloc(128 * 1024 + 7, 120)
  const wire = Buffer.concat([payload, Buffer.from("\n")])
  const framing = new Framing(payload.length)
  let frames = 0
  for (let offset = 0; offset < wire.length; offset += size) {
    // Separate backing stores model one-byte socket allocations, not just views.
    framing.write(Buffer.from(wire.subarray(offset, offset + size)), (frame) => {
      expect(frame.equals(payload)).toBe(true); frames++; return true
    })
  }
  expect(frames).toBe(1)
  expect(framing.stats.scannedBytes).toBe(wire.length)
  expect(framing.stats.copiedBytes).toBeLessThanOrEqual(2 * payload.length)
  expect(framing.stats.materializations).toBe(1)
  expect(framing.stats.peakSegments).toBeLessThanOrEqual(Math.ceil(payload.length / framing.pageBytes))
  expect(framing.stats.peakRetainedBytes).toBeLessThanOrEqual(payload.length + framing.pageBytes)
  expect(framing.retainedBytes).toBe(0)
})

test("exact per-frame limit excludes newline; multiple frames do not share a byte limit", () => {
  const framing = new Framing(payload.length)
  const frames: unknown[] = []
  const push = (frame: Buffer) => { frames.push(decode(frame)); return true }
  framing.write(payload, push)
  expect(framing.bufferedBytes).toBe(payload.length)
  framing.write(Buffer.concat([Buffer.from("\n"), wire, wire]), push)
  expect(frames).toEqual([decode(payload), decode(payload), decode(payload)])
  expect(framing.stats.scannedBytes).toBe(wire.length * 3)
  expect(framing.bufferedBytes).toBe(0)
})

test("oversized complete and unfinished frames fail and clear storage", () => {
  for (const delimiter of [false, true]) {
    const framing = new Framing(32)
    framing.write(Buffer.alloc(32, 120), () => true)
    expect(() => framing.write(Buffer.from(delimiter ? "x\n" : "x"), () => true)).toThrow("overflow")
    expect(framing.bufferedBytes).toBe(0)
    expect(framing.retainedBytes).toBe(0)
    expect(framing.segments).toBe(0)
    let delivered = false
    framing.write(Buffer.from("{}\n"), () => { delivered = true; return true })
    expect(delivered).toBe(false)
  }
})

test("tiny leftover does not retain an already consumed huge backing buffer", () => {
  const framing = new Framing(1024 * 1024)
  const backing = Buffer.alloc(1024 * 1024, 120)
  backing[backing.length - 2] = 10
  framing.write(backing, () => true)
  expect(framing.bufferedBytes).toBe(1)
  expect(framing.retainedBytes).toBe(framing.pageBytes)
  expect(framing.segments).toBe(1)
  framing.close()
  expect(framing.retainedBytes).toBe(0)
  expect(framing.segments).toBe(0)
})

test("terminal callback or close prevents later frames publishing", () => {
  for (const explicit of [false, true]) {
    const framing = new Framing(32)
    let delivered = 0
    framing.write(Buffer.from("{}\n{}\npartial"), () => {
      delivered++
      if (explicit) framing.close()
      return explicit
    })
    framing.write(Buffer.from("{}\n"), () => { delivered++; return true })
    expect(delivered).toBe(1)
    expect(framing.bufferedBytes).toBe(0)
    expect(framing.retainedBytes).toBe(0)
  }
})

test("internal diagnostics remain bounded and do not retain frame contents", () => {
  const diagnostic = capture()
  try {
    for (let index = 0; index < 2048; index++) measure("sort", () => undefined, 1, 1)
    expect(diagnostic.result.samples).toHaveLength(512)
    expect(diagnostic.result.droppedSamples).toBe(1536)
    expect(diagnostic.result.phases.sort.calls).toBe(2048)
    expect(diagnostic.result.phases.sort.rows).toBe(2048)
  } finally { diagnostic.stop() }
})

test("large direct segments account for a near-2x backing; oversized backings coalesce instead", () => {
  for (const backingBytes of [32767, 32768, 32769]) {
    const framing = new Framing(65536)
    framing.write(Buffer.allocUnsafeSlow(backingBytes).fill(120).subarray(0, 16384), () => true)
    expect(framing.bufferedBytes).toBe(16384)
    expect(framing.retainedBytes).toBe(backingBytes <= 32768 ? backingBytes : 16384)
    expect(framing.stats.copiedBytes).toBe(backingBytes <= 32768 ? 0 : 16384)
    framing.close()
    expect(framing.retainedBytes).toBe(0)
  }
})

test("empty writes do nothing; empty frames still publish for JSON validation", () => {
  const framing = new Framing(32)
  const frames: Buffer[] = []
  const push = (frame: Buffer) => { frames.push(frame); return true }
  framing.write(Buffer.alloc(0), push)
  expect(frames).toEqual([])
  framing.write(Buffer.from("\n\n"), push)
  expect(frames.map((frame) => frame.length)).toEqual([0, 0])
  expect(framing.stats.scannedBytes).toBe(2)
  expect(framing.stats.copiedBytes).toBe(0)
  expect(framing.stats.materializations).toBe(0)
})
