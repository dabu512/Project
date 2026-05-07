const pool = require('d:/gis-project/Project_anti/db.js');
(async () => {
    try {
        try {   
            await pool.query('ALTER TABLE districts RENAME COLUMN driver_id TO sales_id;');
            console.log('Renamed driver_id to sales_id');
        } catch(e) { console.log('driver_id not found', e.message); }

        await pool.query("UPDATE users SET role = 'sales' WHERE role = 'driver';");
        
        try {
            await pool.query('ALTER TABLE users DROP CONSTRAINT users_role_check;');
        } catch(e) {}
        
        await pool.query("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'sales'));");
        console.log('Updated user constraints to use sales');

        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS region_id INTEGER REFERENCES regions(id) ON DELETE SET NULL;');
        console.log('Added region_id to users');

    } catch (e) {
        console.error('DB Migration error:', e);
    } finally {
        pool.end();
    }
})();
