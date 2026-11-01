const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const entries = fs.readdirSync(root, { withFileTypes: true });

const directories = entries.filter((e) => e.isDirectory()).map((e) => e.name);
const files = entries.filter((e) => e.isFile()).map((e) => e.name);

console.log("directories:", directories.join(", "));
console.log("files:", files.join(", "));
