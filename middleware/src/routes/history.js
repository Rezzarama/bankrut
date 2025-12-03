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
 * POST /api/v1/history/mutations
 * Body: { account_number }
 * Forward ke CORE GET /api/v1/history/mutations?account_number=...
 */
router.post("/mutations", async (req, res) => {
  try {
    const acc = (req.body?.account_number || "").toString().trim();
    if (!acc)
      return res
        .status(400)
        .json({ status: "error", message: "account_number wajib dikirim" });

    const coreUrl = `${process.env.CORE_BASE}/api/v1/history/mutations`;
    const coreResp = await axios.get(coreUrl, {
      params: { account_number: acc },
      headers: { "X-API-Key": process.env.CORE_API_KEY },
    });

    // propagasi hasil apa adanya
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
