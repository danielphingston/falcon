import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// For GitHub Pages project sites set BASE_PATH=/<repo>/ when building.
const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      pwaAssets: { image: "public/favicon.svg", preset: "minimal-2023", overrideManifestIcons: true },
      manifest: {
        name: "FDD Tracker",
        short_name: "FDD Tracker",
        description: "Engagements, work papers, IRLs and follow-ups for financial due diligence.",
        theme_color: "#4f46e5",
        background_color: "#f8fafc",
        display: "standalone",
        start_url: base,
        scope: base,
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
      },
      devOptions: { enabled: false },
    }),
  ],
});
