import { createConnection } from "node:net";

export interface PmdClientOptions {
  socketPath: string;
  timeout?: number;
}

export function pmdRequest(
  options: PmdClientOptions,
  request: unknown
): Promise<unknown> {
  const { socketPath, timeout = 5000 } = options;
  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath, () => {
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
      reject(
        new Error("PMD socket error (" + socketPath + "): " + err.message)
      );
    });

    client.setTimeout(timeout, () => {
      client.destroy();
      reject(new Error("PMD socket timeout"));
    });
  });
}

export interface PmdStatus {
  node_id: string;
  listen_addr: string;
  peer_count: number;
  node_count: number;
}

export interface PmdNode {
  node_id: string;
  addr: string;
  joined_at: number;
  metadata: Record<string, string>;
  services: PmdService[];
  phi: number | null;
  last_seen_at: number | null;
  is_local: boolean;
}

export interface PmdService {
  name: string;
  node_id: string;
  host: string;
  port: number;
  metadata: Record<string, string>;
}

export async function getPmdStatus(
  options: PmdClientOptions
): Promise<PmdStatus | { error: string }> {
  try {
    const resp = (await pmdRequest(options, "Status")) as Record<
      string,
      unknown
    >;
    return (resp.Status as PmdStatus) ?? resp;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg };
  }
}

export async function getPmdNodes(
  options: PmdClientOptions
): Promise<{ nodes: PmdNode[] } | { error: string }> {
  try {
    const resp = (await pmdRequest(options, "Nodes")) as Record<
      string,
      unknown
    >;
    return (resp.Nodes as { nodes: PmdNode[] }) ?? resp;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg };
  }
}

export async function pmdRegister(
  options: PmdClientOptions,
  name: string,
  port: number
): Promise<void> {
  await pmdRequest(options, { Register: { name, port, metadata: {} } });
}

export async function pmdUnregister(
  options: PmdClientOptions,
  name: string
): Promise<void> {
  await pmdRequest(options, { Unregister: { name } });
}
