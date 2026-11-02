import path from "node:path";
import { fileURLToPath } from "node:url";
import next from "./frontend/node_modules/next/dist/server/next.js";
import { app, httpServer, io } from "./backend/src/index.js";
import log from "./backend/src/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const dev = process.env.NODE_ENV === "development";

async function main() {
  log.info("Preparing unified Quiz Platform server (Next.js + Express + Socket.IO)...");

  const frontendDir = path.resolve(__dirname, "frontend");
  const nextApp = next({ dev, dir: frontendDir });
  await nextApp.prepare();
  const handle = nextApp.getRequestHandler();

  // All remaining routes are handled by Next.js App Router
  app.all("*", (req, res) => {
    return handle(req, res);
  });

  httpServer.listen(PORT, HOST, () => {
    console.log("\n=======================================================");
    console.log(`🎯 Personal Live Quiz Platform is running!`);
    console.log(`📡 URL:            http://localhost:${PORT}`);
    console.log(`👑 Host Dashboard: http://localhost:${PORT}/host`);
    console.log(`🎮 Player Join:    http://localhost:${PORT}`);
    console.log(`🔌 WebSockets:     Socket.IO active on port ${PORT}`);
    console.log("=======================================================\n");
  });
}

main().catch((err) => {
  console.error("Failed to start unified server:", err);
  process.exit(1);
});

export { app, httpServer, io };
