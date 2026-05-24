// setup_db_optimization.js
// Chạy: node setup_db_optimization.js
// Mục đích: Thêm các bảng/cột cần thiết cho hạ tầng tối ưu hóa GRASP

const pool = require('./db');

async function runSetup() {
    try {
        console.log("=== SETUP HẠ TẦNG TỐI ƯU HÓA ===\n");

        // ----- LỚP 1: DỮ LIỆU KHÔNG GIAN -----
        console.log("[1/5] Thêm cột centroid vào basic_units...");
        await pool.query(`
            ALTER TABLE basic_units 
            ADD COLUMN IF NOT EXISTS centroid geometry(Point, 4326);
        `);
        await pool.query(`
            UPDATE basic_units 
            SET centroid = ST_Centroid(geom) 
            WHERE centroid IS NULL AND geom IS NOT NULL;
        `);
        console.log("      ✅ OK");

        console.log("[2/5] Tạo bảng unit_adjacencies (Ma trận lân cận)...");
        await pool.query(`
            CREATE TABLE IF NOT EXISTS unit_adjacencies (
                unit_a_id INTEGER REFERENCES basic_units(id) ON DELETE CASCADE,
                unit_b_id INTEGER REFERENCES basic_units(id) ON DELETE CASCADE,
                version_id INTEGER,
                PRIMARY KEY (unit_a_id, unit_b_id)
            );
        `);
        console.log("      ✅ OK");

        // ----- LỚP 2: BACKEND ĐIỀU PHỐI -----
        console.log("[3/5] Thêm cột is_optimizing vào bảng versions (Khóa dữ liệu)...");
        await pool.query(`
            ALTER TABLE versions 
            ADD COLUMN IF NOT EXISTS is_optimizing BOOLEAN DEFAULT FALSE;
        `);
        console.log("      ✅ OK");

        console.log("[4/5] Tạo bảng optimization_jobs (Quản lý trạng thái Job)...");
        await pool.query(`
            CREATE TABLE IF NOT EXISTS optimization_jobs (
                id          SERIAL PRIMARY KEY,
                version_id  INTEGER NOT NULL,
                status      VARCHAR(20) NOT NULL DEFAULT 'pending',
                -- pending | running | done | error | cancelled
                progress    INTEGER DEFAULT 0,       -- vòng lặp hiện tại
                total       INTEGER DEFAULT 0,       -- tổng số vòng lặp (maxIterations)
                message     TEXT,                    -- thông báo lỗi hoặc kết quả
                started_at  TIMESTAMPTZ,
                finished_at TIMESTAMPTZ,
                created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("      ✅ OK");

        console.log("[5/5] Tạo index để tra cứu job nhanh theo version...");
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_optjob_version 
            ON optimization_jobs (version_id, status);
        `);
        console.log("      ✅ OK");

        console.log("\n=== SETUP HOÀN TẤT ===");
    } catch (err) {
        console.error("❌ LỖI:", err.message);
    } finally {
        pool.end();
    }
}

runSetup();
