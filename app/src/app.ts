import { createServer, IncomingMessage, ServerResponse, Server } from "node:http";
import {
  PmdClientOptions,
  getPmdStatus,
  getPmdNodes,
  pmdRegister,
  pmdUnregister,
} from "./pmd-client.js";

export interface AppOptions {
  port: number;
  host: string;
  machineName: string;
  pmd: PmdClientOptions;
}

export function createApp(options: AppOptions): Server {
  const { machineName, pmd } = options;

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Hello from " + machineName + "\n");
      } else if (req.url === "/status") {
        const [status, nodes] = await Promise.all([
          getPmdStatus(pmd),
          getPmdNodes(pmd),
        ]);
        const body = JSON.stringify(
          { machine: machineName, status, nodes },
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

  return server;
}

export async function startApp(options: AppOptions): Promise<Server> {
  const server = createApp(options);

  return new Promise((resolve) => {
    server.listen(options.port, options.host, async () => {
      console.log("PMD API listening on " + options.host + ":" + options.port);

      try {
        await pmdRegister(options.pmd, "api", options.port);
        console.log(
          "Registered 'api' service on port " + options.port + " with PMD"
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("Failed to register with PMD: " + msg);
      }

      resolve(server);
    });
  });
}

export async function stopApp(
  server: Server,
  pmd: PmdClientOptions
): Promise<void> {
  try {
    await pmdUnregister(pmd, "api");
  } catch {}
  return new Promise((resolve) => server.close(() => resolve()));
}
