const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'DA',
    password: '123456',
    port: 5433,
});

async function main() {
    try {
        console.log("=== KIỂM TRA BẢNG TRONG DATABASE ===");
        
        // 1. Liệt kê tất cả các bảng trong public schema
        const tablesRes = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
        `);
        console.log("Danh sách các bảng:");
        tablesRes.rows.forEach(r => {
            console.log(`- ${r.table_name}`);
        });

        // 2. Nếu bảng basic_units tồn tại, lấy thông tin record
        const existsRes = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_name = 'basic_units'
            );
        `);
        if (existsRes.rows[0].exists) {
            const countRes = await pool.query("SELECT COUNT(*) FROM basic_units;");
            console.log(`\nBảng basic_units tồn tại và có ${countRes.rows[0].count} bản ghi.`);
            if (countRes.rows[0].count > 0) {
                const sampleRes = await pool.query("SELECT * FROM basic_units LIMIT 3;");
                console.log("Ví dụ dữ liệu 3 hàng đầu:");
                console.log(sampleRes.rows);
            }
        } else {
            console.log("\nBảng basic_units không tồn tại!");
        }

    } catch (e) {
        console.error("LỖI:", e.message);
    } finally {
        await pool.end();
    }
}

main();
