const express = require('express');
const router = express.Router();
const pool = require('../db');

// --- 1. LẤY DANH SÁCH KHU VỰC ---
router.get('/regions', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM regions ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- 2. LẤY DANH SÁCH TỈNH THEO KHU VỰC ---
router.get('/provinces', async (req, res) => {
    const { region_id } = req.query;
    try {
        let query = 'SELECT * FROM provinces';
        let params = [];
        if (region_id) {
            query += ' WHERE region_id = $1';
            params.push(region_id);
        }
        query += ' ORDER BY id';
        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- 3. LẤY DANH SÁCH PHIÊN BẢN (VERSIONS) THEO TỈNH ---
router.get('/versions', async (req, res) => {
    const { province_id } = req.query;
    try {
        let query = 'SELECT * FROM versions';
        let params = [];
        if (province_id) {
            query += ' WHERE province_id = $1';
            params.push(province_id);
        }
        query += ' ORDER BY created_at DESC';
        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- 4. TẠO VERSION MỚI (BẢN NHÁP) ---
router.post('/versions', async (req, res) => {
    const { name, province_id, source_version_id } = req.body;
    try {
        // Bắt đầu transaction
        await pool.query('BEGIN');

        // B1: Tạo bản ghi Version mới
        const vRes = await pool.query(
            `INSERT INTO versions (name, province_id, status) VALUES ($1, $2, 'draft') RETURNING id`,
            [name, province_id]
        );
        const newVersionId = vRes.rows[0].id;

        if (source_version_id) {
            // Copy Basic Units từ source qua newVersionId
            const buRes = await pool.query(`SELECT * FROM basic_units WHERE version_id = $1`, [source_version_id]);

            for (let bu of buRes.rows) {
                await pool.query(`
                    INSERT INTO basic_units (name, geom, customer_count, order_count, area_km2, centroid, created_by, color, version_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                `, [
                    bu.name, bu.geom, bu.customer_count, bu.order_count, bu.area_km2,
                    bu.centroid, bu.created_by, bu.color, newVersionId
                ]);
            }
        }

        await pool.query('COMMIT');
        res.json({ success: true, id: newVersionId, message: "Tạo version mới thành công!" });

    } catch (err) {
        await pool.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- 5. APPLY VERSION ---
router.put('/versions/:id/apply', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('BEGIN');

        // Find province of this version
        const vRes = await pool.query('SELECT province_id FROM versions WHERE id = $1', [id]);
        if (vRes.rows.length === 0) throw new Error("Version không tồn tại");
        const provId = vRes.rows[0].province_id;

        // Cập nhật các version khác có cùng province_id đang applied thành history
        await pool.query(`UPDATE versions SET status = 'history' WHERE province_id = $1 AND status = 'applied'`, [provId]);

        // Đặt version này thành applied
        await pool.query(`UPDATE versions SET status = 'applied' WHERE id = $1`, [id]);

        await pool.query('COMMIT');
        res.json({ success: true, message: "Đã chốt phiên bản thành công!" });
    } catch (err) {
        await pool.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- 6. XÓA VERSION ---
router.delete('/versions/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('BEGIN');

        // Kiểm tra version có tồn tại
        const vRes = await pool.query('SELECT * FROM versions WHERE id = $1', [id]);
        if (vRes.rows.length === 0) {
            await pool.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Version không tồn tại.' });
        }

        // Xóa basic_units thuộc version
        await pool.query('DELETE FROM basic_units WHERE version_id = $1', [id]);

        // Xóa version
        await pool.query('DELETE FROM versions WHERE id = $1', [id]);

        await pool.query('COMMIT');
        res.json({ success: true, message: 'Đã xóa phiên bản thành công!' });
    } catch (err) {
        await pool.query('ROLLBACK');
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
