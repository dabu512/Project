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
        console.log("=== DIAGNOSING DATABASE TRIGGER AND COLUMNS ===");

        // 1. Check if basic_units contains NULL centroid or area_km2
        const nullsRes = await pool.query(`
            SELECT id, name, version_id, centroid, area_km2 
            FROM basic_units 
            WHERE centroid IS NULL OR area_km2 IS NULL 
            LIMIT 5;
        `);
        console.log(`\n1. Number of basic_units with NULL centroid/area in sample: ${nullsRes.rows.length}`);
        nullsRes.rows.forEach(r => {
            console.log(`   - ID: ${r.id}, Name: "${r.name}", Version ID: ${r.version_id}, Centroid: ${r.centroid}, Area: ${r.area_km2}`);
        });

        // 2. Check total counts
        const countsRes = await pool.query(`
            SELECT 
                COUNT(*) as total_units,
                COUNT(centroid) as count_centroid,
                COUNT(area_km2) as count_area
            FROM basic_units;
        `);
        console.log(`\n2. Database Counts:`);
        console.log(`   - Total basic_units: ${countsRes.rows[0].total_units}`);
        console.log(`   - basic_units with centroid: ${countsRes.rows[0].count_centroid}`);
        console.log(`   - basic_units with area_km2: ${countsRes.rows[0].count_area}`);

        // 3. Check for existence of triggers on basic_units
        const triggerRes = await pool.query(`
            SELECT trigger_name, event_manipulation, action_statement 
            FROM information_schema.triggers 
            WHERE event_object_table = 'basic_units';
        `);
        console.log(`\n3. Triggers active on 'basic_units':`);
        triggerRes.rows.forEach(r => {
            console.log(`   - Name: ${r.trigger_name}, Event: ${r.event_manipulation}`);
        });

        // 4. Test trigger functionality by creating a temp unit and seeing if trigger fills columns
        console.log(`\n4. Testing trigger calculation by inserting a dummy unit...`);
        // Find a valid version_id first
        const verRes = await pool.query("SELECT id FROM versions LIMIT 1;");
        if (verRes.rows.length > 0) {
            const vid = verRes.rows[0].id;
            console.log(`   - Using version_id = ${vid} for test`);
            const testInsert = await pool.query(`
                INSERT INTO basic_units (name, geom, customer_count, order_count, color, version_id)
                VALUES ('TEST_DUMMY_UNIT', ST_SetSRID(ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[105.80,21.00],[105.81,21.00],[105.81,21.01],[105.80,21.01],[105.80,21.00]]]}'), 4326), 1, 1, '#ff0000', $1)
                RETURNING id, centroid, area_km2;
            `, [vid]);
            const row = testInsert.rows[0];
            console.log(`   - Insert successful! Row ID: ${row.id}`);
            console.log(`   - Trigger calculated Centroid: ${row.centroid ? 'YES (Valid)' : 'NO (NULL)'}`);
            console.log(`   - Trigger calculated Area: ${row.area_km2 ? row.area_km2 + ' km2' : 'NO (NULL)'}`);

            // Clean up test insert
            await pool.query("DELETE FROM basic_units WHERE id = $1", [row.id]);
            console.log(`   - Cleaned up dummy unit.`);
        } else {
            console.log("   - No map versions found to perform insertion test.");
        }

    } catch (e) {
        console.error("\n[DIAGNOSTIC ERROR]:", e.message);
    } finally {
        await pool.end();
    }
}

main();
