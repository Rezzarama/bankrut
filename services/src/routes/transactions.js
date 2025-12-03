import { Router } from "express";
import { pool } from "../db.js";
import bcrypt from "bcryptjs";
import axios from "axios";

const router = Router();

router.post("/", async (req, res) => {
  try {
    // 1) Autentikasi user
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
      `SELECT id AS login_id, customer_id, password_hash FROM logins WHERE username = ? LIMIT 1`,
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

    // 2) Ambil rekening sumber otomatis dari user yang login
    const [[srcAcc]] = await pool.query(
      `SELECT account_number, balance, currency_code
         FROM portfolio_accounts
        WHERE customer_id = ?
        ORDER BY id ASC
        LIMIT 1`,
      [login.customer_id]
    );
    if (!srcAcc)
      return res
        .status(404)
        .json({
          status: "error",
          message: "Rekening sumber tidak ditemukan untuk pengguna ini",
        });

    const source_account_number = srcAcc.account_number;

    // 3) Validasi body
    const b = req.body || {};
    const dst = String(b.target_account_number || "").trim();
    const amt = Number(b.amount);
    const cur = (b.currency_code || "IDR").trim();
    const desc = b.description || `Transfer internal ke ${dst}`;
    const when = b.transaction_date ? new Date(b.transaction_date) : new Date();

    if (!dst || !amt || amt <= 0) {
      return res
        .status(400)
        .json({
          status: "error",
          message: "Target rekening dan jumlah wajib diisi",
        });
    }

    if (source_account_number === dst) {
      return res
        .status(400)
        .json({
          status: "error",
          message: "Rekening sumber dan tujuan tidak boleh sama",
        });
    }

    // 4) Cek saldo cukup
    if (Number(srcAcc.balance) < amt) {
      return res
        .status(400)
        .json({ status: "error", message: "Saldo tidak cukup" });
    }

    // 5) Kirim ke Middleware → Core
    const mwUrl = `${process.env.MIDDLEWARE_BASE}/api/v1/transactions/execute`;
    const mwResp = await axios.post(
      mwUrl,
      {
        transaction_type: "TrfOvrbok",
        transaction_bank: "Internal",
        source_account_number,
        target_account_number: dst,
        amount: amt,
        currency_code: cur,
        description: desc,
        transaction_date: when.toISOString(),
      },
      {
        headers: {
          "X-API-Key": process.env.MIDDLEWARE_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    if (mwResp.data?.status !== "success") {
      return res.status(502).json({
        status: "error",
        message: mwResp.data?.message || "Transaksi gagal di Core",
      });
    }

    // 6) Update saldo lokal & simpan transaksi
    const txId = mwResp.data.transaction_id;
    const muts = mwResp.data.mutations || [];

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const m of muts) {
        await conn.query(
          `UPDATE portfolio_accounts SET balance = ? WHERE account_number = ?`,
          [m.balance_after, m.account_number]
        );
      }

      await conn.query(
        `INSERT INTO transactions
           (account_number, transaction_id, txn_time, type, bank, target_account_number, amount, currency, description)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE txn_time=VALUES(txn_time), amount=VALUES(amount), description=VALUES(description)`,
        [
          source_account_number,
          txId,
          when,
          "TrfOvrbok",
          "Internal",
          dst,
          amt,
          cur,
          desc,
        ]
      );

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    return res.json({
      status: "success",
      message: "Transaksi sukses",
      data: {
        transaction_id: txId,
        source_account_number,
        target_account_number: dst,
        amount: amt,
      },
    });
  } catch (e) {
    const status = e.response?.status || 502;
    const data = e.response?.data || {
      status: "error",
      message:
        "Transaksi gagal, saldo tidak cukup atau rekening tujuan invalid",
    };
    return res.status(status).json(data);
  }
});

export default router;

// import { Router } from "express";
// import { pool } from "../db.js";
// import bcrypt from "bcryptjs";
// import axios from "axios";

// const router = Router();

// /**
//  * POST /api/v1/transactions
//  * Headers:
//  *  - Authorization-Username
//  *  - Authorization-Password
//  * Body:
//  *  {
//  *    transaction_type: "TrfOvrbok",
//  *    transaction_bank: "Internal",
//  *    source_account_number, target_account_number,
//  *    amount, currency_code, description, transaction_date
//  *  }
//  */
// router.post("/", async (req, res) => {
//   try {
//     // 1) Auth ringan
//     const username = req.header("Authorization-Username");
//     const password = req.header("Authorization-Password");
//     if (!username || !password) {
//       return res.status(400).json({
//         status: "error",
//         message:
//           "Header Authorization-Username dan Authorization-Password wajib diisi",
//       });
//     }
//     const [[login]] = await pool.query(
//       `SELECT id AS login_id, customer_id, password_hash FROM logins WHERE username = ? LIMIT 1`,
//       [username]
//     );
//     if (!login)
//       return res
//         .status(404)
//         .json({ status: "error", message: "Username tidak ditemukan" });
//     const ok = await bcrypt.compare(password, login.password_hash);
//     if (!ok)
//       return res
//         .status(401)
//         .json({ status: "error", message: "Username atau password salah" });

//     // 2) Validasi payload
//     const b = req.body || {};
//     const required = [
//       "transaction_type",
//       "transaction_bank",
//       "source_account_number",
//       "target_account_number",
//       "amount",
//     ];
//     const missing = required.filter(
//       (k) => b[k] === undefined || b[k] === null || b[k] === ""
//     );
//     if (missing.length)
//       return res
//         .status(400)
//         .json({ status: "error", message: `Missing: ${missing.join(", ")}` });

//     if (
//       b.transaction_type !== "TrfOvrbok" ||
//       b.transaction_bank !== "Internal"
//     ) {
//       return res.status(400).json({
//         status: "error",
//         message: "Hanya mendukung TrfOvrbok Internal",
//       });
//     }
//     const src = String(b.source_account_number).trim();
//     const dst = String(b.target_account_number).trim();
//     const amt = Number(b.amount);
//     const cur = (b.currency_code || "IDR").trim();
//     const desc = b.description || `Transfer internal ke ${dst}`;
//     const when = b.transaction_date ? new Date(b.transaction_date) : new Date();

//     if (!src || !dst || !amt || amt <= 0) {
//       return res
//         .status(400)
//         .json({ status: "error", message: "Input tidak valid" });
//     }
//     if (src === dst) {
//       return res.status(400).json({
//         status: "error",
//         message: "Rekening sumber dan tujuan tidak boleh sama",
//       });
//     }

//     // 3) Verifikasi kepemilikan sumber & saldo lokal
//     const [[srcRow]] = await pool.query(
//       `SELECT id, customer_id, account_number, balance, currency_code FROM portfolio_accounts WHERE customer_id = ? AND account_number = ? LIMIT 1`,
//       [login.customer_id, src]
//     );
//     if (!srcRow)
//       return res.status(404).json({
//         status: "error",
//         message: "Rekening sumber tidak ditemukan untuk pengguna ini",
//       });
//     if (srcRow.currency_code !== cur)
//       return res.status(400).json({
//         status: "error",
//         message: "Mata uang tidak sesuai dengan rekening sumber",
//       });
//     if (Number(srcRow.balance) < amt)
//       return res
//         .status(400)
//         .json({ status: "error", message: "Saldo tidak cukup" });

//     // (Opsional) cek tujuan di local (jika ingin)
//     const [[dstRowMaybe]] = await pool.query(
//       `SELECT id, account_number, balance, currency_code FROM portfolio_accounts WHERE account_number = ? LIMIT 1`,
//       [dst]
//     );
//     if (dstRowMaybe && dstRowMaybe.currency_code !== cur) {
//       return res.status(400).json({
//         status: "error",
//         message: "Mata uang tidak sesuai dengan rekening tujuan lokal",
//       });
//     }

//     // 4) (Opsional) simpan transaksi pending — dilewati untuk ringkas

//     // 5) Forward ke Middleware → Core
//     const mwUrl = `${process.env.MIDDLEWARE_BASE}/api/v1/transactions/execute`;
//     const mwResp = await axios.post(
//       mwUrl,
//       {
//         transaction_type: "TrfOvrbok",
//         transaction_bank: "Internal",
//         source_account_number: src,
//         target_account_number: dst,
//         amount: amt,
//         currency_code: cur,
//         description: desc,
//         transaction_date: when.toISOString(),
//       },
//       {
//         headers: {
//           "X-API-Key": process.env.MIDDLEWARE_API_KEY,
//           "Content-Type": "application/json",
//         },
//       }
//     );

//     if (mwResp.data?.status !== "success") {
//       return res.status(502).json({
//         status: "error",
//         message: mwResp.data?.message || "Transaksi gagal di Core",
//       });
//     }

//     // 6) Propagasi & sinkronisasi lokal
//     const txId = mwResp.data.transaction_id;
//     const muts = mwResp.data.mutations || [];

//     const conn = await pool.getConnection();
//     try {
//       await conn.beginTransaction();

//       // 6a) Update saldo lokal berdasarkan mutasi (sumber & tujuan jika ada di lokal)
//       for (const m of muts) {
//         const acc = m.account_number;
//         const balAfter = Number(m.balance_after);
//         await conn.query(
//           `UPDATE portfolio_accounts SET balance = ? WHERE account_number = ?`,
//           [balAfter, acc]
//         );
//       }

//       // 6b) Simpan transaksi (baris sumber)
//       await conn.query(
//         `INSERT INTO transactions
//            (account_number, transaction_id, txn_time, type, bank, target_account_number, amount, currency, description)
//          VALUES (?,?,?,?,?,?,?,?,?)
//          ON DUPLICATE KEY UPDATE
//            txn_time = VALUES(txn_time),
//            type = VALUES(type),
//            bank = VALUES(bank),
//            target_account_number = VALUES(target_account_number),
//            amount = VALUES(amount),
//            currency = VALUES(currency),
//            description = VALUES(description)`,
//         [src, txId, when, "TrfOvrbok", "Internal", dst, amt, cur, desc]
//       );

//       // 6c) Simpan mutasi lokal dari Core
//       for (const m of muts) {
//         const mutId =
//           m.mutation_type === "Debit" ? `MUT-${txId}-SRC` : `MUT-${txId}-DST`;
//         await conn.query(
//           `INSERT INTO mutations
//              (account_number, mutation_id, txn_time, type, amount, balance_after, description)
//            VALUES (?,?,?,?,?,?,?)
//            ON DUPLICATE KEY UPDATE
//              txn_time = VALUES(txn_time),
//              type = VALUES(type),
//              amount = VALUES(amount),
//              balance_after = VALUES(balance_after),
//              description = VALUES(description)`,
//           [
//             m.account_number,
//             mutId,
//             when,
//             m.mutation_type,
//             amt,
//             m.balance_after,
//             m.mutation_type === "Debit"
//               ? `Transfer ke ${dst}`
//               : `Transfer dari ${src}`,
//           ]
//         );
//       }

//       await conn.commit();
//     } catch (e) {
//       await conn.rollback();
//       throw e;
//     } finally {
//       conn.release();
//     }

//     // 7) Response ke frontend
//     return res.json({
//       status: "success",
//       message: "Transaksi sukses",
//       data: {
//         transaction_id: txId,
//         source_account_number: src,
//         target_account_number: dst,
//         amount: amt,
//       },
//     });
//   } catch (e) {
//     const status = e.response?.status || 502;
//     const data = e.response?.data || {
//       status: "error",
//       message:
//         "Transaksi gagal, saldo tidak cukup atau rekening tujuan invalid",
//     };
//     return res.status(status).json(data);
//   }
// });

// export default router;
