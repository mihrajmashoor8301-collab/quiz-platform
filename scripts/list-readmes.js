const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const files = fs.readdirSync(root, { recursive: true });

const markdown = files.filter(
  (f) => f.endsWith(".md") && !f.startsWith("node_modules") && f !== "docs"
);

console.log("README files:", markdown.length);
markdown.forEach((f) => console.log(`  ${f}`));
