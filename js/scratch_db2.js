const pool = require('d:/gis-project/Project_anti/db.js');
(async () => {
    try {
        await pool.query('ALTER TABLE users DROP COLUMN IF EXISTS region_id;');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS province_id INTEGER REFERENCES provinces(id) ON DELETE SET NULL;');
        console.log('Added province_id to users, replacing region_id');
    } catch (e) {
        console.error('DB Migration error:', e);
    } finally {
        pool.end();
    }
})();
