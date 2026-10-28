import { expect, test } from "bun:test"
import type { Socket } from "node:net"
import { Connection, Delivery, SubscriptionCanceled, type Reply } from "../watchman-client-json.ts"
import { fixture, reply, until } from "./peer.ts"

test("construction validates the former owner boundary's socket and limits", () => {
  for (const options of [{ socketPath: "" }, { socketPath: "socket", maxFrameBytes: 0 },
    { socketPath: "socket", requestTimeoutMs: Infinity }, { socketPath: "socket", maxPendingCommands: 1.5 }]) {
    expect(() => new Connection(options)).toThrow("positive finite integer")
  }
  const ownerOptions = { socketPath: "socket", defaultIgnores: false, approvedRoots: ["root"] }
  expect(new Connection(ownerOptions).options.socketPath).toBe("socket")
})

test("command encoding is newline JSON; typed acknowledgements and config are preserved", async () => {
  await fixture(async (peer) => {
    const connection = new Connection({ socketPath: peer.socketPath })
    const signal = new AbortController().signal
    try {
      await connection.connect(signal)
      expect(connection.idle).toBe(true)
      expect((await connection.command(["watch-project", "café\nroot"], "watch", undefined, signal)).watch).toBe(peer.directory)
      expect(await connection.config(peer.directory, signal)).toEqual({ config: { ignore_dirs: ["build"], ignore_vcs: [] } })
      expect(peer.commands).toEqual([["watch-project", "café\nroot"], ["get-config", peer.directory]])
      expect(connection.idle).toBe(true)
    } finally { connection.close() }
  }, (command, socket, directory) => reply(socket, command[0] === "get-config"
    ? { config: { ignore_dirs: ["build"], ignore_vcs: [] } } : { watch: directory }))
})

test("already-interrupted connect is terminal and failure notification is latched", async () => {
  await fixture(async (peer) => {
    const failures: Error[] = []
    const connection = new Connection({ socketPath: peer.socketPath }, (error) => failures.push(error))
    const controller = new AbortController()
    controller.abort()
    await expect(connection.connect(controller.signal)).rejects.toThrow("interrupted")
    connection.close()
    expect(failures).toHaveLength(1)
    expect(() => connection.check()).toThrow("interrupted")
  }, () => undefined)
})

test("interrupted delayed subscribe B retains wire ownership for cleanup without harming A", async () => {
  await fixture(async (peer) => {
    const connection = new Connection({ socketPath: peer.socketPath, requestTimeoutMs: 1000 })
    const signal = new AbortController().signal
    const a = new Delivery<Reply>(4)
    const b: Reply[] = []
    try {
      await connection.connect(signal)
      const detachA = connection.listen("A", { push: (value) => a.push(value), fail: (error) => a.fail(error) })
      await connection.command(["subscribe", peer.directory, "A", {}], "subscribe", "A", signal)
      const detachB = connection.listen("B", { push: (value) => b.push(value), fail: () => {} })
      const controller = new AbortController()
      const attaching = Promise.allSettled([connection.command(["subscribe", peer.directory, "B", {}], "subscribe", "B", controller.signal)])
      await until(() => peer.commands.length === 2)
      controller.abort()
      expect((await attaching)[0]?.status).toBe("rejected")
      detachB()
      const cleanup = connection.command(["unsubscribe", peer.directory, "B"], "unsubscribe", "B", signal, 100, 1100)
      expect(connection.idle).toBe(false)
      expect(peer.commands.map((command) => command[0])).toEqual(["subscribe", "subscribe"])
      const socket = [...peer.sockets][0]
      if (!socket) throw new Error("healthy sibling socket was destroyed")
      reply(socket, { subscribe: "B" })
      reply(socket, { subscription: "B", files: [{ name: "late-b", exists: true }] })
      reply(socket, { subscription: "A", files: [{ name: "a-alive", exists: true }] })
      await cleanup
      expect((await a[Symbol.asyncIterator]().next()).value.files[0].name).toBe("a-alive")
      expect(b).toEqual([])
      expect(peer.sockets.size).toBe(1)
      detachA()
      await connection.command(["unsubscribe", peer.directory, "A"], "unsubscribe", "A", signal)
      expect(connection.listeners.size).toBe(0)
      expect(peer.commands.filter((command) => command[0] === "unsubscribe")).toHaveLength(2)
    } finally { connection.close() }
    await until(() => peer.sockets.size === 0)
  }, (command, socket) => {
    if (command[0] === "subscribe" && command[2] === "A") reply(socket, { subscribe: "A" })
    if (command[0] === "unsubscribe") reply(socket, { unsubscribe: command[2] })
  })
})

