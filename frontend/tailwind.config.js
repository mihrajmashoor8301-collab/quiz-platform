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
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        display: ["'Plus Jakarta Sans'", "Inter", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          50: "#f0efff",
          100: "#e5e1ff",
          200: "#c5c0ff",
          300: "#9f96ff",
          400: "#7c6cff",
          500: "#5842ff",
          600: "#4329eb",
          700: "#3e1ae8",
          800: "#2d13b3",
          900: "#130067",
        },
        surface: {
          canvas: "#f8f9ff",
          card: "#ffffff",
          muted: "#eff4ff",
          dim: "#e5eeff",
          border: "#e2e8f0",
          borderSubtle: "#f1f5f9",
        },
        answer: {
          coral: "#ef4444",
          "coral-dark": "#dc2626",
          "coral-light": "#fef2f2",
          cerulean: "#3b82f6",
          "cerulean-dark": "#2563eb",
          "cerulean-light": "#eff6ff",
          amber: "#f59e0b",
          "amber-dark": "#d97706",
          "amber-light": "#fffbeb",
          emerald: "#10b981",
          "emerald-dark": "#059669",
          "emerald-light": "#ecfdf5",
        },
      },
      boxShadow: {
        card: "0 1px 3px 0 rgba(15, 23, 42, 0.05), 0 1px 2px -1px rgba(15, 23, 42, 0.04)",
        elevated: "0 10px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04)",
        modal: "0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.06)",
        "tactile-coral": "0 4px 0 0 #b91c1c",
        "tactile-cerulean": "0 4px 0 0 #1d4ed8",
        "tactile-amber": "0 4px 0 0 #b45309",
        "tactile-emerald": "0 4px 0 0 #047857",
        "tactile-brand": "0 4px 0 0 #3e1ae8",
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.25rem",
        "3xl": "1.5rem",
      },
    },
  },
  plugins: [],
};
