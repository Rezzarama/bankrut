import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

// Guard: hanya dari Middleware
router.use((req, res, next) => {
  const key = req.header("X-API-Key");
  if (!key || key !== process.env.CORE_API_KEY) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }
  next();
});

/**
 * POST /api/v1/accounts/sync
 * Body: { account_number }
 * Return: customer, portfolio, transactions[], mutations[]
 */
router.post("/sync", async (req, res) => {
  try {
    const acc = (req.body?.account_number || "").toString().trim();
    if (!acc)
      return res
        .status(400)
        .json({ status: "error", message: "account_number wajib dikirim" });

    // Ambil portfolio & customer (join via account_number)
    const [[acct]] = await pool.query(
      `SELECT a.account_number, a.balance, a.currency_code, a.status, a.created_at AS open_date,
              c.full_name, c.birth_date, c.nik, c.address, c.phone_number, c.email
         FROM core_accounts a
         JOIN core_customers c ON c.customer_id_services = a.customer_id_services
        WHERE a.account_number = ?
        LIMIT 1`,
      [acc]
    );
    if (!acct)
      return res
        .status(404)
        .json({ status: "error", message: "Akun tidak ditemukan di Core" });

    const [txs] = await pool.query(
      `SELECT transaction_id, txn_time, type, bank, target_account_number, amount, currency, description
         FROM transactions
        WHERE account_number = ?
        ORDER BY txn_time DESC, id DESC`,
      [acc]
    );

    const [muts] = await pool.query(
      `SELECT mutation_id, txn_time, type, amount, balance_after, description
         FROM mutations
        WHERE account_number = ?
        ORDER BY txn_time DESC, id DESC`,
      [acc]
    );

    return res.json({
      status: "success",
      message: "Snapshot akun berhasil diambil",
      data: {
        account_number: acct.account_number,
        customer: {
          full_name: acct.full_name,
          birth_date: acct.birth_date,
          NIK: acct.nik,
          address: acct.address,
          phone_number: acct.phone_number,
          email: acct.email,
        },
        portfolio: {
          balance: Number(acct.balance),
          status: acct.status,
          currency_code: acct.currency_code || "IDR",
          open_date: acct.open_date
            ? new Date(acct.open_date).toISOString().slice(0, 10)
            : null,
        },
        transactions: txs.map((t) => ({
          transaction_id: t.transaction_id,
          date: new Date(t.txn_time).toISOString(),
          type: t.type,
          bank: t.bank,
          target_account_number: t.target_account_number,
          amount: Number(t.amount),
          currency: t.currency || "IDR",
          description: t.description || "",
        })),
        mutations: muts.map((m) => ({
          mutation_id: m.mutation_id,
          date: new Date(m.txn_time).toISOString(),
          type: m.type,
          amount: Number(m.amount),
          balance_after: Number(m.balance_after),
          description: m.description || "",
        })),
      },
    });
  } catch (e) {
    console.error(e);
    return res
      .status(500)
      .json({ status: "error", message: "Internal Server Error" });
  }
});

export default router;