test("rejected subscription can detach and unsubscribe while a sibling survives", async () => {
  await fixture(async (peer) => {
    const connection = new Connection({ socketPath: peer.socketPath })
    const signal = new AbortController().signal
    try {
      await connection.connect(signal)
      connection.listen("A", { push: () => {}, fail: () => {} })
      const detach = connection.listen("B", { push: () => {}, fail: () => {} })
      await expect(connection.command(["subscribe", "root", "B", {}], "subscribe", "B", signal)).rejects.toThrow("attach rejected")
      detach()
      await connection.command(["unsubscribe", "root", "B"], "unsubscribe", "B", signal)
      expect(connection.listeners.has("A")).toBe(true)
      expect(connection.listeners.has("B")).toBe(false)
      connection.check()
    } finally { connection.close() }
  }, (command, socket) => reply(socket, command[0] === "subscribe" ? { error: "attach rejected" } : { unsubscribe: command[2] }))
})

test("mismatched reply settles outstanding AND queued commands without losing pending owner", async () => {
  await fixture(async (peer) => {
    const connection = new Connection({ socketPath: peer.socketPath, requestTimeoutMs: 1000 })
    try {
      const signal = new AbortController().signal
      await connection.connect(signal)
      const results = await Promise.allSettled([
        connection.command(["clock", "root"], "clock", undefined, signal),
        connection.command(["clock", "root"], "clock", undefined, signal)
      ])
      expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"])
      for (const result of results) if (result.status === "rejected") expect(String(result.reason)).toContain("mismatched clock")
      await until(() => peer.sockets.size === 0)
      expect(peer.commands).toHaveLength(1)
    } finally { connection.close() }
  }, (_command, socket) => reply(socket, { subscribe: "wrong" }))
})

test("unilateral cancellation wins before push discrimination and fails only its subscription", async () => {
  await fixture(async (peer) => {
    const connection = new Connection({ socketPath: peer.socketPath })
    const signal = new AbortController().signal
    const failures: Error[] = []
    const values: Reply[] = []
    try {
      await connection.connect(signal)
      connection.listen("A", { fail: (error) => failures.push(error), push: () => { throw new Error("canceled frame was delivered") } })
      connection.listen("B", { fail: () => { throw new Error("sibling was canceled") }, push: (value) => values.push(value) })
      await connection.command(["clock"], "clock", undefined, signal)
      await until(() => failures.length === 1 && values.length === 1)
      expect(failures[0]).toBeInstanceOf(SubscriptionCanceled)
      expect(connection.listeners.has("A")).toBe(false)
      expect(connection.listeners.has("B")).toBe(true)
      connection.check()
      connection.listeners.clear()
    } finally { connection.close() }
  }, (_command, socket) => {
    reply(socket, { clock: "c:1" })
    reply(socket, { unilateral: true, subscription: "A", canceled: true, files: [] })
    reply(socket, { subscription: "B", files: [{ name: "survivor", exists: true }] })
  })
})

test("split UTF-8 and multiple JSON frames preserve push delivery", async () => {
  let remainder: { socket: Socket; bytes: Buffer } | undefined
  await fixture(async (peer) => {
    const connection = new Connection({ socketPath: peer.socketPath })
    const signal = new AbortController().signal
    const events: Reply[] = []
    try {
      await connection.connect(signal)
      connection.listen("split", { push: (value) => events.push(value), fail: () => {} })
      await connection.command(["subscribe", "root", "split", {}], "subscribe", "split", signal)
      // The acknowledgement shares the first write with an unfinished code point.
      // Release the rest only after it was received, so writes cannot coalesce.
      expect(events).toEqual([])
      if (!remainder) throw new Error("Missing split-frame remainder")
      remainder.socket.write(remainder.bytes)
      await until(() => events.length === 2)
      expect(events).toEqual([
        { subscription: "split", files: [{ name: "café/😀", exists: true, new: true }] },
        { subscription: "split", files: [{ name: "gone", exists: false }] }
      ])
    } finally { connection.close() }
  }, (command, socket) => {
    const frames = Buffer.from(JSON.stringify({ subscribe: command[2] }) + "\n" +
      JSON.stringify({ subscription: command[2], files: [{ name: "café/😀", exists: true, new: true }] }) + "\n" +
      JSON.stringify({ subscription: command[2], files: [{ name: "gone", exists: false }] }) + "\n")
    const split = frames.indexOf(Buffer.from("é")) + 1
    remainder = { socket, bytes: frames.subarray(split) }
    socket.write(frames.subarray(0, split))
  })
})

