import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { cancelAll } from "./services/claude-agent.js";

const config = loadConfig();
const app = createApp(config);

const server = app.listen(config.port, () => {
  console.log(`resume-tailor-agent API listening on http://localhost:${config.port}`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nReceived ${signal} — shutting down.`);
  // Stop accepting new connections, cancel in-flight agent runs.
  server.close(() => {
    process.exit(0);
  });
  cancelAll();
  // Force-exit if connections (e.g. open SSE streams) keep the server alive.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
