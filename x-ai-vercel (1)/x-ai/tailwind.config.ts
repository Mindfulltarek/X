import type { Config } from "tailwindcss";

/**
 * X AI design tokens.
 *
 * The palette follows the dark-navy / royal-blue space reference:
 * near-black midnight backgrounds, restrained electric blue and cyan accents,
 * thin blue-gray borders. Nothing here glows by default — glow is applied
 * intentionally per component.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        midnight: {
          950: "#020817",
          900: "#040b1c",
          850: "#061024",
          800: "#08142c",
          700: "#0d1c3a",
          600: "#14264a",
        },
        electric: {
          500: "#2563eb",
          400: "#3b7bff",
          300: "#6aa1ff",
          600: "#1d4ed8",
        },
        cyan: {
          accent: "#28d7f2",
        },
        ink: {
          100: "#ffffff",
          200: "#f2f6ff",
          300: "#dbe5fa",
          400: "#b9c7e4",
          500: "#93a3c4",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "Noto Sans",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      boxShadow: {
        "glow-sm": "0 0 24px -6px rgba(37, 99, 235, 0.55)",
        glow: "0 0 48px -10px rgba(37, 99, 235, 0.6)",
        "glow-cyan": "0 0 38px -12px rgba(40, 215, 242, 0.55)",
        panel: "0 24px 60px -30px rgba(0, 0, 0, 0.9)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        "float-slow": {
          "0%, 100%": { transform: "translate3d(0, 0, 0)" },
          "50%": { transform: "translate3d(0, -10px, 0)" },
        },
        caret: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.2" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.35s ease-out both",
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
        "float-slow": "float-slow 9s ease-in-out infinite",
        caret: "caret 1s steps(1, end) infinite",
        shimmer: "shimmer 2.2s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
