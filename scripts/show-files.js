const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dirs = ["backend", "frontend"];

for (const dir of dirs) {
  const p = path.join(root, dir);
  const files = fs.readdirSync(p, { recursive: true }).filter((f) => !f.startsWith("node_modules"));
  console.log(dir, ":", files.length, "files");
  console.log("  ", files.slice(0, 12).join(", "));
}
