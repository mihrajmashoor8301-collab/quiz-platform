const fs = require("node:fs");
const path = require("node:path");
const { v4: uuidv4 } = require("uuid");

const files = [
  "README.md",
  "backend/package.json",
  "backend/.env.example",
  "backend/test/helpers.js",
  "backend/test/fakes.js",
  "backend/test/room.test.js",
  "backend/src/constants.js",
  "backend/src/logger.js",
  "backend/src/rate-limiter.js",
  "backend/src/version.js",
  "frontend/package.json",
  "frontend/.env.example",
  "frontend/tsconfig.json",
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

const previous = fs.readdirSync(path.join(__dirname, ".."), { recursive: true }).filter((f) => f.endsWith(".md"));

console.log("Previous README files:", previous);
console.log("Current files:", files.length);

// Verify every file listed in the README exists.
files.forEach((file) => {
  if (!fs.existsSync(path.join(__dirname, "..", file))) throw new Error(`missing ${file}`);
});

console.log(uuidv4());
