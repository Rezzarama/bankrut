// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";

import authRoutes from "./routes/auth.js";
import accountsRoutes from "./routes/accounts.js";
import customersRoutes from "./routes/customers.js";
import historyRoutes from "./routes/history.js";
import syncRoutes from "./routes/sync.js";
import transactionsRoutes from "./routes/transactions.js";
import healthRoutes from "./routes/health.js";

dotenv.config();
const app = express();

/**
 * 0) Preflight helper utk Private Network Access (Chrome)
 *    Jika browser mengirim Access-Control-Request-Private-Network: true
 *    maka balas dengan Access-Control-Allow-Private-Network: true
 *    (Wajib untuk request ke IP LAN dari origin lain)
 */
app.use((req, res, next) => {
  if (
    req.method === "OPTIONS" &&
    req.headers["access-control-request-private-network"] === "true"
  ) {
    res.header("Access-Control-Allow-Private-Network", "true");
  }
  next();
});

/**
 * 1) CORS — paling awal
 *    - Terima semua origin termasuk 'null' (file:// di WebView Cordova)
 *    - Izinkan metode umum + OPTIONS
 *    - Header custom yang kamu pakai (API Key + pseudo basic auth)
 */
app.use(
  cors({
    origin: (origin, callback) => {
      // Izinkan SEMUA origin (termasuk null/file:// dan http://ip:port)
      // Jika mau dibatasi, cek origin string di sini.
      callback(null, true);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "X-API-Key",
      "Authorization-Username",
      "Authorization-Password",
    ],
    credentials: false, // kita tidak pakai cookie/sesi
  })
);

// 2) Terima preflight OPTIONS ke semua rute + pastikan header lengkap
app.options("*", (req, res) => {
  // Tambahkan lagi header ini jika preflight minta jaringan privat
  if (req.headers["access-control-request-private-network"] === "true") {
    res.header("Access-Control-Allow-Private-Network", "true");
  }
  res.sendStatus(204);
});

// 3) Parser JSON
app.use(express.json());

// 4) API-key guard — JANGAN memblok OPTIONS
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  const key = req.header("X-API-Key");
  // Gunakan env; siapkan fallback dev supaya gampang tes
  const expected = process.env.SERVICES_API_KEY || "super-secret-key";
  if (!key || key !== expected) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }
  next();
});

// 5) Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/accounts", accountsRoutes);
app.use("/api/v1/customers", customersRoutes);
app.use("/api/v1/history", historyRoutes);
app.use("/api/v1/sync", syncRoutes);
app.use("/api/v1/transactions", transactionsRoutes);
app.use("/health", healthRoutes);

// (Opsional) endpoint health untuk ngetes dari HP
app.get("/api/v1/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => console.log(`API on http://0.0.0.0:${PORT}`));
