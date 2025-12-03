import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

// Guard API key dari Middleware → Core
router.use((req, res, next) => {
  const key = req.header("X-API-Key");
  if (!key || key !== process.env.CORE_API_KEY) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }
  next();
});

/**
 * GET /api/v1/history/mutations?account_number=...
 */
router.get("/mutations", async (req, res) => {
  try {
    const acc = (req.query.account_number || "").toString().trim();
    if (!acc)
      return res
        .status(400)
        .json({ status: "error", message: "account_number wajib dikirim" });

    const [rows] = await pool.query(
      `SELECT mutation_id, txn_time, type, amount, balance_after, description
         FROM mutations
        WHERE account_number = ?
        ORDER BY txn_time DESC, id DESC`,
      [acc]
    );

    if (!rows.length) {
      return res.status(404).json({
        status: "error",
        message: "Tidak ada data mutasi ditemukan untuk rekening ini",
      });
    }

    const data = rows.map((r) => ({
      mutation_id: r.mutation_id,
      date: new Date(r.txn_time).toISOString(),
      type: r.type,
      amount: Number(r.amount),
      balance_after: Number(r.balance_after),
      description: r.description || "",
    }));

    return res.json({
      status: "success",
      message: "Riwayat mutasi berhasil diambil",
      data,
    });
  } catch (e) {
    console.error(e);
    return res
      .status(500)
      .json({ status: "error", message: "Internal Server Error" });
  }
});

export default router;
