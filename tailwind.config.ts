import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0A0C10",
        panel: "#12151C",
        text: "#D7DCE5",
        bid: "#2FBF71",
        ask: "#E5484D",
        alert: "#3DDBD9",
        seam: "#232833",
        dim: "#8A93A3",
        chart: "#FFA028",
        panelhi: "#191D26",
        // Marketing tokens resolve through CSS variables so the landing page
        // can interpolate them from parchment to ink on scroll.
        m: {
          bg: "var(--m-bg)",
          fg: "var(--m-fg)",
          muted: "var(--m-muted)",
          rule: "var(--m-rule)",
          surface: "var(--m-surface)",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        condensed: ["var(--font-condensed)", "var(--font-body)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
