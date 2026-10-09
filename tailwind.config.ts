import type { Config } from "tailwindcss";

// Green-tinted greys. Mapping Tailwind's zinc and slate scales onto these
// puts every existing text-zinc-*, bg-zinc-* and border-zinc-* class on theme.
const phosphor = {
  50: "#f0fff6",
  100: "#d8ffe8",
  200: "#b6f2cd",
  300: "#a6d8bb",
  400: "#7dab93",
  500: "#5a8470",
  600: "#3d6151",
  700: "#294536",
  800: "#16281e",
  900: "#0b1610",
  950: "#050b08",
};

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#030806",
        // slightly see-through, so the rain shows faintly behind every panel
        panel: "rgba(7, 17, 12, 0.9)",
        edge: "#12291d", // panel borders and dividers
        line: "#1c3b2b", // control borders (inputs, chips, buttons)
        chip: "#0f2118", // filled chips, avatars, tracks
        raise: "#0a1811", // hover surfaces
        matrix: "#2dff8f", // the accent
        accent: "#2dff8f",
        white: "#eafff2",
        zinc: phosphor,
        slate: phosphor,
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        glow: "0 0 22px -4px rgba(45, 255, 143, 0.55)",
        "glow-sm": "0 0 12px -2px rgba(45, 255, 143, 0.45)",
      },
      keyframes: {
        blink: { "0%, 49%": { opacity: "1" }, "50%, 100%": { opacity: "0" } },
        sweep: { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        blink: "blink 1.1s steps(1) infinite",
        sweep: "sweep 6s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
