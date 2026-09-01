import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  build: {
    rollupOptions: {
      output: {
        // L'application tourne beaucoup sur tablette au comptoir, souvent en
        // connexion limitée. Isoler les grosses dépendances stables dans leurs
        // propres fichiers permet au navigateur de les garder en cache entre
        // deux déploiements : seule la partie applicative est retéléchargée.
        // Recharts n'est chargé que par le tableau de bord et les rapports.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          graphiques: ["recharts"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
  server: {
    // Le watcher est désactivé dans certains environnements d'édition assistée
    // pour éviter les rechargements en rafale pendant les modifications.
    hmr: process.env.DISABLE_HMR !== "true",
  },
});
