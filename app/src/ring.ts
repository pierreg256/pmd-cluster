/**
 * Ring topology helpers.
 *
 * Nodes are ordered by sorted node_id (lexicographic).
 * Each node has a successor (next in ring) and predecessor (previous in ring).
 * The ring wraps around: last node's successor is the first node.
 */

export interface RingPosition {
  successor: string;
  predecessor: string;
}

/**
 * Given a sorted list of node IDs, compute successor and predecessor for each.
 * Returns a Map keyed by node_id.
 */
export function computeRingPositions(
  nodeIds: string[]
): Map<string, RingPosition> {
  const sorted = [...nodeIds].sort();
  const positions = new Map<string, RingPosition>();

  for (let i = 0; i < sorted.length; i++) {
    const predecessor = sorted[(i - 1 + sorted.length) % sorted.length];
    const successor = sorted[(i + 1) % sorted.length];
    positions.set(sorted[i], { successor, predecessor });
  }

  return positions;
}

/**
 * Get successor for a single node in the ring.
 */
export function getSuccessor(nodeId: string, nodeIds: string[]): string {
  const sorted = [...nodeIds].sort();
  const idx = sorted.indexOf(nodeId);
  if (idx === -1) return nodeId;
  return sorted[(idx + 1) % sorted.length];
}

/**
 * Get predecessor for a single node in the ring.
 */
export function getPredecessor(nodeId: string, nodeIds: string[]): string {
  const sorted = [...nodeIds].sort();
  const idx = sorted.indexOf(nodeId);
  if (idx === -1) return nodeId;
  return sorted[(idx - 1 + sorted.length) % sorted.length];
}
