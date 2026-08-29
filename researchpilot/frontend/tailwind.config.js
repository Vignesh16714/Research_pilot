/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Design tokens for ResearchPilot's dark, glassmorphic, voice-
        // assistant identity. Teal -> indigo -> violet gradient accent,
        // deliberately not the warm-cream/terracotta or acid-green
        // defaults.
        base: {
          950: "#080A10",
          900: "#0B0E16",
          800: "#12162124",
          panel: "rgba(255,255,255,0.045)",
        },
        ink: {
          100: "#EDEFF7",
          300: "#B7BCD0",
          500: "#7C8296",
        },
        accent: {
          teal: "#2DD4BF",
          indigo: "#6366F1",
          violet: "#9061F9",
        },
      },
      fontFamily: {
        display: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Display",
          "Inter",
          "sans-serif",
        ],
      },
      backdropBlur: {
        xs: "2px",
      },
      boxShadow: {
        glow: "0 0 80px -20px rgba(99, 102, 241, 0.45)",
        panel: "0 8px 32px rgba(0,0,0,0.35)",
      },
      keyframes: {
        driftSlow: {
          "0%, 100%": { transform: "translate(0px, 0px) scale(1)" },
          "50%": { transform: "translate(6px, -8px) scale(1.02)" },
        },
      },
      animation: {
        "drift-slow": "driftSlow 9s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
