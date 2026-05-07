const pool = require('d:/gis-project/Project_anti/db.js');
(async () => {
    try {
        const res = await pool.query("INSERT INTO provinces (name, region_id) VALUES ('Hải Phòng', 1) ON CONFLICT DO NOTHING RETURNING id;");
        if (res.rows.length > 0) {
            console.log("Inserted Hai Phong with id", res.rows[0].id);
        } else {
            console.log("Hai Phong probably exists");
        }
    } catch (e) {
        console.error('DB Migration error:', e);
    } finally {
        pool.end();
    }
})();
