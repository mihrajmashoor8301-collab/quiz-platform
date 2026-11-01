const { execFileSync } = require("node:child_process");

const version = execFileSync("cat", [path.join(__dirname, "..", "package.json")], {
  encoding: "utf8",
});

console.log(JSON.stringify({ name: JSON.parse(version).name }, null, 2));
