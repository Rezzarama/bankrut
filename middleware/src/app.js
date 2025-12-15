import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import coreRoutes from "./routes/core.js";
import historyRoutes from "./routes/history.js";
import accountsSyncRoutes from "./routes/accounts-snapshot.js";
import transactionsRoutes from "./routes/transactions.js";
import healthRoutes from "./routes/health.js";

dotenv.config();
const app = express();

app.use(
  cors({
    origin: ["http://127.0.0.1:5500", "http://localhost:5500"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-API-Key"],
  })
);
app.options("*", cors());
app.use(express.json());
app.use("/api/v1/history", historyRoutes);
app.use("/core", coreRoutes);
app.use("/core", accountsSyncRoutes);
app.use("/api/v1/transactions", transactionsRoutes);
app.use("/health", healthRoutes);

app.listen(process.env.PORT, () =>
  console.log(`Middleware on ${process.env.PORT}`)
);
