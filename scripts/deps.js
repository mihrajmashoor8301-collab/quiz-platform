const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dirs = ["backend", "frontend"];

for (const dir of dirs) {
  const p = path.join(root, dir, "package.json");
  if (!fs.existsSync(p)) continue;
  const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
  const deps = Object.keys(pkg.dependencies || {});
  const dev = Object.keys(pkg.devDependencies || {});
  console.log(`${dir}: ${deps.length} dependencies, ${dev.length} devDependencies`);
  console.log("  deps:", deps.join(", "));
  console.log("  dev:", dev.join(", "));
}
