import { Router } from "express";
const router = Router();

/** GET /health */
router.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "middleware",
    ts: new Date().toISOString(),
  });
});

export default router;
