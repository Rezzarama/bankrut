import { Router } from "express";
import { pool } from "../db.js";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";

const router = Router();

// Guard API key dari Services → Middleware
router.use((req, res, next) => {
  const key = req.header("X-API-Key");
  if (!key || key !== process.env.MIDDLEWARE_API_KEY) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }
  next();
});

router.post("/accounts/sync", async (req, res) => {
  const trace_id = uuidv4();
  const payload = req.body;

  // Validasi minimal
  const required = [
    "customer_id",
    "full_name",
    "birth_date",
    "nik",
    "address",
    "phone_number",
    "email",
    "account_number",
    "balance",
    "status",
  ];
  const missing = required.filter((k) => payload[k] === undefined);
  if (missing.length)
    return res
      .status(400)
      .json({ status: "error", message: `Missing: ${missing.join(", ")}` });

  // Audit: simpan request
  const [ins] = await pool.query(
    `INSERT INTO audit_logs(trace_id,source,target,request_json) VALUES (?,?,?,JSON_OBJECT())`,
    [trace_id, "services", "core"]
  );
  await pool.query(`UPDATE audit_logs SET request_json=? WHERE id=?`, [
    JSON.stringify(payload),
    ins.insertId,
  ]);

  try {
    const coreResp = await axios.post(
      `${process.env.CORE_BASE}/api/v1/accounts/create`,
      {
        customer_id: payload.customer_id,
        account_number: payload.account_number,
        full_name: payload.full_name,
        birth_date: payload.birth_date,
        nik: payload.nik,
        address: payload.address,
        phone_number: payload.phone_number,
        email: payload.email,
        balance: payload.balance,
        currency_code: "IDR",
        status: payload.status,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": process.env.CORE_API_KEY,
        },
      }
    );

    await pool.query(
      `UPDATE audit_logs SET response_json=?, status_code=? WHERE id=?`,
      [JSON.stringify(coreResp.data), coreResp.status, ins.insertId]
    );

    return res.json({
      status: "success",
      message: "Data nasabah berhasil diteruskan ke core system",
      core_reference_id: coreResp.data?.core_reference_id || null,
      trace_id,
    });
  } catch (err) {
    await pool.query(
      `UPDATE audit_logs SET response_json=?, status_code=? WHERE id=?`,
      [
        JSON.stringify({ error: err.message }),
        err.response?.status || 500,
        ins.insertId,
      ]
    );
    return res.status(502).json({
      status: "error",
      message: "Core unreachable or error",
      trace_id,
    });
  }
});

export default router;
