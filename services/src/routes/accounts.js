import { Router } from "express";
import { pool } from "../db.js";
import bcrypt from "bcryptjs";

const router = Router();

/**
 * GET /api/v1/accounts/balance
 * Headers:
 *  - Authorization-Username: <username>
 *  - Authorization-Password: <password>
 *  - X-API-Key: <services api key>
 * Query (opsional):
 *  - account_number=101202501
 *
 * Res (success):
 * {
 *   "status":"success",
 *   "message":"Data saldo berhasil diambil",
 *   "data":{
 *     "full_name":"Budi Santoso",
 *     "account_number":"101202501",
 *     "currency_code":"IDR",
 *     "balance":2500000.00,
 *     "status":"Active",
 *     "last_updated":"2025-10-13T09:20:00.000Z"
 *   }
 * }
 */
router.get("/balance", async (req, res) => {
  try {
    // 1) Ambil kredensial ringan dari header (sesuai spesifikasi)
    const username = req.header("Authorization-Username");
    const password = req.header("Authorization-Password");
    if (!username || !password) {
      return res.status(400).json({
        status: "error",
        message:
          "Header Authorization-Username dan Authorization-Password wajib diisi",
      });
    }

    // 2) Validasi user ke tabel logins
    const [[login]] = await pool.query(
      `SELECT id AS login_id, customer_id, username, password_hash
         FROM logins
        WHERE username = ?
        LIMIT 1`,
      [username]
    );
    if (!login) {
      return res
        .status(404)
        .json({ status: "error", message: "Username tidak ditemukan" });
    }

    const ok = await bcrypt.compare(password, login.password_hash);
    if (!ok) {
      return res
        .status(401)
        .json({ status: "error", message: "Username atau password salah" });
    }

    // 3) Ambil parameter rekening (opsional)
    const accountNumberQ = (req.query.account_number || "").trim();

    // 4) Ambil data customer (untuk full_name)
    const [[customer]] = await pool.query(
      `SELECT id AS customer_id, full_name
         FROM customers
        WHERE id = ?
        LIMIT 1`,
      [login.customer_id]
    );
    if (!customer) {
      return res
        .status(404)
        .json({ status: "error", message: "Data nasabah tidak ditemukan" });
    }

    // 5) Ambil rekening by customer_id (+ filter account_number bila ada)
    let acctRow;
    if (accountNumberQ) {
      [[acctRow]] = await pool.query(
        `SELECT account_number, balance, currency_code, status, updated_at
           FROM portfolio_accounts
          WHERE customer_id = ? AND account_number = ?
          LIMIT 1`,
        [login.customer_id, accountNumberQ]
      );
    } else {
      [[acctRow]] = await pool.query(
        `SELECT account_number, balance, currency_code, status, updated_at
           FROM portfolio_accounts
          WHERE customer_id = ?
          ORDER BY id ASC
          LIMIT 1`,
        [login.customer_id]
      );
    }

    if (!acctRow) {
      return res.status(404).json({
        status: "error",
        message: "Rekening tidak ditemukan untuk pengguna ini",
      });
    }

    // 6) Susun response
    return res.json({
      status: "success",
      message: "Data saldo berhasil diambil",
      data: {
        full_name: customer.full_name,
        account_number: acctRow.account_number,
        currency_code: acctRow.currency_code || "IDR",
        balance: Number(acctRow.balance),
        status: acctRow.status,
        last_updated: acctRow.updated_at
          ? new Date(acctRow.updated_at).toISOString()
          : null,
      },
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ status: "error", message: "Internal Server Error" });
  }
});

export default router;
