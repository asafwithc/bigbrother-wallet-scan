import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0b0c",
        panel: "#111113",
        edge: "#1d1d20",
        accent: "#4f9cf9",
      },
    },
  },
  plugins: [],
};

export default config;
