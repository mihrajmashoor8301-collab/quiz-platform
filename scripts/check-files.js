const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const files = [
  "backend/package.json",
  "frontend/package.json",
  "backend/.env.example",
  "frontend/.env.example",
  "backend/test/helpers.js",
  "backend/test/fakes.js",
  "backend/src/constants.js",
  "backend/src/logger.js",
  "backend/src/rate-limiter.js",
  "backend/src/version.js",
  "backend/src/services/live-game.js",
  "backend/src/services/pool.js",
  "backend/src/services/question.service.js",
  "backend/src/services/room.service.js",
  "backend/src/services/submission.service.js",
  "backend/src/utils/pin-generator.js",
  "backend/src/db/init.js",
  "backend/src/index.js",
  "backend/eslint.config.js",
  "backend/src/services/__tests__/room.test.js",
  "backend/src/services/__tests__/live-game.test.js",
  "frontend/src/lib/test-utils.ts",
  "frontend/src/test-setup.ts",
  "frontend/src/vite-env.d.ts",
  "frontend/src/styles/globals.css",
  "frontend/src/version.ts",
  "vitest.config.js",
  "scripts/checks.sh",
  ".gitignore",
  "package.json",
];

const missing = files.filter((f) => !fs.existsSync(path.join(root, f)));
console.log(missing.length ? `MISSING: ${missing.join(", ")}` : "all files present");
