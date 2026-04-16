import { createServer, Server, Socket } from "node:net";
import {
  FrameType,
  FrameDecoder,
  encodeFrame,
  encodeVvDelta,
  decodeVvDelta,
} from "./codec.js";
import { verifyAuth } from "./auth.js";
import { RingState } from "./state.js";

export class InternalServer {
  private server: Server;
  private port: number;
  private bindAddr: string;
  private cookie: string;
  private state: RingState;
  private connections: Set<Socket> = new Set();

  constructor(
    port: number,
    bindAddr: string,
    cookie: string,
    state: RingState
  ) {
    this.port = port;
    this.bindAddr = bindAddr;
    this.cookie = cookie;
    this.state = state;

    this.server = createServer((socket) => this.handleConnection(socket));
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, this.bindAddr, () => {
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    for (const conn of this.connections) {
      conn.destroy();
    }
    this.connections.clear();
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private handleConnection(socket: Socket): void {
    this.connections.add(socket);
    const decoder = new FrameDecoder();
    let authenticated = false;
    let peerNodeId = "";

    socket.on("data", (chunk) => {
      let frames;
      try {
        frames = decoder.feed(chunk);
      } catch {
        socket.destroy();
        return;
      }

      for (const frame of frames) {
        if (!authenticated) {
          if (frame.type !== FrameType.AUTH) {
            socket.write(
              encodeFrame(
                FrameType.AUTH_FAIL,
                Buffer.from(JSON.stringify({ reason: "auth_required" }))
              )
            );
            socket.destroy();
            return;
          }

          try {
            const auth = JSON.parse(frame.payload.toString());
            const result = verifyAuth(
              this.cookie,
              auth.node_id,
              auth.timestamp,
              auth.hmac
            );

            if (!result.valid) {
              socket.write(
                encodeFrame(
                  FrameType.AUTH_FAIL,
                  Buffer.from(
                    JSON.stringify({ reason: result.reason ?? "auth_failed" })
                  )
                )
              );
              socket.destroy();
              return;
            }

            authenticated = true;
            peerNodeId = auth.node_id;
            socket.write(encodeFrame(FrameType.AUTH_OK));
          } catch {
            socket.write(
              encodeFrame(
                FrameType.AUTH_FAIL,
                Buffer.from(JSON.stringify({ reason: "malformed_auth" }))
              )
            );
            socket.destroy();
            return;
          }
          continue;
        }

        // Authenticated — handle frames
        switch (frame.type) {
          case FrameType.PUSH: {
            const { delta } = decodeVvDelta(frame.payload);
            if (delta.length > 0) {
              this.state.mergeDelta(new Uint8Array(delta));
            }
            // Send PUSH_ACK with our VV
            const ackPayload = encodeVvDelta(
              this.state.versionVector(),
              new Uint8Array(0)
            );
            socket.write(encodeFrame(FrameType.PUSH_ACK, ackPayload));
            break;
          }

          case FrameType.PULL: {
            // Respond with our full delta
            const pullDelta = this.state.deltaSince();
            const pullPayload = encodeVvDelta(
              this.state.versionVector(),
              pullDelta
            );
            socket.write(encodeFrame(FrameType.PULL_RESP, pullPayload));
            break;
          }

          case FrameType.PING: {
            socket.write(encodeFrame(FrameType.PONG));
            break;
          }

          default:
            // Ignore unknown frame types
            break;
        }
      }
    });

    socket.on("close", () => {
      this.connections.delete(socket);
    });

    socket.on("error", () => {
      this.connections.delete(socket);
    });
  }
}
