const express = require("express");
const router = express.Router();
const pool = require("../db");

// --- 1. LẤY DANH SÁCH Ô (GET) ---
router.get("/", async (req, res) => {
  const { versionId, driverId } = req.query;
  try {
    let targetVersionId = versionId;

    // Nếu không truyền versionId nhưng truyền driverId (ngữ cảnh tài xế)
    if (!targetVersionId && driverId) {
      // Vì bảng districts chưa tồn tại hoặc bị xóa trong DB hiện tại,
      // hệ thống tự động tìm phiên bản 'applied' (đang được admin chọn) của Tỉnh mà tài xế thuộc về.
      const userRes = await pool.query("SELECT province_id FROM users WHERE id = $1", [driverId]);
      if (userRes.rows.length > 0 && userRes.rows[0].province_id) {
        const provinceId = userRes.rows[0].province_id;
        const versionRes = await pool.query(
          "SELECT id FROM versions WHERE province_id = $1 AND status = 'applied' LIMIT 1",
          [provinceId]
        );
        if (versionRes.rows.length > 0) {
          targetVersionId = versionRes.rows[0].id;
        }
      }

      // Dự phòng: Nếu vẫn không tìm thấy liên kết nào, tìm phiên bản 'applied' bất kỳ đang hoạt động
      if (!targetVersionId) {
        const anyAppliedRes = await pool.query(
          "SELECT id FROM versions WHERE status = 'applied' ORDER BY created_at DESC LIMIT 1"
        );
        if (anyAppliedRes.rows.length > 0) {
          targetVersionId = anyAppliedRes.rows[0].id;
        }
      }
    }

    if (!targetVersionId) {
      return res.json({ type: "FeatureCollection", features: [] });
    }

    // Truy vấn trực tiếp từ basic_units không tham chiếu đến bảng districts không tồn tại
    let query = `
            SELECT bu.*, ST_AsGeoJSON(bu.geom)::json as geometry
            FROM basic_units bu
            WHERE bu.version_id = $1
        `;
    let params = [targetVersionId];

    const result = await pool.query(query, params);

    const features = result.rows.map((row) => ({
      type: "Feature",
      id: row.id,
      properties: {
        name: row.name,
        customers: row.customer_count,
        orders: row.order_count,
        area: row.area_km2,
        color: row.color || "#3388ff",
        versionId: row.version_id || null,
        districtId: null,
        districtName: null,
        districtColor: null,
        driverId: null
      },
      geometry: row.geometry,
    }));
    res.json({ type: "FeatureCollection", features });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 2. KIỂM TRA CHỒNG LẤN NHANH (POST) ---
router.post("/check-overlap", async (req, res) => {
  const { geometry, version_id } = req.body;
  try {
    // Logic mới: Loại bỏ ST_GeometryType check để bắt được mọi trường hợp chồng lấn area
    const overlapCheck = await pool.query(
      `WITH new_geom AS (SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS geom)
             SELECT name FROM basic_units, new_geom
             WHERE ST_Intersects(basic_units.geom, new_geom.geom)
             AND (basic_units.version_id IS NOT DISTINCT FROM $2)
             -- Bỏ lọc ST_GeometryType để tránh sót các GeometryCollection phức tạp
             AND ST_Area(ST_Intersection(basic_units.geom, new_geom.geom)::geography)
                 > 0.01 * LEAST(ST_Area(basic_units.geom::geography), ST_Area(new_geom.geom::geography))
             LIMIT 1`,
      [JSON.stringify(geometry), version_id],
    );

    if (overlapCheck.rows.length > 0) {
      res.json({ overlap: true, name: overlapCheck.rows[0].name });
    } else {
      res.json({ overlap: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 3. THÊM Ô MỚI (POST) ---
router.post("/", async (req, res) => {
  const { name, geometry, customer_count, order_count, color, version_id } =
    req.body;
  try {
    // KIỂM TRA CHỒNG LẤN
    const overlapCheck = await pool.query(
      `WITH new_geom AS (SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS geom)
             SELECT name FROM basic_units, new_geom
             WHERE ST_Intersects(basic_units.geom, new_geom.geom)
             AND (basic_units.version_id IS NOT DISTINCT FROM $2)
             AND ST_Area(ST_Intersection(basic_units.geom, new_geom.geom)::geography)
                 > 0.01 * LEAST(ST_Area(basic_units.geom::geography), ST_Area(new_geom.geom::geography))
             LIMIT 1`,
      [JSON.stringify(geometry), version_id],
    );

    if (overlapCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Lỗi: Vùng này chèn lên ô "${overlapCheck.rows[0].name}"!`,
      });
    }

    const query = `
            INSERT INTO basic_units (name, geom, centroid, customer_count, order_count, color, area_km2, version_id)
            VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)), $3, $4, $5,
                    ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)::geography) / 1000000, $6) 
            RETURNING id;
        `;
    const result = await pool.query(query, [
      name,
      JSON.stringify(geometry),
      customer_count,
      order_count,
      color || "#3388ff",
      version_id,
    ]);
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- TÍNH NĂNG MỚI: CẮT ĐA GIÁC BẰNG ĐƯỜNG KẺ (POST) ---
router.post("/split", async (req, res) => {
  const { geometry, version_id } = req.body;
  try {
    // Tìm các đa giác bị cắt bởi đường vẽ
    const targetRes = await pool.query(
      `
            WITH line AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as geom)
            SELECT id, name, color, customer_count, order_count
            FROM basic_units, line
            WHERE version_id = $2 
              AND ST_Intersects(basic_units.geom, line.geom)
              AND ST_GeometryType(ST_Intersection(basic_units.geom, line.geom)) IN ('ST_LineString', 'ST_MultiLineString')
        `,
      [JSON.stringify(geometry), version_id],
    );

    let splitCount = 0;
    for (const target of targetRes.rows) {
      const cutRows = await pool.query(
        `
                WITH line AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as lgeom),
                     poly AS (SELECT geom, area_km2, customer_count, order_count FROM basic_units WHERE id = $2),
                     cut AS (
                         SELECT (ST_Dump(ST_Split(poly.geom, line.lgeom))).geom as pgeom 
                         FROM line, poly
                     ),
                     clean AS (
                         -- Chỉ lấy phần Polygon, loại bỏ LineString/Point artifacts
                         SELECT ST_CollectionExtract(ST_MakeValid(pgeom), 3) as pgeom
                         FROM cut
                     )
                SELECT ST_AsGeoJSON(pgeom) as geometry,
                       (ST_Area(pgeom::geography) / 1000000) as new_area,
                       poly.area_km2 as old_area,
                       poly.customer_count,
                       poly.order_count
                FROM clean, poly
                WHERE ST_GeometryType(pgeom) IN ('ST_Polygon', 'ST_MultiPolygon')
                  AND ST_Area(pgeom) > 0
            `,
        [JSON.stringify(geometry), target.id],
      );

      if (cutRows.rows.length >= 2) {
        // Xóa ô cũ
        await pool.query("DELETE FROM basic_units WHERE id = $1", [target.id]);
        // Chia thành các tiểu ô
        for (let i = 0; i < cutRows.rows.length; i++) {
          const row = cutRows.rows[i];
          const suffix = String.fromCharCode(65 + i); // Tự gắn hậu tố A, B...
          const ratio =
            row.old_area > 0
              ? row.new_area / row.old_area
              : 1.0 / cutRows.rows.length;

          // Chia tài nguyên (khách, đơn) theo tỷ lệ diện tích
          const cust = Math.round(row.customer_count * ratio);
          const ord = Math.round(row.order_count * ratio);

          await pool.query(
            `INSERT INTO basic_units (name, geom, centroid, customer_count, order_count, color, area_km2, version_id)
                         VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)), $3, $4, $5, $6, $7)`,
            [
              `${target.name} ${suffix}`,
              row.geometry,
              cust,
              ord,
              target.color,
              row.new_area,
              version_id,
            ],
          );
        }
        splitCount++;
      }
    }

    if (splitCount > 0) {
      res.json({
        success: true,
        message: `Đã cắt thành công ${splitCount} hình.`,
      });
    } else {
      res.status(400).json({
        success: false,
        message:
          "Cắt thất bại! Hãy vẽ đường vắt qua hoàn toàn mép ngoài của đa giác cần cắt.",
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- BULK CẬP NHẬT SỐ LƯỢNG KHÁCH/ĐƠN (VÀ TÊN) CHO NHIỀU Ô ---
router.post("/bulk-attributes", async (req, res) => {
  const { updates } = req.body;
  if (!updates || !Array.isArray(updates) || updates.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "Dữ liệu không hợp lệ" });
  }
  try {
    await pool.query("BEGIN");
    for (const u of updates) {
      if (u.name !== undefined) {
        // Cập nhật cả tên nếu được truyền vào
        await pool.query(
          `UPDATE basic_units SET name = $1, customer_count = $2, order_count = $3 WHERE id = $4`,
          [u.name, u.customer_count ?? 0, u.order_count ?? 0, u.id],
        );
      } else {
        await pool.query(
          `UPDATE basic_units SET customer_count = $1, order_count = $2 WHERE id = $3`,
          [u.customer_count ?? 0, u.order_count ?? 0, u.id],
        );
      }
    }
    await pool.query("COMMIT");
    res.json({
      success: true,
      message: `Đã cập nhật ${updates.length} ô thành công.`,
    });
  } catch (err) {
    await pool.query("ROLLBACK");
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- TÍNH NĂNG MỚI: HỢP NHẤT ĐA GIÁC (POST) ---
router.post("/merge", async (req, res) => {
  const { ids, name, version_id } = req.body;
  if (!ids || ids.length < 2)
    return res
      .status(400)
      .json({ success: false, message: "Cần ít nhất 2 đa giác để hợp nhất" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Tắt trigger kiểm tra overlap CHỈ trong transaction này.
    // Lý do: các đa giác đã được validate lúc vẽ → ST_Union của chúng luôn hợp lệ.
    // SET LOCAL tự động reset về normal sau COMMIT/ROLLBACK.
    await client.query("SET LOCAL session_replication_role = replica");

    // Tính toán geometry hợp nhất TRƯỚC khi xóa
    // ST_SnapToGrid: snap tọa độ về cùng lưới → 2 biên chung khớp hoàn toàn → ST_Union hòa tan nội biên
    // ST_Buffer(,0): xóa nốt các internal edge còn sót
    const mergeQuery = `
            WITH source_units AS (
                SELECT ST_SnapToGrid(geom, 0.0000001) as geom,
                       customer_count, order_count, color, district_id 
                FROM basic_units WHERE id = ANY($1::int[])
            ),
            unioned AS (
                SELECT ST_CollectionExtract(ST_MakeValid(ST_Buffer(ST_Union(geom), 0)), 3) as geom,
                       SUM(customer_count) as total_customers,
                       SUM(order_count) as total_orders,
                       MAX(color) as single_color
                FROM source_units
            )
            SELECT 
                ST_AsGeoJSON(geom) as merged_geom,
                total_customers,
                total_orders,
                single_color,
                ST_Area(geom::geography) / 1000000 as merged_area_km2
            FROM unioned
        `;

    const mergeResult = await client.query(mergeQuery, [ids]);
    if (mergeResult.rows.length === 0 || !mergeResult.rows[0].merged_geom) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Không thể nội suy hình mới dựa trên lựa chọn này.",
      });
    }

    const row = mergeResult.rows[0];

    // Xóa các mảnh nguồn
    await client.query(`DELETE FROM basic_units WHERE id = ANY($1::int[])`, [
      ids,
    ]);

    // Insert hình gộp (trigger đã tắt tạm trong transaction này)
    const insertQuery = `
            INSERT INTO basic_units (name, geom, centroid, customer_count, order_count, color, area_km2, version_id)
            VALUES ($1, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)), ST_Centroid(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))), $3, $4, $5, $6, $7)
            RETURNING id;
        `;
    await client.query(insertQuery, [
      name,
      row.merged_geom,
      row.total_customers || 0,
      row.total_orders || 0,
      row.single_color || "#3388ff",
      row.merged_area_km2 || 0,
      version_id,
    ]);

    await client.query("COMMIT");
    res.json({ success: true, message: "Hợp nhất thành công" });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// --- TÍNH NĂNG MỚI: CẬP NHẬT HÀNG LOẠT (Bulk Update) ---
router.post("/bulk-update", async (req, res) => {
  const { updates, version_id } = req.body;
  if (!updates || !Array.isArray(updates))
    return res
      .status(400)
      .json({ success: false, message: "Dữ liệu không hợp lệ" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Tạm tắt trigger để cập nhật các ô chạm nhau
    await client.query("SET LOCAL session_replication_role = replica");

    for (const update of updates) {
      await client.query(
        `UPDATE basic_units 
                 SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                     centroid = ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)),
                     area_km2 = ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography) / 1000000
                 WHERE id = $2`,
        [JSON.stringify(update.geometry), update.id],
      );
    }

    // Sau khi cập nhật xong tất cả, kiểm tra lại ranh giới cuối cùng một lượt
    for (const update of updates) {
      const overlapRes = await client.query(
        `
                WITH new_geom AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as geom)
                SELECT name FROM basic_units, new_geom
                WHERE id != $2 
                  AND (version_id IS NOT DISTINCT FROM $3)
                  AND ST_Intersects(basic_units.geom, new_geom.geom)
                  AND ST_Area(ST_Intersection(basic_units.geom, new_geom.geom)::geography)
                      > 0.01 * LEAST(ST_Area(basic_units.geom::geography), ST_Area(new_geom.geom::geography))
                LIMIT 1
            `,
        [JSON.stringify(update.geometry), update.id, version_id],
      );

      if (overlapRes.rows.length > 0) {
        throw new Error(
          `Cập nhật hàng loạt thất bại: Ô bị chồng lấn lên "${overlapRes.rows[0].name}"!`,
        );
      }
    }

    await client.query("COMMIT");
    res.json({ success: true, message: "Đã cập nhật ranh giới thành công." });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { geometry, name, customer_count, order_count, color } = req.body;

  try {
    // BƯỚC 1: KIỂM TRA CHỒNG LẤN
    if (geometry) {
      const overlapCheck = await pool.query(
        `WITH new_geom AS (SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS geom),
                      cur_unit AS (SELECT version_id FROM basic_units WHERE id = $2)
                 SELECT name FROM basic_units, new_geom, cur_unit
                 WHERE ST_Intersects(basic_units.geom, new_geom.geom)
                 AND (basic_units.version_id IS NOT DISTINCT FROM cur_unit.version_id)
                 AND ST_Area(ST_Intersection(basic_units.geom, new_geom.geom)::geography)
                     > 0.02 * LEAST(ST_Area(basic_units.geom::geography), ST_Area(new_geom.geom::geography))
                 AND basic_units.id != $2 LIMIT 1`,
        [JSON.stringify(geometry), id],
      );

      if (overlapCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Lỗi ranh giới: Ô này lấn vào ô "${overlapCheck.rows[0].name}"!`,
        });
      }
    }

    // BƯỚC 2: THỰC THI CẬP NHẬT
    if (geometry && !name) {
      // Trường hợp chỉ kéo thả ranh giới trên bản đồ
      await pool.query(
        `UPDATE basic_units 
                 SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                     centroid = ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)),
                     area_km2 = ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography) / 1000000
                 WHERE id = $2`,
        [JSON.stringify(geometry), id],
      );
    } else {
      // Trường hợp sửa thông tin trong Sidebar (Tên, khách, đơn, màu)
      await pool.query(
        `UPDATE basic_units 
                 SET name = $1, customer_count = $2, order_count = $3, color = $4,
                     geom = ST_SetSRID(ST_GeomFromGeoJSON($5), 4326),
                     centroid = ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)),
                     area_km2 = ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)::geography) / 1000000
                 WHERE id = $6`,
        [
          name,
          customer_count,
          order_count,
          color,
          JSON.stringify(geometry),
          id,
        ],
      );
    }

    res.json({ success: true, message: "Lưu thành công!" });
  } catch (err) {
    console.error("LỖI SQL:", err.message);
    res.status(500).json({ success: false, message: "Lỗi hệ thống khi lưu." });
  }
});

