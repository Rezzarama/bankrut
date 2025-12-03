import { Router } from "express";
import { pool } from "../db.js";
import bcrypt from "bcryptjs";

const router = Router();

/**
 * GET /api/v1/customers/detail
 * Headers:
 *  - Authorization-Username
 *  - Authorization-Password
 * Response (success):
 * {
 *   status: "success",
 *   message: "Data profil nasabah berhasil diambil",
 *   data: {
 *     full_name, birth_date, address, phone_number, email,
 *     account_number, currency_code, balance, status, last_updated
 *   }
 * }
 */
router.get("/detail", async (req, res) => {
  try {
    const username = req.header("Authorization-Username");
    const password = req.header("Authorization-Password");
    if (!username || !password) {
      return res
        .status(400)
        .json({
          status: "error",
          message:
            "Header Authorization-Username dan Authorization-Password wajib diisi",
        });
    }

    // 1) Validasi login
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

    // 2) Ambil profil nasabah
    const [[cust]] = await pool.query(
      `SELECT full_name, birth_date, address, phone_number, email
         FROM customers
        WHERE id = ?
        LIMIT 1`,
      [login.customer_id]
    );
    if (!cust)
      return res
        .status(404)
        .json({ status: "error", message: "Data nasabah tidak ditemukan" });

    // 3) Ambil info rekening (ambil yang pertama; sesuaikan jika multi-rekening)
    const [[acct]] = await pool.query(
      `SELECT account_number, balance, currency_code, status, COALESCE(updated_at, created_at) AS last_updated
         FROM portfolio_accounts
        WHERE customer_id = ?
        ORDER BY id ASC
        LIMIT 1`,
      [login.customer_id]
    );
    if (!acct) {
      return res
        .status(404)
        .json({
          status: "error",
          message: "Rekening tidak ditemukan untuk pengguna ini",
        });
    }

    // 4) Response
    return res.json({
      status: "success",
      message: "Data profil nasabah berhasil diambil",
      data: {
        full_name: cust.full_name,
        birth_date: cust.birth_date
          ? new Date(cust.birth_date).toISOString().slice(0, 10)
          : null,
        address: cust.address,
        phone_number: cust.phone_number,
        email: cust.email,
        account_number: acct.account_number,
        currency_code: acct.currency_code || "IDR",
        balance: Number(acct.balance),
        status: acct.status,
        last_updated: acct.last_updated
          ? new Date(acct.last_updated).toISOString()
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
