import { hostname } from "node:os";
import { join } from "node:path";
import { startApp, stopApp } from "./app.js";

const PORT = parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.BIND_ADDR || "0.0.0.0";
const PMD_HOME = process.env.PMD_HOME || "/var/lib/pmd";
const PMD_PORT = parseInt(process.env.PMD_PORT || "4369", 10);
const SOCKET_PATH = join(PMD_HOME, ".pmd", `pmd-${PMD_PORT}.sock`);

const options = {
  port: PORT,
  host: HOST,
  machineName: hostname(),
  pmd: { socketPath: SOCKET_PATH },
};

const server = await startApp(options);

process.on("SIGTERM", async () => {
  console.log("Received SIGTERM, shutting down...");
  await stopApp(server, options.pmd);
  process.exit(0);
});
