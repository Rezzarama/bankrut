import { Router } from "express";
import { pool } from "../db.js";
import { genCoreRefId } from "../utils/id.js";

const router = Router();

// Guard API key dari Middleware → Core
router.use((req, res, next) => {
  const key = req.header("X-API-Key");
  if (!key || key !== process.env.CORE_API_KEY) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }
  next();
});

router.post("/create", async (req, res) => {
  try {
    const r = req.body;
    const required = [
      "customer_id",
      "account_number",
      "full_name",
      "birth_date",
      "nik",
      "address",
      "phone_number",
      "email",
      "balance",
      "currency_code",
      "status",
    ];
    const missing = required.filter((k) => r[k] === undefined);
    if (missing.length) {
      return res
        .status(400)
        .json({ status: "error", message: `Missing: ${missing.join(", ")}` });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Simpan core_customers (sederhana—tidak cek double insert per demo)
      await conn.query(
        `INSERT INTO core_customers (customer_id_services,full_name,birth_date,nik,address,phone_number,email)
         VALUES (?,?,?,?,?,?,?)`,
        [
          r.customer_id,
          r.full_name,
          r.birth_date,
          r.nik,
          r.address,
          r.phone_number,
          r.email,
        ]
      );

      const core_reference_id = genCoreRefId();

      await conn.query(
        `INSERT INTO core_accounts (customer_id_services,account_number,balance,currency_code,status,core_reference_id)
         VALUES (?,?,?,?,?,?)`,
        [
          r.customer_id,
          r.account_number,
          r.balance,
          r.currency_code,
          r.status,
          core_reference_id,
        ]
      );

      await conn.commit();

      return res.json({
        status: "success",
        message: "Akun nasabah berhasil dibuat di Core System",
        core_reference_id,
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
