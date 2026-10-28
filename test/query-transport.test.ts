import { expect, test } from "bun:test"
import { Connection, Delivery, type Reply } from "watchman-client-json"
import { fixture, reply, until } from "./peer.ts"

test("canceled query retains wire ownership; sibling pushes and query-local failures survive", async () => {
  let mode = "hold"
  await fixture(async (peer) => {
    const connection = new Connection({ socketPath: peer.socketPath, requestTimeoutMs: 1000 })
    const signal = new AbortController().signal
    const events = new Delivery<Reply>(4)
    try {
      await connection.connect(signal)
      const detach = connection.listen("sibling", { push: (value) => events.push(value), fail: (error) => events.fail(error) })
      await connection.command(["subscribe", peer.directory, "sibling", {}], "subscribe", "sibling", signal)
      const controller = new AbortController()
      const canceled = Promise.allSettled([connection.query(["query", peer.directory], controller.signal, 1000, 100)])
      await until(() => peer.commands.some((command) => command[0] === "query"))
      controller.abort()
      expect((await canceled)[0]?.status).toBe("rejected")
      expect(connection.idle).toBe(false)
      expect(peer.sockets.size).toBe(1)
      mode = "large"
      const large = connection.query(["query", peer.directory], signal, 1000, 100)
      const largeResult = Promise.allSettled([large])
      expect(peer.commands.filter((command) => command[0] === "query")).toHaveLength(1)
      const socket = [...peer.sockets][0]
      if (!socket) throw new Error("Missing pending wire owner")
      reply(socket, { clock: "c:1:2", files: [] })
      reply(socket, { subscription: "sibling", files: [{ name: "after-cancel", exists: true, new: true }] })
      expect((await events[Symbol.asyncIterator]().next()).value.files[0].name).toBe("after-cancel")
      const failedLarge = (await largeResult)[0]
      expect(failedLarge?.status).toBe("rejected")
      if (failedLarge?.status === "rejected") expect(String(failedLarge.reason)).toContain("result-byte budget")
      connection.check()
      mode = "bad"
      await expect(connection.query(["query", peer.directory], signal, 1000, 1000)).rejects.toThrow()
      connection.check()
      mode = "warning"
      await expect(connection.query(["query", peer.directory], signal, 1000, 1000)).rejects.toThrow("complete baseline")
      connection.check()
      mode = "error"
      await expect(connection.query(["query", peer.directory], signal, 1000, 1000)).rejects.toThrow("query rejected")
      connection.check()
      mode = "ok"
      expect((await connection.query(["query", peer.directory], signal, 1000, 1000)).files).toEqual([{ name: "kept.ts", type: "f" }])
      expect(connection.listeners.has("sibling")).toBe(true)
      expect(peer.sockets.size).toBe(1)
      detach()
      await connection.command(["unsubscribe", peer.directory, "sibling"], "unsubscribe", "sibling", signal)
    } finally { connection.close() }
  }, (command, socket) => {
    if (command[0] === "subscribe") reply(socket, { subscribe: command[2] })
    if (command[0] === "unsubscribe") reply(socket, { unsubscribe: command[2] })
    if (command[0] !== "query" || mode === "hold") return
    if (mode === "large") { reply(socket, { clock: "c:1:3", files: [{ name: "x".repeat(100), type: "f" }] }); return }
    if (mode === "bad") { reply(socket, { clock: "c:1:4", files: [{ name: "bad", type: null }] }); return }
    if (mode === "warning") { reply(socket, { clock: "c:1:4", files: [], warning: "Permission denied; subtree marked deleted" }); return }
    if (mode === "error") { reply(socket, { error: "query rejected" }); return }
    reply(socket, { clock: "c:1:5", files: [{ name: "kept.ts", type: "f" }] })
  })
})

test("query decoder accepts name strings and rich optional/null fields without subscription-schema loss", async () => {
  const replies = [
    { clock: "c:1:1", is_fresh_instance: true, files: ["name.ts"] },
    { clock: "c:1:2", files: [{ name: "name.ts", type: "f", size: 12, mtime_ms: 1234 }, { name: "null", type: "l", size: null, mtime_ms: null }] }
  ]
  await fixture(async (peer) => {
    const connection = new Connection({ socketPath: peer.socketPath })
    try {
      const signal = new AbortController().signal
      await connection.connect(signal)
      const first = await connection.query(["query"], signal, 1000, 1000)
      expect(first.files).toEqual(["name.ts"])
      expect(first.is_fresh_instance).toBe(true)
      const second = await connection.query(["query"], signal, 1000, 1000)
      expect(second.files).toEqual([{ name: "name.ts", type: "f", size: 12, mtime_ms: 1234 }, { name: "null", type: "l", size: null, mtime_ms: null }])
      await expect(connection.query(["query"], signal, 50, 1000)).rejects.toThrow("timeout")
      expect(() => connection.check()).toThrow("timeout")
    } finally { connection.close() }
  }, (_command, socket) => {
    const response = replies.shift()
    if (response) reply(socket, response)
  })
})

test("query byte budget counts UTF-8 payload bytes, excluding the delimiter, and equality is legal", async () => {
  const value = { clock: "c:1", files: ["café/😀.ts"] }
  const bytes = Buffer.byteLength(JSON.stringify(value))
  await fixture(async (peer) => {
    const connection = new Connection({ socketPath: peer.socketPath, maxFrameBytes: bytes })
    const signal = new AbortController().signal
    try {
      await connection.connect(signal)
      expect(await connection.query(["query"], signal, 1000, bytes)).toEqual(value)
      await expect(connection.query(["query"], signal, 1000, bytes - 1)).rejects.toThrow("result-byte budget")
      connection.check()
      expect(await connection.query(["query"], signal, 1000, bytes)).toEqual(value)
    } finally { connection.close() }
  }, (_command, socket) => reply(socket, value))
})
