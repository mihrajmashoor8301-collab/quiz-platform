// Backend container factory. Under vitest the container is the fake
// (VITE_NODE_TEST=1 is set in `package.json` test scripts); under
// `npm start` it is a real PostgreSQL pool built from `DB_*` env, or
// the in-memory fake if DB_HOST is not provided.
import { Pool } from "pg";

import RoomService from "./room.service.js";
import QuestionService from "./question.service.js";
import SubmissionService from "./submission.service.js";
import LiveGame from "./live-game.js";
import { getFakeBackend } from "../../test/fakes.js";
import log from "../logger.js";

const containers = new Map();
// PINs whose rooms were created over HTTP, so their hosts survive a restart.
const hostIds = new Map();

function isTest() {
  return process.env.VITE_NODE_TEST === "1";
}

// Real PostgreSQL client used by `npm start` and `scripts/checks.sh db-push`.
function productionPool() {
  const p = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "quiz_app",
    user: process.env.DB_USER || "quiz_app",
    password: process.env.DB_PASSWORD || "quiz_app_password",
    max: 4,
  });
  p.on("error", (err) => {
    log.error(`PostgreSQL pool error: ${err.message}`);
  });
  return p;
}

export function getRoomService(httpServer, pin) {
  if (!containers.has(pin)) {
    const useFake = isTest() || process.env.USE_IN_MEMORY === "1" || !process.env.DB_HOST;
    const backend = useFake
      ? getFakeBackend()
      : { pool: productionPool(), pin, pins: new Set() };
    const roomService = new RoomService(backend, httpServer);
    backend.roomService = roomService;
    backend.questionService = new QuestionService(backend);
    backend.submissionService = new SubmissionService(backend);
    roomService.questionService = backend.questionService;
    roomService.submissionService = backend.submissionService;
    if (!isTest() && hostIds.has(pin)) roomService.hostId = hostIds.get(pin);
    containers.set(pin, roomService);
  }
  return containers.get(pin);
}

export function recordHost(pin, hostId) {
  hostIds.set(pin, hostId);
}

export { LiveGame };
