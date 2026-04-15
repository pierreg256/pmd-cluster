import { WasmCrdtDoc } from "concordat";
import { computeRingPositions } from "./ring.js";

export interface NodeEntry {
  addr: string;
  port: number;
  joined_at: number;
  status: "active" | "leaving" | "dead";
  version: string;
  successor: string;
  predecessor: string;
}

export interface RingMeta {
  cluster_name: string;
  ring_version: number;
}

export interface RingSnapshot {
  ring: Record<string, NodeEntry>;
  meta: RingMeta;
  kv: Record<string, unknown>;
}

export class RingState {
  private doc: WasmCrdtDoc;
  private ringVersion: number;

  constructor(replicaId: string, clusterName: string = "pmd-cluster-prod") {
    this.doc = new WasmCrdtDoc(replicaId);
    this.ringVersion = 0;

    // Initialize meta
    this.doc.set("/meta/cluster_name", clusterName);
    this.doc.set("/meta/ring_version", 0);
  }

  get replicaId(): string {
    return this.doc.replicaId();
  }

  /**
   * Register a node in the ring. Only the owning node should call this
   * for its own node_id.
   */
  addNode(
    nodeId: string,
    addr: string,
    port: number,
    version: string
  ): void {
    this.doc.set(`/ring/${nodeId}/addr`, addr);
    this.doc.set(`/ring/${nodeId}/port`, port);
    this.doc.set(`/ring/${nodeId}/joined_at`, Math.floor(Date.now() / 1000));
    this.doc.set(`/ring/${nodeId}/status`, "active");
    this.doc.set(`/ring/${nodeId}/version`, version);
    this.recomputeTopology();
  }

  /**
   * Mark a node as leaving. Called when PMD reports a node departure.
   */
  markLeaving(nodeId: string): void {
    this.doc.set(`/ring/${nodeId}/status`, "leaving");
    this.recomputeTopology();
  }

  /**
   * Remove a node from the ring entirely.
   */
  removeNode(nodeId: string): void {
    this.doc.remove(`/ring/${nodeId}`);
    this.recomputeTopology();
  }

  /**
   * Recompute successor/predecessor for all active nodes and bump ring_version.
   */
  private recomputeTopology(): void {
    const snapshot = this.doc.materialize() as Partial<RingSnapshot>;
    const ring = snapshot.ring ?? {};
    const activeIds = Object.keys(ring).filter(
      (id) => ring[id]?.status === "active"
    );

    const positions = computeRingPositions(activeIds);
    for (const [id, pos] of positions) {
      this.doc.set(`/ring/${id}/successor`, pos.successor);
      this.doc.set(`/ring/${id}/predecessor`, pos.predecessor);
    }

    this.ringVersion++;
    this.doc.set("/meta/ring_version", this.ringVersion);
  }

  /**
   * Set a key in the shared kv store.
   */
  kvSet(key: string, value: unknown): void {
    this.doc.set(`/kv/${key}`, value);
  }

  /**
   * Remove a key from the shared kv store.
   */
  kvRemove(key: string): void {
    this.doc.remove(`/kv/${key}`);
  }

  /**
   * Get a key from the shared kv store.
   */
  kvGet(key: string): unknown {
    const snapshot = this.doc.materialize() as Partial<RingSnapshot>;
    return (snapshot.kv ?? {})[key];
  }

  /**
   * Materialize the full document state.
   */
  materialize(): RingSnapshot {
    const raw = this.doc.materialize() as Partial<RingSnapshot>;
    return {
      ring: raw.ring ?? {},
      meta: raw.meta ?? { cluster_name: "", ring_version: 0 },
      kv: raw.kv ?? {},
    };
  }

  /**
   * Get the ring topology only.
   */
  getRing(): Record<string, NodeEntry> {
    return this.materialize().ring;
  }

  /**
   * Get a single node entry.
   */
  getNode(nodeId: string): NodeEntry | undefined {
    return this.materialize().ring[nodeId];
  }

  /**
   * Get all kv entries.
   */
  getKv(): Record<string, unknown> {
    return this.materialize().kv;
  }

  /**
   * Produce a delta (opaque bytes) for gossip.
   */
  deltaSince(sinceBytes?: Uint8Array): Uint8Array {
    return this.doc.deltaSince(sinceBytes);
  }

  /**
   * Merge a remote delta into this document.
   */
  mergeDelta(bytes: Uint8Array): void {
    this.doc.mergeDelta(bytes);
  }

  /**
   * Get the version vector as opaque bytes.
   */
  versionVector(): Uint8Array {
    return this.doc.versionVector();
  }

  /**
   * List active node IDs in ring order.
   */
  activeNodeIds(): string[] {
    const ring = this.getRing();
    return Object.keys(ring)
      .filter((id) => ring[id]?.status === "active")
      .sort();
  }
}
