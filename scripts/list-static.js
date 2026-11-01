const path = require("node:path");
const fs = require("node:fs");

const root = path.join(__dirname, "..");
const out = [];

function walk(dir, rel) {
  for (const entry of fs.readdirSync(dir, { recursive: true })) {
    const p = path.join(dir, entry);
    const r = rel ? `${rel}/${entry}` : entry;
    if (fs.statSync(p).isDirectory()) {
      walk(p, r);
    } else if (!entry.endsWith(".md") && !entry.endsWith(".json") && !entry.endsWith(".js") && !entry.endsWith(".ts") && !entry.endsWith(".tsx") && !entry.endsWith(".css")) {
      out.push(r);
    }
  }
}

walk(root, "");
console.log(out.length ? out.join("\n") : "no untracked files");
