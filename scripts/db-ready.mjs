// Health check for the local PostgreSQL cluster used by the backend.
// Exits 0 while the cluster accepts connections, 1 otherwise. This lets
// `db-check` run before `db-init` so schema pushes never target a
// cluster that has not been started yet.
//
// Usage: node scripts/db-ready.mjs [--host host] [--port 5432]

import net from "node:net";

const host = process.argv[2] === "--host" ? process.argv[3] : "127.0.0.1";
const port = process.argv[4] === "--port" ? Number(process.argv[5]) : 5432;

const socket = net.connect({ host, port });
socket.on("connect", () => {
  socket.end();
  console.log(`pg-ready: postgresql://${host}:${port}/quiz_app is up`);
  process.exit(0);
});
socket.on("error", (err) => {
  console.error(`pg-ready: postgresql://${host}:${port}/quiz_app is down (${err.code})`);
  process.exit(1);
});
