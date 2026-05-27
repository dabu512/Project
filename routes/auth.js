const express = require("express");
const router = express.Router();
const pool = require("../db"); // Lấy kết nối từ file db.js

// API Login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT id, username, role, full_name, province_id FROM users WHERE username = $1 AND password = $2",
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
  const { province_id, version_id } = req.query;
  try {
    let query = "SELECT id, full_name, username, province_id FROM users WHERE role = 'driver'";
    let params = [];
    
    if (province_id) {
      query += " AND province_id = $1";
      params.push(parseInt(province_id));
      
      if (version_id) {
        query += " AND id NOT IN (SELECT DISTINCT driver_id FROM basic_units WHERE version_id = $2 AND driver_id IS NOT NULL)";
        params.push(parseInt(version_id));
      }
    }
    
    query += " ORDER BY full_name";
    
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