test("every UTF-8 byte split traverses the socket client with exact frame-byte limits", async () => {
  const value = { clock: "c:café/😀\\escaped\nname" }
  const payload = Buffer.from(JSON.stringify(value))
  const wire = Buffer.concat([payload, Buffer.from("\n")])
  let split = 0
  await fixture(async (peer) => {
    const connection = new Connection({ socketPath: peer.socketPath, maxFrameBytes: payload.length })
    const signal = new AbortController().signal
    try {
      await connection.connect(signal)
      for (split = 0; split <= wire.length; split++) {
        expect(await connection.command(["clock"], "clock", value.clock, signal)).toEqual(value)
      }
    } finally { connection.close() }
  }, (_command, socket) => socket.write(wire.subarray(0, split), () => socket.write(wire.subarray(split))))
})

test("malformed JSON/schema/UTF-8 and oversized complete/unfinished frames latch terminal failure", async () => {
  for (const data of [Buffer.from("not JSON\n"), Buffer.from("\n"), Buffer.from('{"clock":123}\n'),
    Buffer.from('{"subscription":123}\n'), Buffer.from([123, 34, 255, 34, 58, 49, 125, 10]),
    Buffer.from("x".repeat(33)), Buffer.from("x".repeat(33) + "\n")]) {
    await fixture(async (peer) => {
      const connection = new Connection({ socketPath: peer.socketPath, maxFrameBytes: 32, requestTimeoutMs: 1000 })
      const failures: Error[] = []
      try {
        const signal = new AbortController().signal
        await connection.connect(signal)
        connection.listen("sibling", { push: () => {}, fail: (error) => failures.push(error) })
        const results = await Promise.allSettled([connection.command(["clock"], "clock", undefined, signal)])
        expect(results[0]?.status).toBe("rejected")
        expect(() => connection.check()).toThrow()
        expect(failures).toHaveLength(1)
        expect(connection.listeners.size).toBe(0)
        await until(() => peer.sockets.size === 0)
      } finally { connection.close() }
    }, (_command, socket) => socket.write(data))
  }
})

test("malformed subscription schema and cancellation without a name are connection-terminal", async () => {
  for (const value of [{ subscription: "A", files: [{ name: "bad", exists: 1 }] }, { canceled: true }]) {
    await fixture(async (peer) => {
      const connection = new Connection({ socketPath: peer.socketPath })
      const failures: Error[] = []
      const signal = new AbortController().signal
      try {
        await connection.connect(signal)
        connection.listen("A", { push: () => {}, fail: (error) => failures.push(error) })
        connection.listen("B", { push: () => {}, fail: (error) => failures.push(error) })
        await expect(connection.command(["clock"], "clock", undefined, signal)).rejects.toThrow()
        expect(failures).toHaveLength(2)
        await until(() => peer.sockets.size === 0)
      } finally { connection.close() }
    }, (_command, socket) => reply(socket, value))
  }
})

test("silent wire request still reaches terminal deadline after caller cancellation", async () => {
  for (const cancel of [false, true]) {
    await fixture(async (peer) => {
      const connection = new Connection({ socketPath: peer.socketPath, requestTimeoutMs: 50 })
      try {
        const controller = new AbortController()
        await connection.connect(controller.signal)
        const settled = Promise.allSettled([
          connection.command(["clock"], "clock", undefined, controller.signal),
          connection.command(["clock"], "clock", undefined, controller.signal)
        ])
        await until(() => peer.commands.length === 1)
        if (cancel) {
          controller.abort()
          connection.check()
          expect(connection.idle).toBe(false)
        }
        expect((await settled).map((result) => result.status)).toEqual(["rejected", "rejected"])
        await until(() => peer.sockets.size === 0)
        expect(() => connection.check()).toThrow("timeout")
      } finally { connection.close() }
    }, () => undefined)
  }
})

