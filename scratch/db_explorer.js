const pool = require('../db');

async function exploreDatabase() {
    try {
        console.log('=== KẾT NỐI DATABASE THÀNH CÔNG ===\n');

        // 1. Lấy danh sách tất cả các bảng trong schema public
        const tablesRes = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name;
        `);
        const tables = tablesRes.rows.map(r => r.table_name);
        console.log(`Tìm thấy ${tables.length} bảng/views trong database:`, tables.join(', '));
        console.log('\n=======================================\n');

        // 2. Với mỗi bảng, truy vấn thông tin cột và loại dữ liệu
        for (const tableName of tables) {
            // Kiểm tra xem là Table hay View
            const typeRes = await pool.query(`
                SELECT table_type 
                FROM information_schema.tables 
                WHERE table_name = $1 AND table_schema = 'public';
            `, [tableName]);
            const tableType = typeRes.rows[0]?.table_type || 'UNKNOWN';

            console.log(`BẢNG: "${tableName}" (${tableType})`);

            // Lấy cột
            const columnsRes = await pool.query(`
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_name = $1 AND table_schema = 'public'
                ORDER BY ordinal_position;
            `, [tableName]);

            console.log('--- Các Cột (Columns): ---');
            columnsRes.rows.forEach(col => {
                const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
                const def = col.column_default ? ` DEFAULT ${col.column_default}` : '';
                console.log(`  - ${col.column_name} (${col.data_type}) | ${nullable}${def}`);
            });

            // Đếm số dòng
            try {
                const countRes = await pool.query(`SELECT COUNT(*) as count FROM public."${tableName}";`);
                const rowCount = countRes.rows[0].count;
                console.log(`--- Số dòng hiện tại (Row Count): ${rowCount} ---`);

                // Lấy nội dung cụ thể (tối đa 5 dòng đầu)
                if (rowCount > 0 && tableName !== 'spatial_ref_sys') {
                    console.log('--- Dữ liệu mẫu (Sample Rows - Top 5): ---');
                    const rowsRes = await pool.query(`SELECT * FROM public."${tableName}" LIMIT 5;`);
                    rowsRes.rows.forEach((row, i) => {
                        // Rút gọn các cột hình học để dễ đọc
                        const cleanedRow = { ...row };
                        for (let key in cleanedRow) {
                            if (cleanedRow[key] && typeof cleanedRow[key] === 'object' && cleanedRow[key].constructor && cleanedRow[key].constructor.name === 'Geometry') {
                                cleanedRow[key] = '[PostGIS Geometry]';
                            } else if (cleanedRow[key] instanceof Buffer) {
                                cleanedRow[key] = `[Buffer: ${cleanedRow[key].length} bytes]`;
                            } else if (typeof cleanedRow[key] === 'string' && cleanedRow[key].length > 100) {
                                cleanedRow[key] = cleanedRow[key].substring(0, 100) + '... (truncated)';
                            }
                        }
                        console.log(`  [Dòng ${i + 1}]:`, JSON.stringify(cleanedRow));
                    });
                }
            } catch (e) {
                console.log(`--- Không thể đếm dòng hoặc lấy mẫu (Ví dụ: View trống hoặc lỗi): ${e.message} ---`);
            }

            console.log('\n---------------------------------------\n');
        }

        // 3. Lấy thông tin các Trigger và Function tự định nghĩa
        console.log('=== CÁC TRIGGER HIỆN TẠI ===');
        const triggersRes = await pool.query(`
            SELECT 
                trigger_name, 
                event_object_table AS table_name, 
                action_timing, 
                event_manipulation AS event
            FROM information_schema.triggers
            ORDER BY event_object_table, trigger_name;
        `);
        if (triggersRes.rows.length > 0) {
            triggersRes.rows.forEach(tr => {
                console.log(`  - Trigger "${tr.trigger_name}" trên bảng "${tr.table_name}" | Chạy: ${tr.action_timing} ${tr.event}`);
            });
        } else {
            console.log('  Không tìm thấy Trigger nào.');
        }

    } catch (err) {
        console.error('LỖI KHI TRUY VẤN DATABASE:', err.message);
    } finally {
        await pool.end();
    }
}

exploreDatabase();
