import { Router } from "express";
import { pool } from "../db.js";
import bcrypt from "bcryptjs";
import axios from "axios";

const router = Router();

/**
 * POST /api/v1/sync/core-to-services
 * Headers:
 *  - Authorization-Username
 *  - Authorization-Password
 * Body:
 *  - { account_number }
 */
router.post("/core-to-services", async (req, res) => {
  try {
    const username = req.header("Authorization-Username");
    const password = req.header("Authorization-Password");
    if (!username || !password) {
      return res.status(400).json({
        status: "error",
        message:
          "Header Authorization-Username dan Authorization-Password wajib diisi",
      });
    }

    // Validasi login
    const [[login]] = await pool.query(
      `SELECT id AS login_id, customer_id, username, password_hash
         FROM logins
        WHERE username = ?
        LIMIT 1`,
      [username]
    );
    if (!login)
      return res
        .status(404)
        .json({ status: "error", message: "Username tidak ditemukan" });
    const ok = await bcrypt.compare(password, login.password_hash);
    if (!ok)
      return res
        .status(401)
        .json({ status: "error", message: "Username atau password salah" });

    const accountNumber = (req.body?.account_number || "").toString().trim();
    if (!accountNumber)
      return res
        .status(400)
        .json({ status: "error", message: "account_number wajib dikirim" });

    // Verifikasi kepemilikan rekening
    const [[acct]] = await pool.query(
      `SELECT id, customer_id, account_number FROM portfolio_accounts
        WHERE customer_id = ? AND account_number = ?
        LIMIT 1`,
      [login.customer_id, accountNumber]
    );
    if (!acct)
      return res.status(404).json({
        status: "error",
        message: "Rekening tidak ditemukan untuk pengguna ini",
      });

    // Panggil Middleware → Core
    const mwUrl = `${process.env.MIDDLEWARE_BASE}/core/accounts/snapshot`;
    const mwResp = await axios.post(
      mwUrl,
      { account_number: accountNumber },
      {
        headers: { "X-API-Key": process.env.MIDDLEWARE_API_KEY },
      }
    );

    if (mwResp.status !== 200 || mwResp.data?.status !== "success") {
      return res.status(502).json({
        status: "error",
        message: "Sinkronisasi gagal di Middleware/Core",
      });
    }

    const snap = mwResp.data.data;
    // snap: { account_number, customer{}, portfolio{}, transactions[], mutations[] }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 1) Update portfolio_accounts (balance, status, currency_code, open_date)
      await conn.query(
        `UPDATE portfolio_accounts
            SET balance = ?,
                status = ?,
                currency_code = ?,
                open_date = ?
          WHERE customer_id = ? AND account_number = ?`,
        [
          snap.portfolio?.balance ?? 0,
          snap.portfolio?.status ?? "Active",
          snap.portfolio?.currency_code ?? "IDR",
          snap.portfolio?.open_date ?? null,
          login.customer_id,
          accountNumber,
        ]
      );

      // 2) Upsert transactions (tanpa hapus dulu)
      if (Array.isArray(snap.transactions)) {
        for (const t of snap.transactions) {
          await conn.query(
            `INSERT INTO transactions
               (account_number, transaction_id, txn_time, type, bank, target_account_number, amount, currency, description)
             VALUES (?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
               txn_time = VALUES(txn_time),
               type = VALUES(type),
               bank = VALUES(bank),
               target_account_number = VALUES(target_account_number),
               amount = VALUES(amount),
               currency = VALUES(currency),
               description = VALUES(description)`,
            [
              accountNumber,
              t.transaction_id,
              new Date(t.date), // ISO → Date
              t.type,
              t.bank || "Internal",
              t.target_account_number || null,
              t.amount,
              t.currency || "IDR",
              t.description || "",
            ]
          );
        }
      }

      // 3) Upsert mutations (cache lokal)
      if (Array.isArray(snap.mutations)) {
        for (const m of snap.mutations) {
          await conn.query(
            `INSERT INTO mutations
               (account_number, mutation_id, txn_time, type, amount, balance_after, description)
             VALUES (?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
               txn_time = VALUES(txn_time),
               type = VALUES(type),
               amount = VALUES(amount),
               balance_after = VALUES(balance_after),
               description = VALUES(description)`,
            [
              accountNumber,
              m.mutation_id,
              new Date(m.date),
              m.type,
              m.amount,
              m.balance_after,
              m.description || "",
            ]
          );
        }
      }

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    // Response ringkas ke frontend
    return res.json({
      status: "success",
      message: "Sinkronisasi data berhasil",
      data: {
        account_number: snap.account_number,
        customer: snap.customer,
        portfolio: snap.portfolio,
        transactions_count: Array.isArray(snap.transactions)
          ? snap.transactions.length
          : 0,
        mutations_count: Array.isArray(snap.mutations)
          ? snap.mutations.length
          : 0,
      },
    });
  } catch (e) {
    // Propagasi detail error agar terlihat di frontend
    const status = e.response?.status || 502;
    const data = e.response?.data || {
      status: "error",
      message: "Middleware/Core bermasalah",
    };
    return res.status(status).json(data);
  }
});

export default router;
