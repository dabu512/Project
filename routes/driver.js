const express = require('express');
const router = express.Router();
const pool = require('../db');

// --- 1. LẤY DISTRICT VÀ BASIC UNITS CỦA DRIVER (Ở BẢN ĐỒ APPLIED) ---
router.get('/district', async (req, res) => {
    res.json({
        success: true,
        hasDistrict: false,
        message: 'Bạn chưa được phân công quản lý vùng nào ở phiên bản chính thức. (Chức năng đang được cập nhật)'
    });
});

// --- 2. LẤY KPI CÁ NHÂN ---
router.get('/kpi', async (req, res) => {
    res.json({
        success: true,
        hasDistrict: false,
        message: 'Chức năng đang được cập nhật'
    });
});

module.exports = router;
