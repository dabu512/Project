const pool = require("./db");

async function migrate() {
  try {
    console.log("Starting Migration...");

    // 1. Create regions table
    await pool.query(`
            CREATE TABLE IF NOT EXISTS regions (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL
            );
        `);

    // 2. Create provinces table
    await pool.query(`
            CREATE TABLE IF NOT EXISTS provinces (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                region_id INTEGER REFERENCES regions(id) ON DELETE CASCADE
            );
        `);

    // 3. Create versions table
    await pool.query(`
            CREATE TABLE IF NOT EXISTS versions (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                province_id INTEGER REFERENCES provinces(id) ON DELETE CASCADE,
                status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'applied', 'history')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

    // 4. Modify users table
    // First delete any 'sales' users to avoid constraint violations
    await pool.query(`DELETE FROM users WHERE role = 'sales';`);

    try {
      await pool.query(`ALTER TABLE users DROP CONSTRAINT users_role_check;`);
    } catch (e) {
      console.log(
        "users_role_check might not exist or already dropped",
        e.message,
      );
    }

    await pool.query(
      `ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'driver'));`,
    );

    // 5. Upgrade basic_units table
    await pool.query(
      `ALTER TABLE basic_units ADD COLUMN IF NOT EXISTS version_id INTEGER REFERENCES versions(id) ON DELETE CASCADE;`,
    );
    await pool.query(`ALTER TABLE basic_units DROP COLUMN IF EXISTS sales_id;`);
    await pool.query(`DROP INDEX IF EXISTS idx_basic_units_version;`);
    await pool.query(
      `CREATE INDEX idx_basic_units_version ON basic_units(version_id);`,
    );

    // 6. Upgrade districts table
    await pool.query(`DROP VIEW IF EXISTS v_district_report CASCADE;`);
    await pool.query(
      `ALTER TABLE districts ADD COLUMN IF NOT EXISTS version_id INTEGER REFERENCES versions(id) ON DELETE CASCADE;`,
    );
    try {
      await pool.query(
        `ALTER TABLE districts DROP CONSTRAINT IF EXISTS fk_district_user;`,
      );
    } catch (e) {}
    await pool.query(`ALTER TABLE districts DROP COLUMN IF EXISTS user_id;`);
    await pool.query(`DROP INDEX IF EXISTS idx_districts_version;`);
    await pool.query(
      `CREATE INDEX idx_districts_version ON districts(version_id);`,
    );

    // 7. Seed initial data
    const regionRes = await pool.query(`SELECT id FROM regions LIMIT 1;`);
    let defaultRegionId;
    if (regionRes.rows.length === 0) {
      const res = await pool.query(
        `INSERT INTO regions (name) VALUES ('Đồng bằng sông Hồng') RETURNING id;`,
      );
      defaultRegionId = res.rows[0].id;
    } else {
      defaultRegionId = regionRes.rows[0].id;
    }

    const provinceRes = await pool.query(`SELECT id FROM provinces LIMIT 1;`);
    let defaultProvinceId;
    if (provinceRes.rows.length === 0) {
      const res = await pool.query(
        `INSERT INTO provinces (name, region_id) VALUES ('Hà Nội', $1) RETURNING id;`,
        [defaultRegionId],
      );
      defaultProvinceId = res.rows[0].id;
    } else {
      defaultProvinceId = provinceRes.rows[0].id;
    }

    const versionRes = await pool.query(`SELECT id FROM versions LIMIT 1;`);
    let defaultVersionId;
    if (versionRes.rows.length === 0) {
      const res = await pool.query(
        `INSERT INTO versions (name, province_id, status) VALUES ('Initial Status', $1, 'applied') RETURNING id;`,
        [defaultProvinceId],
      );
      defaultVersionId = res.rows[0].id;

      // Assign existing districts and units to this version
      await pool.query(
        `UPDATE districts SET version_id = $1 WHERE version_id IS NULL;`,
        [defaultVersionId],
      );
      await pool.query(
        `UPDATE basic_units SET version_id = $1 WHERE version_id IS NULL;`,
        [defaultVersionId],
      );
    }

    console.log("Migration completed successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    pool.end();
  }
}

migrate();
