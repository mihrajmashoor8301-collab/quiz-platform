// Health check for the local PostgreSQL cluster used by the backend.
// Exits 0 while the cluster accepts connections, 1 otherwise. This lets
// `db-check` run before `db-init` so schema pushes never target a
// cluster that has not been started yet.
//
// Usage: node scripts/db-ready.mjs [--host host] [--port 5432]

import net from "node:net";

const options = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (key === "--host" || key === "--port") options.set(key.slice(2), process.argv[++index]);
}
const host = options.get("host") || process.env.DB_HOST || process.env.PGHOST || "localhost";
const port = Number(options.get("port") || process.env.DB_PORT || process.env.PGPORT || 5432);

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
