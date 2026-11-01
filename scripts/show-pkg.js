const path = require("node:path");
const fs = require("node:fs");

const root = path.join(__dirname, "..");
const file = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));

console.log(`name=${pkg.name}`);
console.log(`version=${pkg.version}`);
console.log(`private=${pkg.private}`);
console.log(`workspaces=${JSON.stringify(pkg.workspaces)}`);
