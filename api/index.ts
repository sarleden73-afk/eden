import { createApiApp } from "../src/api.js";

// Vercel serverless entry point. Every /api/* request is routed here (see
// vercel.json) and handled by the Express app. Vercel's @vercel/node runtime
// accepts an Express app as the default export.
export default createApiApp();
