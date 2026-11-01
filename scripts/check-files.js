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
  "backend/test/room.test.js",
  "backend/src/constants.js",
  "backend/src/logger.js",
  "backend/src/rate-limiter.js",
  "backend/src/version.js",
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
