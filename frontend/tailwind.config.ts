import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--color-ink)",
        panel: "var(--color-panel)",
        line: "var(--color-line)",
        muted: "var(--color-muted)",
        brand: "#2563eb",
        "brand-dark": "#1d4ed8",
        success: "#16a34a",
        warn: "#d97706",
        danger: "#dc2626",
        good: "#15803d"
      },
      boxShadow: {
        panel: "0 1px 2px rgba(15, 23, 42, 0.05)",
        lift: "0 12px 24px rgba(15, 23, 42, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
