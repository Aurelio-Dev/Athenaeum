/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          app: "var(--color-surface-app)",
          panel: "var(--color-surface-panel)",
          card: "var(--color-surface-card)",
          muted: "var(--color-surface-muted)",
          subtle: "var(--color-surface-subtle)",
          elevated: "var(--color-surface-elevated)",
        },
        accent: {
          "icon-amber": "var(--color-accent-icon-amber)",
        },
        overlay: {
          modal: "var(--color-overlay-modal)",
        },
        sidebar: {
          DEFAULT: "var(--color-sidebar)",
          raised: "var(--color-sidebar-raised)",
          active: "var(--color-sidebar-active)",
          border: "var(--color-sidebar-border)",
          text: "var(--color-sidebar-text)",
          muted: "var(--color-sidebar-muted)",
        },
        primary: {
          DEFAULT: "var(--color-primary)",
          hover: "var(--color-primary-hover)",
          soft: "var(--color-primary-soft)",
          text: "var(--color-primary-text)",
        },
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          subtle: "var(--color-text-subtle)",
          inverse: "var(--color-text-inverse)",
        },
        border: {
          subtle: "var(--color-border-subtle)",
          muted: "var(--color-border-muted)",
          strong: "var(--color-border-strong)",
        },
        tag: {
          violet: "var(--color-tag-violet-bg)",
          "violet-text": "var(--color-tag-violet-text)",
          indigo: "var(--color-tag-indigo-bg)",
          "indigo-text": "var(--color-tag-indigo-text)",
          blue: "var(--color-tag-blue-bg)",
          "blue-text": "var(--color-tag-blue-text)",
          teal: "var(--color-tag-teal-bg)",
          "teal-text": "var(--color-tag-teal-text)",
          rose: "var(--color-tag-rose-bg)",
          "rose-text": "var(--color-tag-rose-text)",
          amber: "var(--color-tag-amber-bg)",
          "amber-text": "var(--color-tag-amber-text)",
        },
        status: {
          green: "var(--color-status-green-bg)",
          "green-text": "var(--color-status-green-text)",
          slate: "var(--color-status-slate-bg)",
          "slate-text": "var(--color-status-slate-text)",
          red: "var(--color-status-red-bg)",
          "red-text": "var(--color-status-red-text)",
        },
        highlight: {
          amber: "var(--color-highlight-amber-bg)",
          "amber-text": "var(--color-highlight-amber-text)",
        },
        spine: {
          violet: "var(--color-spine-violet)",
          indigo: "var(--color-spine-indigo)",
          blue: "var(--color-spine-blue)",
          teal: "var(--color-spine-teal)",
          rose: "var(--color-spine-rose)",
          amber: "var(--color-spine-amber)",
        },
      },
      fontFamily: {
        sans: ["Inter", "IBM Plex Sans", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "Consolas", "monospace"],
      },
      boxShadow: {
        card: "0 2px 10px rgba(24, 24, 27, 0.05)",
        button: "0 1px 2px rgba(79, 70, 229, 0.35)",
      },
    },
  },
  plugins: [],
};
