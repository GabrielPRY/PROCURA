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
        danger: "#dc2626",
        warn: "#d97706",
        good: "#15803d"
      }
    }
  },
  plugins: []
};

export default config;
