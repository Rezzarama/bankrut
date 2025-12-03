import { Router } from "express";
import axios from "axios";

const router = Router();

// Guard API key dari Services → Middleware
router.use((req, res, next) => {
  const key = req.header("X-API-Key");
  if (!key || key !== process.env.MIDDLEWARE_API_KEY) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }
  next();
});

/**
 * POST /api/v1/transactions/execute
 * Body: { transaction_type, transaction_bank, source_account_number, target_account_number, amount, currency_code, description, transaction_date }
 * Forward → CORE POST /api/v1/transactions/internal
 */
router.post("/execute", async (req, res) => {
  try {
    const b = req.body || {};
    if (
      (b.transaction_type || "").trim() !== "TrfOvrbok" ||
      (b.transaction_bank || "").trim() !== "Internal"
    ) {
      return res.status(400).json({
        status: "error",
        message: "Hanya mendukung TrfOvrbok Internal",
      });
    }

    const coreUrl = `${process.env.CORE_BASE}/api/v1/transactions/internal`;
    const coreResp = await axios.post(
      coreUrl,
      {
        source_account_number: b.source_account_number,
        target_account_number: b.target_account_number,
        amount: b.amount,
        currency_code: b.currency_code || "IDR",
        description: b.description || "Transfer internal",
        transaction_date: b.transaction_date,
      },
      {
        headers: {
          "X-API-Key": process.env.CORE_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    return res.status(coreResp.status).json(coreResp.data);
  } catch (e) {
    const status = e.response?.status || 502;
    const data = e.response?.data || {
      status: "error",
      message: "Core unreachable or error",
    };
    return res.status(status).json(data);
  }
});

export default router;
