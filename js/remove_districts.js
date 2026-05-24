const pool = require('./db');

async function removeDistricts() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log('--- Đang xóa các thành phần liên quan đến Districts ---');

        // 1. Xóa view báo cáo vùng
        console.log('1. Xóa VIEW v_district_report...');
        await client.query('DROP VIEW IF EXISTS v_district_report CASCADE');

        // 2. Xóa cột district_id trong basic_units
        console.log('2. Xóa cột district_id và FK trong basic_units...');
        // Kiểm tra xem cột có tồn tại không trước khi xóa để tránh lỗi
        const colCheck = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='basic_units' AND column_name='district_id'
        `);
        
        if (colCheck.rows.length > 0) {
            await client.query('ALTER TABLE basic_units DROP COLUMN district_id CASCADE');
        }

        // 3. Xóa bảng districts
        console.log('3. Xóa bảng districts...');
        await client.query('DROP TABLE IF EXISTS districts CASCADE');

        await client.query('COMMIT');
        console.log('✅ Đã xóa hoàn toàn bảng districts và các liên kết liên quan.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Lỗi khi thực hiện xóa:', err.message);
    } finally {
        client.release();
        process.exit();
    }
}

removeDistricts();
