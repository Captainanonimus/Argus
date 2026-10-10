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
        // Semantic tokens resolve through CSS variables (app/globals.css):
        // dark ink values by default and inside [data-surface="terminal"]
        // market panels, parchment values on the light [data-surface="app"].
        ink: "rgb(var(--c-ink) / <alpha-value>)",
        panel: "rgb(var(--c-panel) / <alpha-value>)",
        panelhi: "rgb(var(--c-panelhi) / <alpha-value>)",
        text: "rgb(var(--c-text) / <alpha-value>)",
        dim: "rgb(var(--c-dim) / <alpha-value>)",
        seam: "rgb(var(--c-seam) / <alpha-value>)",
        edge: "rgb(var(--c-edge) / <alpha-value>)",
        bid: "rgb(var(--c-bid) / <alpha-value>)",
        ask: "rgb(var(--c-ask) / <alpha-value>)",
        alert: "rgb(var(--c-alert) / <alpha-value>)",
        chart: "#FFA028",
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
      },
    },
  },
  plugins: [],
};
export default config;
