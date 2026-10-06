import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0e14",
        panel: "#111721",
        edge: "#1d2735",
        accent: "#4f9cf9",
      },
    },
  },
  plugins: [],
};

export default config;
