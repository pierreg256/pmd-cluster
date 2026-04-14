import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createConnection } from "node:net";
import { hostname } from "node:os";
import { join } from "node:path";

const PORT = 8080;
const HOST = process.env.BIND_ADDR || "0.0.0.0";
const PMD_HOME = "/var/lib/pmd";
const PMD_PORT = 4369;
const SOCKET_PATH = join(PMD_HOME, ".pmd", `pmd-${PMD_PORT}.sock`);
const MACHINE_NAME = hostname();

// ---------------------------------------------------------------------------
// PMD Unix socket client — JSON-line protocol
// ---------------------------------------------------------------------------

function pmdRequest(request: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const client = createConnection(SOCKET_PATH, () => {
      client.write(JSON.stringify(request) + "\n");
    });

    let data = "";
    client.on("data", (chunk) => {
      data += chunk.toString();
      const newline = data.indexOf("\n");
      if (newline !== -1) {
        const line = data.slice(0, newline);
        client.destroy();
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new Error("Invalid JSON from PMD: " + line));
        }
      }
    });

    client.on("error", (err) => {
      reject(new Error("PMD socket error (" + SOCKET_PATH + "): " + err.message));
    });

    client.setTimeout(5000, () => {
      client.destroy();
      reject(new Error("PMD socket timeout"));
    });
  });
}

async function getPmdStatus(): Promise<object> {
  try {
    const resp = (await pmdRequest("Status")) as Record<string, unknown>;
    return resp.Status ?? resp;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg };
  }
}

async function getPmdNodes(): Promise<object> {
  try {
    const resp = (await pmdRequest("Nodes")) as Record<string, unknown>;
    return resp.Nodes ?? resp;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg };
  }
}

async function pmdRegister(name: string, port: number): Promise<void> {
  await pmdRequest({ Register: { name, port, metadata: {} } });
}

async function pmdUnregister(name: string): Promise<void> {
  await pmdRequest({ Unregister: { name } });
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Hello from " + MACHINE_NAME + "\n");
    } else if (req.url === "/status") {
      const [status, nodes] = await Promise.all([
        getPmdStatus(),
        getPmdNodes(),
      ]);
      const body = JSON.stringify(
        { machine: MACHINE_NAME, status, nodes },
        null,
        2
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body + "\n");
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found\n");
    }
  }
);

server.listen(PORT, HOST, async () => {
  console.log("PMD API listening on " + HOST + ":" + PORT);

  try {
    await pmdRegister("api", PORT);
    console.log("Registered 'api' service on port " + PORT + " with PMD");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Failed to register with PMD: " + msg);
  }
});

process.on("SIGTERM", async () => {
  console.log("Received SIGTERM, unregistering from PMD...");
  try {
    await pmdUnregister("api");
  } catch {}
  server.close(() => process.exit(0));
});
