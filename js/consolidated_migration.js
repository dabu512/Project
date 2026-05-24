

const pool = require('../db.js');

async function runMigration() {
    console.log('=== KHỞI CHẠY MIGRATION GỘP ===');
    
    try {
        await pool.query('BEGIN');

        console.log('Giai đoạn 1: Đồng bộ hóa vai trò và cập nhật bảng districts...');
        try {   
            await pool.query('ALTER TABLE districts RENAME COLUMN driver_id TO sales_id;');
            console.log('  - Đã đổi tên driver_id thành sales_id trong bảng districts');
        } catch(e) { 
            console.log('  - districts hoặc driver_id không tìm thấy (đã được bỏ hoặc cập nhật trước đó):', e.message); 
        }

        await pool.query("UPDATE users SET role = 'sales' WHERE role = 'driver';");
        console.log("  - Đã cập nhật vai trò người dùng 'driver' thành 'sales'");
        
        try {
            await pool.query('ALTER TABLE users DROP CONSTRAINT users_role_check;');
        } catch(e) {
            console.log('  - Không tìm thấy constraint users_role_check cũ');
        }
        
        await pool.query("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'sales', 'driver'));");
        console.log("  - Đã cập nhật lại ràng buộc vai trò của users để hỗ trợ admin, sales, driver");

        try {
            await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS region_id INTEGER REFERENCES regions(id) ON DELETE SET NULL;');
            console.log('  - Đã thêm cột region_id vào bảng users');
        } catch(e) {
            console.log('  - Lỗi khi thêm region_id:', e.message);
        }

        console.log('Giai đoạn 2: Thay thế region_id bằng province_id cho users...');
        await pool.query('ALTER TABLE users DROP COLUMN IF EXISTS region_id;');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS province_id INTEGER REFERENCES provinces(id) ON DELETE SET NULL;');
        console.log('  - Đã thêm cột province_id vào bảng users thay thế cho region_id');

        console.log('Giai đoạn 3: Bổ sung dữ liệu provinces mẫu...');
        const res = await pool.query("INSERT INTO provinces (name, region_id) VALUES ('Hải Phòng', 1) ON CONFLICT DO NOTHING RETURNING id;");
        if (res.rows.length > 0) {
            console.log('  - Đã chèn thêm tỉnh Hải Phòng với ID:', res.rows[0].id);
        } else {
            console.log('  - Tỉnh Hải Phòng đã có sẵn trong bảng provinces');
        }

        await pool.query('COMMIT');
        console.log('\n=== MIGRATION GỘP HOÀN TẤT THÀNH CÔNG ===');
    } catch (e) {
        await pool.query('ROLLBACK');
        console.error('LỖI KHI CHẠY MIGRATION:', e.message);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    runMigration();
}

module.exports = runMigration;
