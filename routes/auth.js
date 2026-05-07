const express = require("express");
const router = express.Router();
const pool = require("../db"); // Lấy kết nối từ file db.js

// API Login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT id, username, role, full_name FROM users WHERE username = $1 AND password = $2",
      [username, password],
    );
    if (result.rows.length > 0)
      res.json({ success: true, user: result.rows[0] });
    else res.json({ success: false, message: "Sai tài khoản hoặc mật khẩu!" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/register", async (req, res) => {
  const { username, password, fullName, role, province_id } = req.body;
  try {
    await pool.query(
      "INSERT INTO users (username, password, full_name, role, province_id) VALUES ($1, $2, $3, $4, $5)",
      [username, password, fullName, role, province_id || null],
    );
    res.json({ success: true, message: "Đăng ký thành công!" });
  } catch (err) {
    if (err.code === "23505") {
      // 23505 là mã lỗi unique_violation của PostgreSQL
      return res.status(400).json({
        success: false,
        message: "Tài khoản này đã có người dùng",
      });
    }
    res
      .status(500)
      .json({ success: false, message: "Lỗi hệ thống: " + err.message });
  }
});
router.get("/drivers", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, full_name, username, province_id FROM users WHERE role = 'driver'",
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
