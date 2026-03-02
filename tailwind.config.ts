import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        playfair: ["var(--font-playfair)", "Georgia", "serif"],
        inter: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          bg: "#f2ede4",
          primary: "#1a1040",
          red: "#c0392b",
          blue: "#2563a8",
          green: "#2d6e3e",
          muted: "#5a5070",
          subtle: "#8a80a0",
        },
      },
    },
  },
  plugins: [],
};

export default config;
