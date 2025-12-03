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

function genTxId() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `TX-${y}${m}${day}${rand}`;
}

/**
 * POST /api/v1/transactions/internal
 * Body: { source_account_number, target_account_number, amount, currency_code, description, transaction_date }
 */
router.post("/internal", async (req, res) => {
  const r = req.body || {};
  try {
    const src = (r.source_account_number || "").trim();
    const dst = (r.target_account_number || "").trim();
    const amount = Number(r.amount);
    const currency = (r.currency_code || "IDR").trim();
    const desc = r.description || "Transfer internal";
    const when = r.transaction_date ? new Date(r.transaction_date) : new Date();

    if (!src || !dst || !amount || amount <= 0) {
      return res
        .status(400)
        .json({ status: "error", message: "Input tidak valid" });
    }
    if (src === dst) {
      return res.status(400).json({
        status: "error",
        message: "Rekening sumber dan tujuan tidak boleh sama",
      });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [[accSrc]] = await conn.query(
        `SELECT id, account_number, balance, currency_code FROM core_accounts WHERE account_number = ? FOR UPDATE`,
        [src]
      );
      const [[accDst]] = await conn.query(
        `SELECT id, account_number, balance, currency_code FROM core_accounts WHERE account_number = ? FOR UPDATE`,
        [dst]
      );

      if (!accSrc || !accDst) {
        await conn.rollback();
        return res.status(404).json({
          status: "error",
          message: "Rekening sumber/tujuan tidak ditemukan",
        });
      }
      if (
        accSrc.currency_code !== currency ||
        accDst.currency_code !== currency
      ) {
        await conn.rollback();
        return res
          .status(400)
          .json({ status: "error", message: "Mata uang akun tidak sesuai" });
      }
      if (Number(accSrc.balance) < amount) {
        await conn.rollback();
        return res
          .status(400)
          .json({ status: "error", message: "Saldo tidak cukup" });
      }

      const afterSrc = Number(accSrc.balance) - amount;
      const afterDst = Number(accDst.balance) + amount;

      // Update saldo
      await conn.query(`UPDATE core_accounts SET balance = ? WHERE id = ?`, [
        afterSrc,
        accSrc.id,
      ]);
      await conn.query(`UPDATE core_accounts SET balance = ? WHERE id = ?`, [
        afterDst,
        accDst.id,
      ]);

      // Catat transaksi (1 baris di sumber)
      const txId = genTxId();
      await conn.query(
        `INSERT INTO transactions (account_number, transaction_id, txn_time, type, bank, target_account_number, amount, currency, description)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [src, txId, when, "TrfOvrbok", "Internal", dst, amount, currency, desc]
      );

      // Catat mutasi (2 baris)
      const mutIdSrc = `MUT-${txId}-SRC`;
      const mutIdDst = `MUT-${txId}-DST`;

      await conn.query(
        `INSERT INTO mutations (account_number, mutation_id, txn_time, type, amount, balance_after, description)
         VALUES (?,?,?,?,?,?,?)`,
        [src, mutIdSrc, when, "Debit", amount, afterSrc, `Transfer ke ${dst}`]
      );
      await conn.query(
        `INSERT INTO mutations (account_number, mutation_id, txn_time, type, amount, balance_after, description)
         VALUES (?,?,?,?,?,?,?)`,
        [
          dst,
          mutIdDst,
          when,
          "Kredit",
          amount,
          afterDst,
          `Transfer dari ${src}`,
        ]
      );

      await conn.commit();

      return res.json({
        status: "success",
        transaction_id: txId,
        mutations: [
          {
            account_number: src,
            mutation_type: "Debit",
            balance_after: afterSrc,
          },
          {
            account_number: dst,
            mutation_type: "Kredit",
            balance_after: afterDst,
          },
        ],
      });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error(e);
    return res
      .status(500)
      .json({ status: "error", message: "Internal Server Error" });
  }
});

export default router;
