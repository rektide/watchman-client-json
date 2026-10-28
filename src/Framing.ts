import { count, measure, retained } from "./Diagnostics.ts"

/** Byte framing only. Small fragments occupy pages, not one object per read. */
export class Framing {
  readonly pageBytes = 16 * 1024
  readonly stats = { receivedBytes: 0, scannedBytes: 0, copiedBytes: 0, frames: 0,
    materializations: 0, peakRetainedBytes: 0, peakSegments: 0, peakMaterializedBytes: 0 }
  private parts: Buffer[] = []
  private page: Buffer | undefined
  private used = 0
  private size = 0
  private storage = 0
  private closed = false
  constructor(readonly limit: number) {}

  get bufferedBytes() { return this.size }
  get retainedBytes() { return this.storage }
  get segments() { return this.parts.length + (this.page ? 1 : 0) }

  write(chunk: Buffer, push: (frame: Buffer) => boolean): void {
    if (this.closed) return
    this.stats.receivedBytes += chunk.length
    count("receivedBytes", chunk.length)
    let offset = 0
    while (offset < chunk.length && !this.closed) {
      const newline = measure("framing", () => chunk.indexOf(10, offset), chunk.length - offset)
      const length = (newline < 0 ? chunk.length : newline) - offset
      const scanned = length + (newline < 0 ? 0 : 1)
      this.stats.scannedBytes += scanned
      count("scannedBytes", scanned)
      if (this.size + length > this.limit) { this.close(); throw new Error("Watchman frame overflow") }
      const bytes = chunk.subarray(offset, offset + length)
      if (newline < 0) { this.append(bytes); return }
      // A whole frame already contiguous in this read needs no assembly copy.
      const frame = this.size === 0 ? bytes : this.complete(bytes)
      this.stats.frames++
      count("frames", 1)
      retained(frame.length, this.segments)
      if (!push(frame)) { this.close(); return }
      offset = newline + 1
    }
  }

  close(): void { this.closed = true; this.clear() }

  private complete(tail: Buffer): Buffer {
    this.append(tail)
    const parts = this.page ? [...this.parts, this.page.subarray(0, this.used)] : this.parts
    const frame = measure("copy", () => Buffer.concat(parts, this.size), this.size)
    this.stats.materializations++
    this.stats.peakMaterializedBytes = Math.max(this.stats.peakMaterializedBytes, frame.length)
    this.copied(frame.length)
    this.clear()
    return frame
  }

  private append(bytes: Buffer): void {
    let offset = 0
    while (offset < bytes.length) {
      if (!this.page) {
        const rest = bytes.subarray(offset)
        // Retain substantial segments only when their backing allocation is
        // proportional. In particular, a tiny tail cannot pin a huge read.
        if (rest.length >= this.pageBytes && rest.buffer.byteLength <= rest.length * 2) {
          this.parts.push(rest)
          this.size += rest.length
          this.storage += rest.buffer.byteLength
          this.peak()
          return
        }
        this.page = Buffer.allocUnsafeSlow(Math.min(this.pageBytes, this.limit - this.size))
        this.storage += this.page.length
      }
      const page = this.page
      const length = Math.min(page.length - this.used, bytes.length - offset)
      measure("copy", () => bytes.copy(page, this.used, offset, offset + length), length)
      this.copied(length)
      this.used += length; this.size += length; offset += length
      if (this.used === page.length) { this.parts.push(page); this.page = undefined; this.used = 0 }
      this.peak()
    }
  }

  private copied(bytes: number): void { this.stats.copiedBytes += bytes; count("copiedBytes", bytes) }
  private peak(): void {
    this.stats.peakRetainedBytes = Math.max(this.stats.peakRetainedBytes, this.storage)
    this.stats.peakSegments = Math.max(this.stats.peakSegments, this.segments)
    retained(this.storage, this.segments)
  }
  private clear(): void { this.parts = []; this.page = undefined; this.used = 0; this.size = 0; this.storage = 0 }
}
