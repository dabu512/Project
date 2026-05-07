// d:\gis-project\Project_anti\optimization\list_adjacencies.js
// Script liệt kê tất cả các ô đa giác và các ô kề (chung CẠNH) ra terminal.
// Đọc từ bảng unit_adjacencies (dữ liệu GRASP worker sử dụng).
// Thêm flag --rebuild để tính lại adjacency trực tiếp từ PostGIS trước khi in.
//
// Cách dùng:
//   node optimization/list_adjacencies.js 5             -> đọc từ bảng cache
//   node optimization/list_adjacencies.js 5 --rebuild   -> tính lại rồi in

const pool = require("../db");

async function main() {
  let client;
  try {
    client = await pool.connect();

    const versionArg = process.argv[2];
    const targetVersionId = versionArg ? parseInt(versionArg) : null;
    const shouldRebuild = process.argv.includes("--rebuild");

    if (versionArg && isNaN(targetVersionId)) {
      console.log("Lỗi: Version ID nhập vào phải là một số nguyên.");
      return;
    }

    if (!targetVersionId) {
      console.log(
        "Cách dùng: node optimization/list_adjacencies.js <version_id> [--rebuild]",
      );
      return;
    }

    console.log(`Đang lấy dữ liệu cho Version ID: ${targetVersionId}...`);

    // Lấy tất cả units
    const unitsRes = await client.query(
      `SELECT id, name, version_id FROM basic_units WHERE version_id = $1 ORDER BY id`,
      [targetVersionId],
    );
    const units = unitsRes.rows;

    if (units.length === 0) {
      console.log("Không tìm thấy đơn vị cơ bản nào.");
      return;
    }

    const unitDetailsMap = new Map();
    units.forEach((u) =>
      unitDetailsMap.set(u.id, { name: u.name, version_id: u.version_id }),
    );

    // Nếu --rebuild: tính lại adjacency từ PostGIS
    if (shouldRebuild) {
      console.log("Đang rebuild bảng unit_adjacencies...");
      await client.query("DELETE FROM unit_adjacencies WHERE version_id = $1", [
        targetVersionId,
      ]);
      await client.query(
        `INSERT INTO unit_adjacencies (unit_a_id, unit_b_id, version_id)
         SELECT a.id, b.id, $1
         FROM basic_units a
         JOIN basic_units b ON a.id < b.id AND a.version_id = b.version_id
         WHERE a.version_id = $1 
           AND ST_DWithin(a.geom::geography, b.geom::geography, 0.5)
           AND ST_Area(
               ST_Intersection(ST_Buffer(a.geom::geography, 0.1)::geometry, ST_Buffer(b.geom::geography, 0.1)::geometry)::geography
           ) > 0.1`,
        [targetVersionId],
      );
      console.log("Rebuild xong!\n");
    }

    // Đọc từ bảng unit_adjacencies
    const adjRes = await client.query(
      `SELECT unit_a_id, unit_b_id FROM unit_adjacencies WHERE version_id = $1`,
      [targetVersionId],
    );

    // Build danh sách kề 2 chiều
    const adjList = new Map();
    units.forEach((u) => adjList.set(u.id, new Set()));
    adjRes.rows.forEach((row) => {
      if (adjList.has(row.unit_a_id) && adjList.has(row.unit_b_id)) {
        adjList.get(row.unit_a_id).add(row.unit_b_id);
        adjList.get(row.unit_b_id).add(row.unit_a_id);
      }
    });

    // Sắp xếp theo tên số
    units.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );

    console.log(`--- Danh sách kề cho Version ID: ${targetVersionId} ---`);

    let totalEdges = adjRes.rows.length;
    let isolatedCount = 0;

    units.forEach((unit) => {
      const neighbors = adjList.get(unit.id);
      const neighborNames = [];
      if (neighbors) {
        neighbors.forEach((neighborId) => {
          const detail = unitDetailsMap.get(neighborId);
          if (detail) neighborNames.push(detail.name);
        });
      }

      neighborNames.sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
      );

      if (neighborNames.length === 0) isolatedCount++;

      console.log(
        `[${unit.name}] [Các đa giác liền kề : ${neighborNames.join(", ") || "Không có"}]`,
      );
    });

    console.log(
      `\n  Tổng: ${units.length} ô, ${totalEdges} cạnh kề, ${isolatedCount} ô cô lập`,
    );
  } catch (error) {
    console.error("Lỗi:", error);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

main();
