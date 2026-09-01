import "dotenv/config";
import { createServer as createViteServer } from "vite";
import { createApiApp } from "./src/api.js";

// Local dev server: mounts the API routes plus Vite in middleware mode so the
// frontend and API are served from a single origin on port 3000.
// In production the frontend is static (Vercel CDN) and the API runs as a
// serverless function (api/index.ts) — this file is not used there.
async function startServer() {
  const app = createApiApp();
  const PORT = 3000;

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
