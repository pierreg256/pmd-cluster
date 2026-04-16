import { createConnection, Socket } from "node:net";
import {
  FrameType,
  FrameDecoder,
  encodeFrame,
  encodeVvDelta,
  decodeVvDelta,
} from "./codec.js";
import { signAuth } from "./auth.js";
import { RingState } from "./state.js";

export interface PeerInfo {
  nodeId: string;
  addr: string;
  port: number;
}

interface PeerConnection {
  socket: Socket;
  decoder: FrameDecoder;
  authenticated: boolean;
  nodeId: string;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  reconnectDelay: number;
}

export class GossipManager {
  private state: RingState;
  private selfNodeId: string;
  private cookie: string;
  private peers: Map<string, PeerConnection> = new Map();
  private pullTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private getPeers: (() => PeerInfo[]) | null = null;
  private pullIntervalMs: number;
  private fanOut: number;

  constructor(
    state: RingState,
    selfNodeId: string,
    cookie: string,
    options?: { pullIntervalMs?: number; fanOut?: number }
  ) {
    this.state = state;
    this.selfNodeId = selfNodeId;
    this.cookie = cookie;
    this.pullIntervalMs = options?.pullIntervalMs ?? 10000;
    this.fanOut = options?.fanOut ?? 2;
  }

  start(getPeers: () => PeerInfo[]): void {
    this.getPeers = getPeers;
    this.pullTimer = setInterval(() => this.pullRound(), this.pullIntervalMs);
    this.pingTimer = setInterval(() => this.pingAll(), 30000);
  }

  stop(): void {
    if (this.pullTimer) {
      clearInterval(this.pullTimer);
      this.pullTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    for (const [, peer] of this.peers) {
      if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer);
      peer.socket.destroy();
    }
    this.peers.clear();
  }

  connectToPeer(addr: string, port: number, nodeId: string): void {
    if (this.peers.has(nodeId)) return;
    this.openConnection(nodeId, addr, port);
  }

  disconnectPeer(nodeId: string): void {
    const peer = this.peers.get(nodeId);
    if (peer) {
      if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer);
      peer.socket.destroy();
      this.peers.delete(nodeId);
    }
  }

  /**
   * Push local state to fan-out random peers. Called on local mutations.
   */
  onLocalMutation(): void {
    const connected = this.getAuthenticatedPeers();
    const targets = this.pickRandom(connected, this.fanOut);
    for (const peer of targets) {
      this.sendPush(peer);
    }
  }

  private openConnection(nodeId: string, addr: string, port: number): void {
    const socket = createConnection({ host: addr, port });
    const decoder = new FrameDecoder();
    const peer: PeerConnection = {
      socket,
      decoder,
      authenticated: false,
      nodeId,
      reconnectDelay: 1000,
    };

    this.peers.set(nodeId, peer);

    socket.on("connect", () => {
      peer.reconnectDelay = 1000; // Reset backoff on successful connect
      // Send AUTH
      const ts = Math.floor(Date.now() / 1000);
      const hmac = signAuth(this.cookie, this.selfNodeId, ts);
      const authPayload = JSON.stringify({
        node_id: this.selfNodeId,
        timestamp: ts,
        hmac,
      });
      socket.write(encodeFrame(FrameType.AUTH, Buffer.from(authPayload)));
    });

    socket.on("data", (chunk) => {
      let frames;
      try {
        frames = decoder.feed(chunk);
      } catch {
        socket.destroy();
        return;
      }

      for (const frame of frames) {
        if (!peer.authenticated) {
          if (frame.type === FrameType.AUTH_OK) {
            peer.authenticated = true;
          } else if (frame.type === FrameType.AUTH_FAIL) {
            socket.destroy();
          }
          continue;
        }

        switch (frame.type) {
          case FrameType.PUSH_ACK: {
            const { delta } = decodeVvDelta(frame.payload);
            if (delta.length > 0) {
              this.state.mergeDelta(new Uint8Array(delta));
            }
            break;
          }
          case FrameType.PULL_RESP: {
            const { delta } = decodeVvDelta(frame.payload);
            if (delta.length > 0) {
              this.state.mergeDelta(new Uint8Array(delta));
            }
            break;
          }
          case FrameType.PONG:
            break;
          default:
            break;
        }
      }
    });

    socket.on("close", () => {
      const existing = this.peers.get(nodeId);
      if (existing && existing.socket === socket) {
        existing.authenticated = false;
        // Auto-reconnect with exponential backoff
        const delay = Math.min(existing.reconnectDelay, 30000);
        existing.reconnectTimer = setTimeout(() => {
          if (this.peers.has(nodeId)) {
            this.openConnection(nodeId, addr, port);
          }
        }, delay);
        existing.reconnectDelay = delay * 2;
      }
    });

    socket.on("error", () => {
      // Will trigger "close" which handles reconnect
    });
  }

  private sendPush(peer: PeerConnection): void {
    const delta = this.state.deltaSince();
    const payload = encodeVvDelta(this.state.versionVector(), delta);
    peer.socket.write(encodeFrame(FrameType.PUSH, payload));
  }

  private sendPull(peer: PeerConnection): void {
    const payload = encodeVvDelta(
      this.state.versionVector(),
      new Uint8Array(0)
    );
    peer.socket.write(encodeFrame(FrameType.PULL, payload));
  }

  private pullRound(): void {
    const connected = this.getAuthenticatedPeers();
    const targets = this.pickRandom(connected, this.fanOut);
    for (const peer of targets) {
      this.sendPull(peer);
    }
  }

  private pingAll(): void {
    for (const [, peer] of this.peers) {
      if (peer.authenticated) {
        peer.socket.write(encodeFrame(FrameType.PING));
      }
    }
  }

  private getAuthenticatedPeers(): PeerConnection[] {
    return [...this.peers.values()].filter((p) => p.authenticated);
  }

  private pickRandom<T>(items: T[], count: number): T[] {
    if (items.length <= count) return items;
    const shuffled = [...items].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }
}
