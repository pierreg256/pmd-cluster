import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer as createNetServer, Server as NetServer } from "node:net";
import { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync } from "node:fs";
import { createApp } from "../../src/app.js";

// ---------------------------------------------------------------------------
// Helper: mock PMD socket + HTTP test client
// ---------------------------------------------------------------------------

function createMockPmd(socketPath: string): Promise<NetServer> {
  return new Promise((resolve) => {
    const server = createNetServer((conn) => {
      let buf = "";
      conn.on("data", (chunk) => {
        buf += chunk.toString();
        const nl = buf.indexOf("\n");
        if (nl !== -1) {
          const line = buf.slice(0, nl);
          const req = JSON.parse(line);
          let resp: unknown;
          if (req === "Status") {
            resp = {
              Status: {
                node_id: "mock-node",
                listen_addr: "127.0.0.1:4369",
                peer_count: 0,
                node_count: 1,
              },
            };
          } else if (req === "Nodes") {
            resp = {
              Nodes: {
                nodes: [
                  {
                    node_id: "mock-node",
                    addr: "127.0.0.1:4369",
                    joined_at: 1000,
                    metadata: {},
                    services: [],
                    phi: null,
                    last_seen_at: null,
                    is_local: true,
                  },
                ],
              },
            };
          } else {
            resp = "Ok";
          }
          conn.write(JSON.stringify(resp) + "\n");
        }
      });
    });
    server.listen(socketPath, () => resolve(server));
  });
}

async function httpGet(
  port: number,
  path: string
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`);
  return {
    status: resp.status,
    headers: Object.fromEntries(resp.headers.entries()),
    body: await resp.text(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HTTP routes", () => {
  const socketPath = join(
    tmpdir(),
    `pmd-test-http-${process.pid}-${Date.now()}.sock`
  );
  let mockPmd: NetServer;
  let app: Server;
  let port: number;

  beforeEach(async () => {
    mockPmd = await createMockPmd(socketPath);
    app = createApp({
      port: 0, // random port
      host: "127.0.0.1",
      machineName: "test-machine",
      pmd: { socketPath },
    });
    await new Promise<void>((resolve) => {
      app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = app.address();
    port =
      typeof addr === "object" && addr !== null ? addr.port : 0;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => app.close(() => resolve()));
    await new Promise<void>((resolve) => {
      mockPmd.close(() => {
        try {
          unlinkSync(socketPath);
        } catch {}
        resolve();
      });
    });
  });

  it("GET / returns Hello from <machine>", async () => {
    const res = await httpGet(port, "/");
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "text/plain");
    assert.equal(res.body, "Hello from test-machine\n");
  });

  it("GET /status returns JSON with machine, status, nodes", async () => {
    const res = await httpGet(port, "/status");
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "application/json");
    const json = JSON.parse(res.body);
    assert.equal(json.machine, "test-machine");
    assert.equal(json.status.node_id, "mock-node");
    assert.equal(json.status.peer_count, 0);
    assert.equal(json.status.node_count, 1);
    assert.equal(json.nodes.nodes.length, 1);
    assert.equal(json.nodes.nodes[0].node_id, "mock-node");
  });

  it("GET /unknown returns 404", async () => {
    const res = await httpGet(port, "/unknown");
    assert.equal(res.status, 404);
    assert.equal(res.body, "Not Found\n");
  });
});
