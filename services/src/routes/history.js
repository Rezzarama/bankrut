import { Router } from "express";
import { pool } from "../db.js";
import bcrypt from "bcryptjs";
import axios from "axios";

const router = Router();

/**
 * GET /api/v1/history/mutations?account_number=...
 * Headers:
 *  - Authorization-Username
 *  - Authorization-Password
 */
router.get("/mutations", async (req, res) => {
  try {
    // 1) Validasi header login
    const username = req.header("Authorization-Username");
    const password = req.header("Authorization-Password");
    if (!username || !password) {
      return res.status(400).json({
        status: "error",
        message:
          "Header Authorization-Username dan Authorization-Password wajib diisi",
      });
    }

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

    // 2) Ambil & validasi account_number
    const accountNumber = (
      req.query.account_number ||
      req.body?.account_number ||
      ""
    )
      .toString()
      .trim();
    if (!accountNumber)
      return res
        .status(400)
        .json({ status: "error", message: "account_number wajib dikirim" });

    // 3) Verifikasi kepemilikan rekening di Services DB
    const [[acct]] = await pool.query(
      `SELECT account_number
         FROM portfolio_accounts
        WHERE customer_id = ? AND account_number = ?
        LIMIT 1`,
      [login.customer_id, accountNumber]
    );
    if (!acct)
      return res.status(404).json({
        status: "error",
        message: "Rekening tidak ditemukan untuk pengguna ini",
      });

    // 4) Forward ke Middleware (POST) → Core (GET)
    const mwUrl = `${process.env.MIDDLEWARE_BASE}/api/v1/history/mutations`;
    const mwResp = await axios.post(
      mwUrl,
      { account_number: accountNumber },
      {
        headers: { "X-API-Key": process.env.MIDDLEWARE_API_KEY },
      }
    );

    // 5) Propagasi hasil ke frontend
    return res.status(mwResp.status).json(mwResp.data);
  } catch (e) {
    const status = e.response?.status || 502;
    const data = e.response?.data || {
      status: "error",
      message: "Middleware unreachable or error",
    };
    return res.status(status).json(data);
  }
});

/**
 * GET /api/v1/history/transactions
 * Headers:
 *  - Authorization-Username
 *  - Authorization-Password
 *  - X-API-Key (sudah dicek di app.js)
 * Query (disarankan):
 *  - account_number=101202501
 * Body (opsional, jika tetap ingin mengikuti spek semula):
 *  - { "account_number": "101202501" }
 */
router.get("/transactions", async (req, res) => {
  try {
    // 1) Ambil kredensial dari header
    const username = req.header("Authorization-Username");
    const password = req.header("Authorization-Password");
    if (!username || !password) {
      return res.status(400).json({
        status: "error",
        message:
          "Header Authorization-Username dan Authorization-Password wajib diisi",
      });
    }

    // 2) Validasi user
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

    // 3) Ambil account_number (query lebih disarankan)
    const accountNumber = (
      req.query.account_number ||
      req.body?.account_number ||
      ""
    )
      .toString()
      .trim();
    if (!accountNumber) {
      return res
        .status(400)
        .json({ status: "error", message: "account_number wajib dikirim" });
    }

    // 4) Verifikasi kepemilikan rekening
    const [[acct]] = await pool.query(
      `SELECT account_number
         FROM portfolio_accounts
        WHERE customer_id = ? AND account_number = ?
        LIMIT 1`,
      [login.customer_id, accountNumber]
    );
    if (!acct) {
      return res.status(404).json({
        status: "error",
        message: "Rekening tidak ditemukan untuk pengguna ini",
      });
    }

    // 5) Query transaksi (terbaru dulu)
    const [rows] = await pool.query(
      `SELECT transaction_id, txn_time, type, bank, target_account_number, amount, currency, description
         FROM transactions
        WHERE account_number = ?
        ORDER BY txn_time DESC, id DESC`,
      [accountNumber]
    );

    if (!rows.length) {
      return res.status(404).json({
        status: "error",
        message: "Tidak ada transaksi ditemukan untuk rekening ini",
      });
    }

    // 6) Bentuk response
    const data = rows.map((r) => ({
      transaction_id: r.transaction_id,
      date: new Date(r.txn_time).toISOString(),
      type: r.type,
      bank: r.bank,
      target_account_number: r.target_account_number,
      amount: Number(r.amount),
      currency: r.currency || "IDR",
      description: r.description || "",
    }));

    return res.json({
      status: "success",
      message: "Riwayat transaksi berhasil diambil",
      data,
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ status: "error", message: "Internal Server Error" });
  }
});

export default router;
