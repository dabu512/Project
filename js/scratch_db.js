const pool = require('../db');
(async () => {
    try {
        try {   
            await pool.query('ALTER TABLE districts RENAME COLUMN sales_id TO driver_id;');
            console.log('Renamed sales_id to driver_id');
        } catch(e) { console.log('sales_id not found', e.message); }

        await pool.query("UPDATE users SET role = 'driver' WHERE role = 'sales';");
        
        try {
            await pool.query('ALTER TABLE users DROP CONSTRAINT users_role_check;');
        } catch(e) {}
        
        await pool.query("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'driver'));");
        console.log('Updated user constraints to use driver');

        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS region_id INTEGER REFERENCES regions(id) ON DELETE SET NULL;');
        console.log('Added region_id to users');

    } catch (e) {
        console.error('DB Migration error:', e);
    } finally {
        pool.end();
    }
})();