test("interrupted subscribe with silent wire reply retains bounded cleanup", async () => {
  await fixture(async (peer) => {
    const connection = new Connection({ socketPath: peer.socketPath, requestTimeoutMs: 50 })
    const controller = new AbortController()
    try {
      await connection.connect(controller.signal)
      const detach = connection.listen("silent", { push: () => {}, fail: () => {} })
      const attaching = Promise.allSettled([connection.command(["subscribe", "root", "silent", {}], "subscribe", "silent", controller.signal)])
      await until(() => peer.commands.length === 1)
      controller.abort()
      await attaching
      detach()
      await expect(connection.command(["unsubscribe", "root", "silent"], "unsubscribe", "silent", new AbortController().signal, 50, 100)).rejects.toThrow("timeout")
      await until(() => peer.sockets.size === 0)
      expect(peer.commands).toHaveLength(1)
    } finally { connection.close() }
  }, () => undefined)
})

test("silent unsubscribe cannot hang explicit cleanup", async () => {
  await fixture(async (peer) => {
    const connection = new Connection({ socketPath: peer.socketPath })
    const signal = new AbortController().signal
    try {
      await connection.connect(signal)
      const detach = connection.listen("silent", { push: () => {}, fail: () => {} })
      await connection.command(["subscribe", "root", "silent", {}], "subscribe", "silent", signal)
      detach()
      await expect(connection.command(["unsubscribe", "root", "silent"], "unsubscribe", "silent", signal, 50, 100)).rejects.toThrow("timeout")
      await until(() => peer.sockets.size === 0)
    } finally { connection.close() }
  }, (command, socket) => { if (command[0] === "subscribe") reply(socket, { subscribe: command[2] }) })
})

test("bounded delivery overflow discards buffered hints and latches failure", async () => {
  const delivery = new Delivery<number>(1)
  delivery.push(1)
  delivery.push(2)
  const iterator = delivery[Symbol.asyncIterator]()
  await expect(iterator.next()).rejects.toThrow("overflow")
  delivery.push(3)
  delivery.fail(new Error("later cleanup must not replace loss"))
  await expect(iterator.next()).rejects.toThrow("overflow")
})

test("delivery resolves waiting readers and return latches closure", async () => {
  const delivery = new Delivery<number>(1)
  const iterator = delivery[Symbol.asyncIterator]()
  const next = iterator.next()
  delivery.push(1)
  expect(await next).toEqual({ done: false, value: 1 })
  await iterator.return?.()
  await expect(iterator.next()).rejects.toThrow("closed")
})

test("delivery overflow is subscription-local until its owner chooses cleanup", async () => {
  await fixture(async (peer) => {
    const connection = new Connection({ socketPath: peer.socketPath })
    const signal = new AbortController().signal
    const a = new Delivery<Reply>(1)
    const b = new Delivery<Reply>(1)
    try {
      await connection.connect(signal)
      connection.listen("A", { push: (value) => a.push(value), fail: (error) => a.fail(error) })
      connection.listen("B", { push: (value) => b.push(value), fail: (error) => b.fail(error) })
      await connection.command(["clock"], "clock", undefined, signal)
      await until(() => peer.commands.length === 1)
      const socket = [...peer.sockets][0]
      if (!socket) throw new Error("Missing peer")
      reply(socket, { subscription: "A", files: [] })
      reply(socket, { subscription: "A", files: [] })
      reply(socket, { subscription: "B", files: [] })
      expect((await b[Symbol.asyncIterator]().next()).value.subscription).toBe("B")
      await expect(a[Symbol.asyncIterator]().next()).rejects.toThrow("overflow")
      connection.check()
      expect(peer.sockets.size).toBe(1)
    } finally { connection.close() }
  }, (_command, socket) => reply(socket, { clock: "c:1" }))
})

