const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dirs = ["backend", "frontend"];

for (const dir of dirs) {
  const p = path.join(root, dir);
  const entries = fs.readdirSync(p, { withFileTypes: true });
  console.log(dir, ":", entries.map((e) => `${e.name}${e.isDirectory() ? "/" : ""}`).join(", "));
}
