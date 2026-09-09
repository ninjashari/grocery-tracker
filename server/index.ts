import express from "express";
import cookieParser from "cookie-parser";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getDb, resolveDbPath } from "./db/connection.ts";
import { errorHandler, notFound } from "./lib/http.ts";
import { loadAuth, requireAuth } from "./middleware/auth.ts";
import { authRouter } from "./routes/auth.ts";
import { categoriesRouter } from "./routes/categories.ts";
import { itemsRouter } from "./routes/items.ts";
import { billsRouter } from "./routes/bills.ts";
import { reportsRouter } from "./routes/reports.ts";
import { dataRouter } from "./routes/data.ts";

const here = dirname(fileURLToPath(import.meta.url));
const clientDist = resolve(here, "..", "dist", "client");

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  // CSV import posts the file body as text rather than multipart; one less dependency.
  app.use(express.text({ type: "text/csv", limit: "10mb" }));
  app.use(cookieParser());
  app.use(loadAuth);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, db: resolveDbPath() });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/categories", requireAuth, categoriesRouter);
  app.use("/api/items", requireAuth, itemsRouter);
  app.use("/api/bills", requireAuth, billsRouter);
  app.use("/api/reports", requireAuth, reportsRouter);
  app.use("/api/data", requireAuth, dataRouter);

  app.use("/api", (_req, _res, next) => next(notFound("No such endpoint")));

  // In production the built client is served from the same origin as the API. In dev,
  // Vite serves it on :5173 and proxies /api here instead.
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(join(clientDist, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
}

const isMain = process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`;

if (isMain) {
  const port = Number(process.env.PORT ?? 5174);
  getDb(); // Run migrations before accepting traffic.
  createApp().listen(port, "0.0.0.0", () => {
    console.log(`Grocery tracker API on http://localhost:${port} (db: ${resolveDbPath()})`);
  });
}
