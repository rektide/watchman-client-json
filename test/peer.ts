import { createServer, type Socket } from "node:net"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"

export const until = async (predicate: () => boolean) => {
  const deadline = Date.now() + 3000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Scripted peer condition timed out")
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

export const fixture = async (run: (peer: {
  socketPath: string; directory: string; sockets: Set<Socket>; commands: Array<ReadonlyArray<unknown>>
}) => Promise<void>, respond: (command: ReadonlyArray<unknown>, socket: Socket, directory: string) => void) => {
  const directory = await mkdtemp(join(process.env.WATCH_TEST_DIRECTORY ?? "/tmp/opencode", "watchman-json-peer-"))
  const socketPath = join(directory, "peer.sock")
  const sockets = new Set<Socket>()
  const commands: Array<ReadonlyArray<unknown>> = []
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    let buffer = ""
    socket.on("data", (data) => {
      buffer += data.toString("utf8")
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n")
        const command: ReadonlyArray<unknown> = JSON.parse(buffer.slice(0, end))
        buffer = buffer.slice(end + 1)
        commands.push(command)
        respond(command, socket, directory)
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
  try { await run({ socketPath, directory, sockets, commands }) }
  finally {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}

export const reply = (socket: Socket, value: unknown) => socket.write(JSON.stringify(value) + "\n")
