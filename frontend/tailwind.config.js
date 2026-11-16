import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('tailwindcss').Config} */
const frontendDir = path.dirname(fileURLToPath(import.meta.url));

export default {
  content: [
    path.join(frontendDir, "src/pages/**/*.{js,ts,jsx,tsx,mdx}"),
    path.join(frontendDir, "src/components/**/*.{js,ts,jsx,tsx,mdx}"),
    path.join(frontendDir, "src/app/**/*.{js,ts,jsx,tsx,mdx}"),
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
