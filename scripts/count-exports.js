const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dir = path.join(root, "backend", "src");

for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
  const content = fs.readFileSync(path.join(dir, entry.name), "utf8");
  const exportsCount = (content.match(/^exports\.[A-Za-z]+-/gm) || []).length;
  console.log(`${entry.name}: ${exportsCount} exports`);
}
