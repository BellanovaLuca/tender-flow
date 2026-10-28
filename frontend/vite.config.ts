import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Su WSL con progetto in /mnt/c il rename della cache fallisce (EACCES): puntare VITE_CACHE_DIR a un path Linux.
  cacheDir: process.env.VITE_CACHE_DIR ?? "node_modules/.vite",
  server: {
    port: 5173,
    // inotify non funziona su /mnt/c in WSL: VITE_POLL=1 attiva il polling per l'hot reload.
    watch: process.env.VITE_POLL ? { usePolling: true, interval: 300 } : undefined,
    proxy: { "/api": { target: process.env.API_URL ?? "http://127.0.0.1:8000", changeOrigin: true } },
  },
});
