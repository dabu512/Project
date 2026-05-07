const express = require('express');
const router = express.Router();
const pool = require('../db');

// --- 1. LẤY DISTRICT VÀ BASIC UNITS CỦA DRIVER (Ở BẢN ĐỒ APPLIED) ---
router.get('/district', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ success: false, message: 'Thiếu userId' });

    try {
        // Find the distinct that is assigned to this driver in any "applied" version
        const distQuery = `
            SELECT d.id, d.name, d.color, d.version_id
            FROM districts d
            JOIN versions v ON d.version_id = v.id
            WHERE d.driver_id = $1 AND v.status = 'applied'
            LIMIT 1
        `;
        const distRes = await pool.query(distQuery, [userId]);

        if (distRes.rows.length === 0) {
            return res.json({
                success: true,
                hasDistrict: false,
                message: 'Bạn chưa được phân công quản lý vùng nào ở phiên bản chính thức.'
            });
        }

        const district = distRes.rows[0];

        // Lấy tất cả Basic Units thuộc District này
        const buQuery = `
            SELECT bu.*, ST_AsGeoJSON(bu.geom)::json as geometry
            FROM basic_units bu
            WHERE bu.district_id = $1
        `;
        const buRes = await pool.query(buQuery, [district.id]);

        const features = buRes.rows.map(row => ({
            type: 'Feature',
            id: row.id,
            properties: {
                name: row.name,
                customers: row.customer_count,
                orders: row.order_count,
                area: row.area_km2,
                color: district.color || row.color || "#3388ff",
                zoneName: district.name,
                districtId: district.id
            },
            geometry: row.geometry
        }));

        res.json({
            success: true,
            hasDistrict: true,
            districtInfo: district,
            geojson: { type: 'FeatureCollection', features }
        });

    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- 2. LẤY KPI CÁ NHÂN ---
router.get('/kpi', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ success: false, message: 'Thiếu userId' });

    try {
        const distQuery = `
            SELECT d.id, d.name, d.max_load_orders, v.id as version_id
            FROM districts d
            JOIN versions v ON d.version_id = v.id
            WHERE d.driver_id = $1 AND v.status = 'applied'
            LIMIT 1
        `;
        const distRes = await pool.query(distQuery, [userId]);

        if (distRes.rows.length === 0) {
            return res.json({ success: true, hasDistrict: false });
        }

        const district = distRes.rows[0];

        // Thống kê riêng cho Vùng này
        const statQuery = `
            SELECT 
                COUNT(*) as total_units,
                COALESCE(SUM(customer_count), 0)::int as total_customers,
                COALESCE(SUM(order_count), 0)::int as total_orders
            FROM basic_units
            WHERE district_id = $1
        `;
        const statRes = await pool.query(statQuery, [district.id]);
        const myStats = statRes.rows[0];

        // Tính trung bình toàn Province của Version này (hoặc toàn Hệ thống của Version này)
        const avgQuery = `
            SELECT 
                COUNT(d.id) as num_districts,
                COALESCE(SUM(bu.order_count), 0)::int as all_orders
            FROM districts d
            LEFT JOIN basic_units bu ON bu.district_id = d.id
            WHERE d.version_id = $1 AND d.id IN (SELECT DISTINCT district_id FROM basic_units WHERE district_id IS NOT NULL AND version_id = $1)
        `;
        const avgRes = await pool.query(avgQuery, [district.version_id]);

        const numDistricts = parseInt(avgRes.rows[0].num_districts);
        const allOrders = parseInt(avgRes.rows[0].all_orders);

        let avgOrders = 0;
        if (numDistricts > 0) avgOrders = allOrders / numDistricts;

        let deviation = '0%';
        if (myStats.total_units > 0 && avgOrders > 0) {
            const diff = myStats.total_orders - avgOrders;
            const percent = (diff / avgOrders * 100).toFixed(2);
            deviation = (percent > 0 ? '+' : '') + percent + '%';
        }

        res.json({
            success: true,
            hasDistrict: true,
            data: {
                districtName: district.name,
                totalUnits: myStats.total_units,
                totalCustomers: myStats.total_customers,
                totalOrders: myStats.total_orders,
                maxOrders: district.max_load_orders,
                avgSystemOrders: avgOrders.toFixed(1),
                deviation: deviation
            }
        });

    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
