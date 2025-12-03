import { Router } from "express";
import axios from "axios";

const router = Router();

// Guard dari Services
router.use((req, res, next) => {
  const key = req.header("X-API-Key");
  if (!key || key !== process.env.MIDDLEWARE_API_KEY) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }
  next();
});

/**
 * POST /core/accounts/sync
 * Body: { account_number }
 * Forward → CORE POST /api/v1/accounts/sync
 */
// ganti dari: router.post('/accounts/sync', ...)
router.post("/accounts/snapshot", async (req, res) => {
  try {
    const acc = (req.body?.account_number || "").toString().trim();
    if (!acc)
      return res
        .status(400)
        .json({ status: "error", message: "account_number wajib dikirim" });

    const coreUrl = `${process.env.CORE_BASE}/api/v1/accounts/sync`; // Core tetap /accounts/sync
    const coreResp = await axios.post(
      coreUrl,
      { account_number: acc },
      {
        headers: { "X-API-Key": process.env.CORE_API_KEY },
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
