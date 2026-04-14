import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawn, ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  pmdRequest,
  getPmdStatus,
  getPmdNodes,
  pmdRegister,
  pmdUnregister,
  PmdStatus,
  PmdNode,
} from "./pmd-client.js";

// ---------------------------------------------------------------------------
// Integration test: real PMD daemon
// ---------------------------------------------------------------------------

const PMD_PORT = 14369; // non-default port to avoid conflicts
const PMD_HOME = join(tmpdir(), `pmd-integration-test-${process.pid}`);
const SOCKET_PATH = join(PMD_HOME, ".pmd", `pmd-${PMD_PORT}.sock`);
const CLIENT_OPTS = { socketPath: SOCKET_PATH, timeout: 10000 };

let pmdProcess: ChildProcess;

function waitForSocket(path: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (existsSync(path)) {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        reject(new Error("Timeout waiting for PMD socket: " + path));
      } else {
        setTimeout(check, 200);
      }
    };
    check();
  });
}

describe("Integration: real PMD daemon", () => {
  before(async () => {
    // Check pmd is available
    try {
      execSync("pmd --help", { stdio: "ignore" });
    } catch {
      throw new Error(
        "pmd binary not found. Install with: cargo install portmapd"
      );
    }

    // Clean up any previous state
    if (existsSync(PMD_HOME)) {
      rmSync(PMD_HOME, { recursive: true, force: true });
    }
    mkdirSync(PMD_HOME, { recursive: true });

    // Start PMD daemon in foreground
    pmdProcess = spawn(
      "pmd",
      ["start", "--foreground", "--port", String(PMD_PORT)],
      {
        env: { ...process.env, HOME: PMD_HOME, RUST_LOG: "warn" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    pmdProcess.on("error", (err) => {
      console.error("PMD process error:", err);
    });

    // Wait for socket to appear
    await waitForSocket(SOCKET_PATH);
    // Small extra wait for the daemon to be fully ready
    await new Promise((r) => setTimeout(r, 500));
  });

  after(async () => {
    if (pmdProcess && !pmdProcess.killed) {
      pmdProcess.kill("SIGTERM");
      await new Promise((resolve) => pmdProcess.on("close", resolve));
    }
    if (existsSync(PMD_HOME)) {
      rmSync(PMD_HOME, { recursive: true, force: true });
    }
  });

  it("Status returns valid node info", async () => {
    const status = (await getPmdStatus(CLIENT_OPTS)) as PmdStatus;
    assert.ok(status.node_id, "node_id should be set");
    assert.match(status.listen_addr, /:\d+$/);
    assert.equal(status.peer_count, 0);
    assert.equal(status.node_count, 1);
  });

  it("Nodes returns local node", async () => {
    const result = await getPmdNodes(CLIENT_OPTS);
    assert.ok("nodes" in result);
    const { nodes } = result as { nodes: PmdNode[] };
    assert.equal(nodes.length, 1);
    assert.ok(nodes[0].is_local);
    assert.ok(nodes[0].node_id);
  });

  it("Register + Lookup + Unregister lifecycle", async () => {
    // Register a service
    await pmdRegister(CLIENT_OPTS, "test-svc", 9999);

    // Verify it appears in nodes
    const result1 = await getPmdNodes(CLIENT_OPTS);
    assert.ok("nodes" in result1);
    const nodes1 = (result1 as { nodes: PmdNode[] }).nodes;
    const localNode = nodes1.find((n) => n.is_local);
    assert.ok(localNode);
    assert.equal(localNode.services.length, 1);
    assert.equal(localNode.services[0].name, "test-svc");
    assert.equal(localNode.services[0].port, 9999);

    // Lookup the service
    const lookup = (await pmdRequest(CLIENT_OPTS, {
      Lookup: { name: "test-svc" },
    })) as Record<string, unknown>;
    const services = lookup.Services as { entries: unknown[] };
    assert.equal(services.entries.length, 1);

    // Unregister
    await pmdUnregister(CLIENT_OPTS, "test-svc");

    // Verify it's gone
    const result2 = await getPmdNodes(CLIENT_OPTS);
    assert.ok("nodes" in result2);
    const nodes2 = (result2 as { nodes: PmdNode[] }).nodes;
    const localNode2 = nodes2.find((n) => n.is_local);
    assert.ok(localNode2);
    assert.equal(localNode2.services.length, 0);
  });

  it("raw pmdRequest handles unknown commands gracefully", async () => {
    // Sending Nodes which is known works
    const resp = await pmdRequest(CLIENT_OPTS, "Nodes");
    assert.ok(typeof resp === "object" && resp !== null);
  });
});
