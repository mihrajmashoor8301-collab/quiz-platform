import fs from "node:fs";
import path from "node:path";

export const getPackageInfo = () => {
  const pkgPath = path.resolve(process.cwd(), "package.json");
  if (fs.existsSync(pkgPath)) {
    return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  }
  return { name: "quiz-platform-frontend", version: "0.1.0" };
};

export default getPackageInfo;