// --- 4. XÓA Ô (DELETE) ---
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM basic_units WHERE id = $1", [id]);
    res.json({ success: true, message: "Đã xóa ô thành công!" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- 5. CẬP NHẬT MÀU - CHỈ ĐỔI MÀU (PUT) ---
router.put("/:id/color", async (req, res) => {
  const { id } = req.params;
  const { color } = req.body;
  try {
    await pool.query("UPDATE basic_units SET color = $1 WHERE id = $2", [
      color,
      id,
    ]);
    res.json({ success: true, message: "Cập nhật màu thành công" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- 6. CẬP NHẬT THUỘC TÍNH (Sidebar) ---
router.put("/:id/attributes", async (req, res) => {
  const { id } = req.params;
  const { name, customer_count, order_count, color } = req.body;
  try {
    await pool.query(
      `UPDATE basic_units 
             SET name = $1, customer_count = $2, order_count = $3, color = $4
             WHERE id = $5`,
      [name, customer_count, order_count, color, id],
    );
    res.json({ success: true, message: "Lưu thuộc tính thành công" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Đảm bảo các cột cần thiết tồn tại
pool
  .query("ALTER TABLE basic_units ADD COLUMN IF NOT EXISTS color VARCHAR(20)")
  .catch(() => {});

// --- 7. TẠO BẢNG LÂN CẬN (PRE-CALCULATE ADJACENCY MATRIX CHO GRASP) ---
router.post("/build-adjacencies", async (req, res) => {
  const { version_id } = req.body;
  if (!version_id)
    return res
      .status(400)
      .json({ success: false, message: "Thiếu version_id" });

  try {
    await pool.query("BEGIN");

    // Xóa dữ liệu cũ của version này
    await pool.query("DELETE FROM unit_adjacencies WHERE version_id = $1", [
      version_id,
    ]);

    // Tìm tất cả các cặp ô đa giác tiếp giáp nhau (có chung biên hoặc chồng lấn nhẹ)
    // và lưu vào bảng cache unit_adjacencies
    const insertQuery = `
            INSERT INTO unit_adjacencies (unit_a_id, unit_b_id, version_id)
            SELECT a.id, b.id, $1
            FROM basic_units a
            JOIN basic_units b ON a.id < b.id AND a.version_id = b.version_id
            WHERE a.version_id = $1 
              -- Bước 1: Tìm các ô cách nhau dưới 50cm
              AND ST_DWithin(a.geom::geography, b.geom::geography, 0.5)
              -- Bước 2: Buffer mỗi ô ra 10cm rồi đo diện tích giao nhau:
              -- Chạm đỉnh (chéo góc): diện tích giao ~0.01m2 → bị loại
              -- Chung cạnh (cạnh 25cm+): diện tích giao ≥ 0.1m2 → được giữ
              AND ST_Area(
                  ST_Intersection(ST_Buffer(a.geom::geography, 0.1)::geometry, ST_Buffer(b.geom::geography, 0.1)::geometry)::geography
              ) > 0.1
        `;

    await pool.query(insertQuery, [version_id]);

    await pool.query("COMMIT");
    res.json({
      success: true,
      message:
        "Đã xây dựng xong bảng lân cận (Adjacency Matrix) cho tối ưu hóa.",
    });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("LỖI SQL:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Lỗi hệ thống khi tạo đồ thị." });
  }
});

// --- TÍNH NĂNG MỚI: SAO CHÉP HÀNG LOẠT ĐA GIÁC (POST) ---
router.get("/bulk-clone", (req, res) => {
  res.json({ success: false, message: "Endpoint này chỉ hỗ trợ phương thức POST để nhận dữ liệu sao chép và dán đa giác." });
});

router.post("/bulk-clone", async (req, res) => {
  const { version_id, polygons } = req.body;
  if (!version_id) {
    return res.status(400).json({ success: false, message: "Thiếu version_id" });
  }
  if (!polygons || !Array.isArray(polygons) || polygons.length === 0) {
    return res.status(400).json({ success: false, message: "Thiếu dữ liệu đa giác sao chép" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    
    const insertedIds = [];
    for (const poly of polygons) {
      const geomStr = JSON.stringify(poly.geometry);
      // Tính toán area_km2 ngầm trong DB bằng ST_Area
      const insertQuery = `
        INSERT INTO basic_units (name, geom, centroid, customer_count, order_count, color, area_km2, version_id)
        VALUES (
          $1, 
          ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), 
          ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)), 
          $3, 
          $4, 
          $5, 
          COALESCE(ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)::geography) / 1000000.0, 0), 
          $6
        ) 
        RETURNING id;
      `;
      const name = poly.name ? (poly.name.includes(" - Copy") ? poly.name : `${poly.name} - Copy`) : "Ô sao chép";
      
      const insertRes = await client.query(insertQuery, [
        name,
        geomStr,
        poly.customer_count || 0,
        poly.order_count || 0,
        poly.color || "#3388ff",
        version_id
      ]);
      insertedIds.push(insertRes.rows[0].id);
    }
    
    await client.query("COMMIT");
    res.json({ success: true, insertedIds, message: `Đã dán thành công ${polygons.length} ô đa giác.` });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
