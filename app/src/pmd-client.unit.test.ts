import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync } from "node:fs";
import {
  pmdRequest,
  getPmdStatus,
  getPmdNodes,
  pmdRegister,
  pmdUnregister,
} from "./pmd-client.js";

// ---------------------------------------------------------------------------
// Helper: mock PMD socket server
// ---------------------------------------------------------------------------

function createMockPmd(
  socketPath: string,
  handler: (req: unknown) => unknown
): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((conn) => {
      let buf = "";
      conn.on("data", (chunk) => {
        buf += chunk.toString();
        const nl = buf.indexOf("\n");
        if (nl !== -1) {
          const line = buf.slice(0, nl);
          const request = JSON.parse(line);
          const response = handler(request);
          conn.write(JSON.stringify(response) + "\n");
        }
      });
    });
    server.listen(socketPath, () => resolve(server));
  });
}

function closeMockPmd(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      try {
        unlinkSync(socketPath);
      } catch {}
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pmdRequest", () => {
  const socketPath = join(
    tmpdir(),
    `pmd-test-${process.pid}-${Date.now()}.sock`
  );
  let mockServer: Server;

  beforeEach(async () => {
    mockServer = await createMockPmd(socketPath, (req) => {
      if (req === "Status") {
        return {
          Status: {
            node_id: "test-node-1",
            listen_addr: "127.0.0.1:4369",
            peer_count: 0,
            node_count: 1,
          },
        };
      }
      if (req === "Nodes") {
        return {
          Nodes: {
            nodes: [
              {
                node_id: "test-node-1",
                addr: "127.0.0.1:4369",
                joined_at: 1000,
                metadata: { role: "test" },
                services: [],
                phi: null,
                last_seen_at: null,
                is_local: true,
              },
            ],
          },
        };
      }
      if (typeof req === "object" && req !== null && "Register" in req) {
        return "Ok";
      }
      if (typeof req === "object" && req !== null && "Unregister" in req) {
        return "Ok";
      }
      if (typeof req === "object" && req !== null && "Lookup" in req) {
        return { Services: { entries: [] } };
      }
      return "Ok";
    });
  });

  afterEach(async () => {
    await closeMockPmd(mockServer, socketPath);
  });

  it("sends Status and parses response", async () => {
    const resp = await pmdRequest({ socketPath }, "Status");
    assert.deepStrictEqual(resp, {
      Status: {
        node_id: "test-node-1",
        listen_addr: "127.0.0.1:4369",
        peer_count: 0,
        node_count: 1,
      },
    });
  });

  it("sends Nodes and parses response", async () => {
    const resp = (await pmdRequest({ socketPath }, "Nodes")) as Record<
      string,
      unknown
    >;
    const nodes = resp.Nodes as { nodes: unknown[] };
    assert.equal(nodes.nodes.length, 1);
  });

  it("sends Register and receives Ok", async () => {
    const resp = await pmdRequest({ socketPath }, {
      Register: { name: "myapp", port: 9090, metadata: {} },
    });
    assert.equal(resp, "Ok");
  });

  it("sends Unregister and receives Ok", async () => {
    const resp = await pmdRequest({ socketPath }, {
      Unregister: { name: "myapp" },
    });
    assert.equal(resp, "Ok");
  });

  it("rejects on connection error for non-existent socket", async () => {
    await assert.rejects(
      () => pmdRequest({ socketPath: "/tmp/nonexistent.sock" }, "Status"),
      (err: Error) => {
        assert.match(err.message, /PMD socket error/);
        return true;
      }
    );
  });
});

describe("getPmdStatus", () => {
  const socketPath = join(
    tmpdir(),
    `pmd-test-status-${process.pid}-${Date.now()}.sock`
  );
  let mockServer: Server;

  beforeEach(async () => {
    mockServer = await createMockPmd(socketPath, (req) => {
      if (req === "Status") {
        return {
          Status: {
            node_id: "abc-123",
            listen_addr: "10.0.0.1:4369",
            peer_count: 2,
            node_count: 3,
          },
        };
      }
      return "Ok";
    });
  });

  afterEach(async () => {
    await closeMockPmd(mockServer, socketPath);
  });

  it("returns unwrapped Status object", async () => {
    const status = await getPmdStatus({ socketPath });
    assert.deepStrictEqual(status, {
      node_id: "abc-123",
      listen_addr: "10.0.0.1:4369",
      peer_count: 2,
      node_count: 3,
    });
  });

  it("returns error object when socket is unavailable", async () => {
    const status = await getPmdStatus({ socketPath: "/tmp/bad.sock" });
    assert.ok("error" in status);
  });
});

describe("getPmdNodes", () => {
  const socketPath = join(
    tmpdir(),
    `pmd-test-nodes-${process.pid}-${Date.now()}.sock`
  );
  let mockServer: Server;

  beforeEach(async () => {
    mockServer = await createMockPmd(socketPath, (req) => {
      if (req === "Nodes") {
        return {
          Nodes: {
            nodes: [
              {
                node_id: "n1",
                addr: "10.0.0.1:4369",
                joined_at: 100,
                metadata: {},
                services: [
                  {
                    name: "web",
                    node_id: "n1",
                    host: "10.0.0.1",
                    port: 8080,
                    metadata: {},
                  },
                ],
                phi: null,
                last_seen_at: null,
                is_local: true,
              },
              {
                node_id: "n2",
                addr: "10.0.0.2:4369",
                joined_at: 200,
                metadata: {},
                services: [],
                phi: 0.5,
                last_seen_at: 300,
                is_local: false,
              },
            ],
          },
        };
      }
      return "Ok";
    });
  });

  afterEach(async () => {
    await closeMockPmd(mockServer, socketPath);
  });

  it("returns unwrapped Nodes with services", async () => {
    const result = await getPmdNodes({ socketPath });
    assert.ok("nodes" in result);
    const { nodes } = result as { nodes: unknown[] };
    assert.equal(nodes.length, 2);
  });

  it("returns error object when socket is unavailable", async () => {
    const result = await getPmdNodes({ socketPath: "/tmp/bad.sock" });
    assert.ok("error" in result);
  });
});

describe("pmdRegister / pmdUnregister", () => {
  const socketPath = join(
    tmpdir(),
    `pmd-test-reg-${process.pid}-${Date.now()}.sock`
  );
  let mockServer: Server;
  const received: unknown[] = [];

  beforeEach(async () => {
    received.length = 0;
    mockServer = await createMockPmd(socketPath, (req) => {
      received.push(req);
      return "Ok";
    });
  });

  afterEach(async () => {
    await closeMockPmd(mockServer, socketPath);
  });

  it("sends Register with name, port, and metadata", async () => {
    await pmdRegister({ socketPath }, "myapp", 9090);
    assert.equal(received.length, 1);
    const req = received[0] as Record<string, unknown>;
    assert.ok("Register" in req);
    const reg = req.Register as Record<string, unknown>;
    assert.equal(reg.name, "myapp");
    assert.equal(reg.port, 9090);
    assert.deepStrictEqual(reg.metadata, {});
  });

  it("sends Unregister with name", async () => {
    await pmdUnregister({ socketPath }, "myapp");
    assert.equal(received.length, 1);
    const req = received[0] as Record<string, unknown>;
    assert.ok("Unregister" in req);
  });
});
