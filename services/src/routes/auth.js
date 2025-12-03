import { Router } from "express";
import { pool } from "../db.js";
import axios from "axios";
import bcrypt from "bcryptjs";
import { registerSchema } from "../utils/validate.js";
import { generateAccountNumber } from "../utils/account.js";

const router = Router();

/**
 * POST /api/v1/auth/login
 * Body: { username, password }
 * Res (success):
 * {
 *   "status":"success",
 *   "message":"Login berhasil",
 *   "data": { "customer_id", "full_name", "account_number", "status" }
 * }
 */
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({
        status: "error",
        message: "Username dan password wajib diisi",
      });
    }

    // 1) Ambil user login
    const [rows] = await pool.query(
      `SELECT l.id AS login_id, l.customer_id, l.username, l.password_hash
         FROM logins l
        WHERE l.username = ?
        LIMIT 1`,
      [username]
    );

    if (!rows.length) {
      // Username tidak ada
      return res
        .status(404)
        .json({ status: "error", message: "Username tidak ditemukan" });
    }

    const login = rows[0];

    // 2) Verifikasi password
    const ok = await bcrypt.compare(password, login.password_hash);
    if (!ok) {
      // Password salah
      return res
        .status(401)
        .json({ status: "error", message: "Username atau password salah" });
    }

    // 3) Ambil data customers + portfolio_accounts
    const [[customer]] = await pool.query(
      `SELECT c.id AS customer_id, c.full_name
         FROM customers c
        WHERE c.id = ?
        LIMIT 1`,
      [login.customer_id]
    );

    const [[acct]] = await pool.query(
      `SELECT p.account_number, p.status
         FROM portfolio_accounts p
        WHERE p.customer_id = ?
        ORDER BY p.id ASC
        LIMIT 1`,
      [login.customer_id]
    );

    // 4) Update last_login
    await pool.query(`UPDATE logins SET last_login = NOW() WHERE id = ?`, [
      login.login_id,
    ]);

    // 5) Response
    return res.json({
      status: "success",
      message: "Login berhasil",
      data: {
        customer_id: customer?.customer_id || login.customer_id,
        full_name: customer?.full_name || null,
        account_number: acct?.account_number || null,
        status: acct?.status || "Active",
      },
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ status: "error", message: "Internal Server Error" });
  }
});

router.post("/register", async (req, res) => {
  try {
    // 1) Validasi payload
    const { error, value } = registerSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      return res.status(400).json({
        status: "error",
        message: error.details.map((d) => d.message).join("; "),
      });
    }

    const {
      full_name,
      birth_date,
      address,
      nik,
      phone_number,
      email,
      username,
      password,
      PIN,
    } = value;

    // 2) Cek unik NIK/email/username
    const [existsNik] = await pool.query(
      `SELECT id FROM customers WHERE nik=? LIMIT 1`,
      [nik]
    );
    if (existsNik.length)
      return res
        .status(409)
        .json({ status: "error", message: "NIK sudah dipakai" });

    const [existsEmail] = await pool.query(
      `SELECT id FROM customers WHERE email=? LIMIT 1`,
      [email]
    );
    if (existsEmail.length)
      return res
        .status(409)
        .json({ status: "error", message: "Email sudah dipakai" });

    const [existsUser] = await pool.query(
      `SELECT id FROM logins WHERE username=? LIMIT 1`,
      [username]
    );
    if (existsUser.length)
      return res
        .status(409)
        .json({ status: "error", message: "Username sudah dipakai" });

    // 3) Transaction insert
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [custRes] = await conn.query(
        `INSERT INTO customers(full_name,birth_date,address,nik,phone_number,email)
         VALUES (?,?,?,?,?,?)`,
        [full_name, birth_date, address, nik, phone_number, email]
      );
      const customer_id = custRes.insertId;

      const password_hash = await bcrypt.hash(password, 10);
      const pin_hash = await bcrypt.hash(PIN, 12);

      await conn.query(
        `INSERT INTO logins(customer_id,username,password_hash,pin_hash)
         VALUES (?,?,?,?)`,
        [customer_id, username, password_hash, pin_hash]
      );

      const account_number = generateAccountNumber(customer_id);
      await conn.query(
        `INSERT INTO portfolio_accounts(customer_id,account_number,balance,status)
         VALUES (?,?,0.00,'Active')`,
        [customer_id, account_number]
      );

      await conn.commit();

      // 4) Call Middleware
      const payload = {
        customer_id,
        full_name,
        birth_date,
        nik,
        address,
        phone_number,
        email,
        account_number,
        balance: 0,
        status: "Active",
      };

      const mwResp = await axios.post(
        `${process.env.MIDDLEWARE_BASE}/core/accounts/sync`,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": process.env.MIDDLEWARE_API_KEY,
          },
        }
      );

      return res.json({
        status: "success",
        message: "Registrasi berhasil dan data disinkronkan dengan core system",
        data: {
          customer_id,
          account_number,
          full_name,
          core_reference_id: mwResp?.data?.core_reference_id || null,
        },
      });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ status: "error", message: "Internal Server Error" });
  }
});

export default router;
