const pool = require('./db');
async function testFull() {
    try {
        const unit_ids = [2, 1]; // Assume they selected 2 and 1

        const paramsList = unit_ids.map((_, i) => `$${i + 1}`).join(',');
        const affectedRes = await pool.query(`SELECT DISTINCT district_id, name FROM basic_units LEFT JOIN districts ON district_id = districts.id WHERE basic_units.id IN (${paramsList}) AND district_id IS NOT NULL`, unit_ids);
        const affectedDistricts = affectedRes.rows;

        const cascadingWarnings = [];

        for (let dist of affectedDistricts) {
            const oldDistrictId = dist.district_id;

            console.log("Checking old district:", oldDistrictId);
            const remainRes = await pool.query(`SELECT id, order_count FROM basic_units WHERE district_id = $1 AND id != ALL($2::int[])`, [oldDistrictId, unit_ids]);
            console.log("Remain:", remainRes.rows);
            // if an error occurs here, it will be caught
        }
    } catch (e) {
        console.error("ERROR 1:", e);
    } finally {
        process.exit();
    }
}
testFull();