test("unsent cancellation skips only its command and frees bounded queue capacity", async () => {
  await fixture(async (peer) => {
    const connection = new Connection({ socketPath: peer.socketPath, requestTimeoutMs: 1000, maxPendingCommands: 2 })
    try {
      const signal = new AbortController().signal
      await connection.connect(signal)
      const first = connection.command(["clock", "first"], "clock", undefined, signal)
      await until(() => peer.commands.length === 1)
      const controller = new AbortController()
      const cancellation = Promise.allSettled([connection.command(["clock", "never-sent"], "clock", undefined, controller.signal)])
      controller.abort()
      expect((await cancellation)[0]?.status).toBe("rejected")
      const third = connection.command(["clock", "third"], "clock", undefined, signal)
      expect(peer.sockets.size).toBe(1)
      expect(peer.commands).toEqual([["clock", "first"]])
      const socket = [...peer.sockets][0]
      if (!socket) throw new Error("unsent cancellation destroyed socket")
      reply(socket, { clock: "c:first" })
      expect((await first).clock).toBe("c:first")
      expect((await third).clock).toBe("c:third")
      expect(peer.commands).toEqual([["clock", "first"], ["clock", "third"]])
      const alreadyCanceled = new AbortController()
      alreadyCanceled.abort()
      await expect(connection.command(["clock", "also-never-sent"], "clock", undefined, alreadyCanceled.signal)).rejects.toThrow("before transmission")
      connection.check()
    } finally { connection.close() }
    await until(() => peer.sockets.size === 0)
  }, (command, socket) => { if (command[1] === "third") reply(socket, { clock: "c:third" }) })
})

test("bounded command queue overflow fails outstanding, queued and new callers", async () => {
  await fixture(async (peer) => {
    const connection = new Connection({ socketPath: peer.socketPath, maxPendingCommands: 2 })
    const signal = new AbortController().signal
    try {
      await connection.connect(signal)
      const results = await Promise.allSettled([1, 2, 3].map(() => connection.command(["clock"], "clock", undefined, signal)))
      for (const result of results) {
        expect(result.status).toBe("rejected")
        if (result.status === "rejected") expect(String(result.reason)).toContain("queue overflow")
      }
      expect(() => connection.check()).toThrow("queue overflow")
    } finally { connection.close() }
  }, () => undefined)
})

test("queue deadline is terminal independently of a longer active request deadline", async () => {
  await fixture(async (peer) => {
    const connection = new Connection({ socketPath: peer.socketPath })
    const signal = new AbortController().signal
    try {
      await connection.connect(signal)
      const results = await Promise.allSettled([
        connection.command(["clock", "first"], "clock", undefined, signal, 1000, 1000),
        connection.command(["clock", "queued"], "clock", undefined, signal, 1000, 50)
      ])
      expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"])
      expect(peer.commands).toEqual([["clock", "first"]])
      expect(() => connection.check()).toThrow("timeout")
    } finally { connection.close() }
  }, () => undefined)
})

test("socket disconnect fails commands and all listeners without implicit recovery", async () => {
  await fixture(async (peer) => {
    const failures: Error[] = []
    const connection = new Connection({ socketPath: peer.socketPath })
    const signal = new AbortController().signal
    try {
      await connection.connect(signal)
      connection.listen("A", { push: () => {}, fail: (error) => failures.push(error) })
      connection.listen("B", { push: () => {}, fail: (error) => failures.push(error) })
      await expect(connection.command(["clock"], "clock", undefined, signal)).rejects.toThrow("socket closed")
      expect(failures).toHaveLength(2)
      expect(connection.listeners.size).toBe(0)
      await until(() => peer.sockets.size === 0)
    } finally { connection.close() }
  }, (_command, socket) => socket.end())
})

test("unsolicited response is terminal and stops subsequent frames from the same chunk", async () => {
  await fixture(async (peer) => {
    const connection = new Connection({ socketPath: peer.socketPath })
    const signal = new AbortController().signal
    const values: Reply[] = []
    try {
      await connection.connect(signal)
      connection.listen("A", { push: (value) => values.push(value), fail: () => {} })
      await connection.command(["clock"], "clock", undefined, signal)
      await until(() => peer.sockets.size === 0)
      expect(() => connection.check()).toThrow("unsolicited")
      expect(values).toEqual([])
    } finally { connection.close() }
  }, (_command, socket) => socket.write('{"clock":"c:1"}\n{"clock":"c:2"}\n{"subscription":"A","files":[]}\n'))
})
