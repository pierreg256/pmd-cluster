import { EventEmitter } from "node:events";
import { PmdClientOptions, PmdNode, getPmdNodes } from "./pmd-client.js";
import { RingState } from "./state.js";

export interface NodeWatcherOptions {
  pmd: PmdClientOptions;
  state: RingState;
  intervalMs?: number;
  appVersion?: string;
}

export class NodeWatcher extends EventEmitter {
  private pmd: PmdClientOptions;
  private state: RingState;
  private intervalMs: number;
  private appVersion: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private knownNodes: Map<string, PmdNode> = new Map();

  constructor(options: NodeWatcherOptions) {
    super();
    this.pmd = options.pmd;
    this.state = options.state;
    this.intervalMs = options.intervalMs ?? 5000;
    this.appVersion = options.appVersion ?? "0.0.0";
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    // First poll is deferred to next tick so callers can attach listeners first
    setImmediate(() => this.poll());
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  currentPeers(): PmdNode[] {
    return [...this.knownNodes.values()].filter((n) => !n.is_local);
  }

  private async poll(): Promise<void> {
    try {
      const result = await getPmdNodes(this.pmd);
      if ("error" in result) {
        this.emit("error", new Error(result.error));
        return;
      }

      const currentIds = new Set(result.nodes.map((n) => n.node_id));
      const previousIds = new Set(this.knownNodes.keys());

      // Detect joins
      for (const node of result.nodes) {
        if (!previousIds.has(node.node_id)) {
          this.knownNodes.set(node.node_id, node);
          const [host] = node.addr.split(":");
          this.state.addNode(node.node_id, host, 8080, this.appVersion);
          this.emit("join", node);
        }
      }

      // Detect leaves
      for (const [id, node] of this.knownNodes) {
        if (!currentIds.has(id)) {
          this.state.markLeaving(id);
          this.emit("leave", node);
          this.knownNodes.delete(id);
        }
      }
    } catch (err: unknown) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }
}
