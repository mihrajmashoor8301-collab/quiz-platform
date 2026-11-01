const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const file = path.join(root, "backend", "src", "rate-limiter.js");
const content = fs.readFileSync(file, "utf8");

const lines = content.split("\n");
for (const line of lines) {
  if (/maxSubmissionsPerWindow|maxEventsPerWindow|windowMs/.test(line)) console.log(line.trim());
}
