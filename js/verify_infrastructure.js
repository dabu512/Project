const pool = require('./db');

async function verify() {
    try {
        console.log("--- BÁO CÁO KIỂM TRA HẠ TẦNG ---");

        // 1. Kiểm tra cột centroid
        const colRes = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'basic_units' AND column_name = 'centroid';
        `);
        if (colRes.rows.length > 0) {
            console.log("✅ Cột 'centroid' đã tồn tại trong bảng 'basic_units'.");
        } else {
            console.log("❌ Cột 'centroid' CHƯA tồn tại.");
        }

        // 2. Kiểm tra dữ liệu centroid
        const dataRes = await pool.query(`
            SELECT count(*) as count FROM basic_units WHERE centroid IS NOT NULL;
        `);
        console.log(`📊 Đang có ${dataRes.rows[0].count} ô đã được tính tọa độ tâm.`);

        // 3. Kiểm tra bảng unit_adjacencies
        const tableRes = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'unit_adjacencies'
            );
        `);
        if (tableRes.rows[0].exists) {
            console.log("✅ Bảng 'unit_adjacencies' (Ma trận lân cận) đã được tạo.");
        } else {
            console.log("❌ Bảng 'unit_adjacencies' CHƯA tồn tại.");
        }

        console.log("--------------------------------");
    } catch (err) {
        console.error("Lỗi khi kiểm tra:", err.message);
    } finally {
        pool.end();
    }
}

verify();
