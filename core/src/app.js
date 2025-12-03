import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import accountsRoutes from "./routes/accounts.js";
import historyRoutes from "./routes/history.js";
import accountsSyncRoutes from "./routes/accounts-sync.js";
import transactionsRoutes from "./routes/transactions.js";

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
app.use("/api/v1/accounts", accountsRoutes);
app.use("/api/v1/history", historyRoutes);
app.use("/api/v1/accounts", accountsSyncRoutes);
app.use("/api/v1/transactions", transactionsRoutes);

app.listen(process.env.PORT, () => console.log(`Core on ${process.env.PORT}`));
