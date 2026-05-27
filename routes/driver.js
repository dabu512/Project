const express = require('express');
const router = express.Router();
const pool = require('../db');

// --- 1. LẤY DISTRICT VÀ BASIC UNITS CỦA DRIVER (Ở BẢN ĐỒ APPLIED) ---
router.get('/district', async (req, res) => {
    const { driverId } = req.query;
    try {
        if (!driverId) {
            return res.status(400).json({ success: false, message: 'Thiếu driverId' });
        }

        // B1: Tìm province_id của driver trong bảng users
        const userRes = await pool.query('SELECT province_id FROM users WHERE id = $1', [driverId]);
        if (userRes.rows.length === 0 || !userRes.rows[0].province_id) {
            return res.json({
                success: true,
                hasDistrict: false,
                message: 'Tài xế chưa được phân công quản lý Tỉnh nào.'
            });
        }
        const provinceId = userRes.rows[0].province_id;

        // B2: Tìm phiên bản 'applied' có province_id tương ứng trong bảng versions
        const versionRes = await pool.query(
            "SELECT * FROM versions WHERE province_id = $1 AND status = 'applied' LIMIT 1",
            [provinceId]
        );

        if (versionRes.rows.length === 0) {
            return res.json({
                success: true,
                hasDistrict: false,
                message: 'Không tìm thấy phiên bản chính thức nào được áp dụng cho Tỉnh này.'
            });
        }

        // Trả về thông tin phiên bản này
        res.json({
            success: true,
            hasDistrict: true,
            version: versionRes.rows[0]
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- 2. LẤY KPI CÁ NHÂN ---
router.get('/kpi', async (req, res) => {
    res.json({
        success: true,
        hasDistrict: false,
        message: 'Chức năng đang được cập nhật'
    });
});

// --- 3. CẬP NHẬT HỒ SƠ TÀI XẾ (Họ tên, Mật khẩu, Tỉnh/thành phố hoạt động) ---
router.put('/profile', async (req, res) => {
    const { driverId, fullName, password, province_id } = req.body;
    try {
        if (!driverId) {
            return res.status(400).json({ success: false, message: 'Thiếu driverId' });
        }
        
        let query = "UPDATE users SET full_name = $1, province_id = $2";
        let params = [fullName, province_id ? parseInt(province_id) : null];
        
        if (password) {
            query += ", password = $3 WHERE id = $4 RETURNING id, username, role, full_name, province_id";
            params.push(password, driverId);
        } else {
            query += " WHERE id = $3 RETURNING id, username, role, full_name, province_id";
            params.push(driverId);
        }
        
        const result = await pool.query(query, params);
        if (result.rows.length > 0) {
            res.json({ success: true, user: result.rows[0], message: "Cập nhật hồ sơ thành công!" });
        } else {
            res.status(404).json({ success: false, message: "Không tìm thấy tài xế" });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
