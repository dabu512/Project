// routes/optimization.js
// API điều phối thuật toán tối ưu hóa GRASP
// Endpoints:
//   POST  /api/optimization/start        - Bắt đầu chạy thuật toán
//   GET   /api/optimization/status/:id   - Trạng thái 1 job cụ thể
//   GET   /api/optimization/jobs         - Danh sách các job của 1 version
//   POST  /api/optimization/cancel/:id   - Huỷ job đang chạy

const express = require("express");
const router = express.Router();
const pool = require("../db");
const { Worker } = require("worker_threads");
const path = require("path");

const WORKER_PATH = path.join(__dirname, "../optimization/grasp_worker.js");

// Lưu Worker đang chạy theo jobId (in-memory, đủ cho 1 server process)
const activeWorkers = new Map(); // jobId -> Worker instance

// ================================================================
//  HELPER: Cập nhật trạng thái job và version trong DB
// ================================================================
async function updateJobProgress(jobId, current, total, message) {
  await pool.query(
    `UPDATE optimization_jobs SET progress = $1, total = $2, message = $3 WHERE id = $4`,
    [current, total, message || "", jobId],
  );
}

async function markJobRunning(jobId) {
  await pool.query(
    `UPDATE optimization_jobs SET status = 'running', started_at = NOW() WHERE id = $1`,
    [jobId],
  );
}

async function markJobDone(jobId, versionId, resultMsg) {
  await pool.query(
    `UPDATE optimization_jobs SET status = 'done', finished_at = NOW(), message = $1 WHERE id = $2`,
    [resultMsg, jobId],
  );
  // Giữ khoá is_optimizing = TRUE để tránh chỉnh sửa bản đồ trong khi admin đang so sánh các phương án!
  // Sẽ được mở khoá khi gọi POST /api/optimization/apply hoặc POST /api/optimization/discard.
}

async function markJobError(jobId, versionId, errMsg) {
  await pool.query(
    `UPDATE optimization_jobs SET status = 'error', finished_at = NOW(), message = $1 WHERE id = $2`,
    [errMsg, jobId],
  );
  // Mở khoá version ngay cả khi lỗi
  await pool.query(`UPDATE versions SET is_optimizing = FALSE WHERE id = $1`, [
    versionId,
  ]);
}

// ================================================================
//  POST /api/optimization/unlock
//  Body: { version_id }
// ================================================================
router.post("/unlock", async (req, res) => {
  const { version_id } = req.body;
  if (!version_id) {
    return res.status(400).json({ success: false, message: "Thiếu version_id" });
  }
  try {
    const result = await pool.query(
      `UPDATE versions SET is_optimizing = FALSE WHERE id = $1 RETURNING id`,
      [version_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Không tìm thấy version" });
    }
    // Dọn dẹp bất kỳ state nào còn sót lại
    res.json({ success: true, message: "Đã mở khoá phiên bản thành công!" });
  } catch (err) {
    console.error("Lỗi khi mở khoá version:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
//  POST /api/optimization/start
//  Body: { version_id, config: { maxIterations, alphaRCL, ... } }
// ================================================================
router.post("/start", async (req, res) => {
  const { version_id, config = {} } = req.body;

  if (!version_id) {
    return res
      .status(400)
      .json({ success: false, message: "Thiếu version_id" });
  }

  try {
    // 1 & 2. Khóa version bằng truy vấn nguyên tử (Atomic Lock) để tránh Race Condition
    const lockRes = await pool.query(
      `UPDATE versions 
       SET is_optimizing = TRUE 
       WHERE id = $1 AND is_optimizing = FALSE 
       RETURNING id`,
      [version_id]
    );
    if (lockRes.rows.length === 0) {
      return res.status(409).json({
        success: false,
        message: "Version không tồn tại hoặc đang được tối ưu hóa. Vui lòng chờ!"
      });
    }

    // 2.5 Rebuild adjacencies for this version
    await pool.query("DELETE FROM unit_adjacencies WHERE version_id = $1", [
      version_id,
    ]);
    await pool.query(
      `
        INSERT INTO unit_adjacencies (unit_a_id, unit_b_id, version_id)
        SELECT a.id, b.id, $1
        FROM basic_units a
        JOIN basic_units b ON a.id < b.id AND a.version_id = b.version_id
        WHERE a.version_id = $1 
          -- Dùng hệ tọa độ phẳng mét ST_Transform(geom, 3857) tăng tốc cực nhanh
          AND ST_DWithin(ST_Transform(a.geom, 3857), ST_Transform(b.geom, 3857), 0.5)
          -- Buffer phẳng hệ mét siêu nhẹ:
          AND ST_Area(
              ST_Intersection(
                  ST_Buffer(ST_Transform(a.geom, 3857), 0.1), 
                  ST_Buffer(ST_Transform(b.geom, 3857), 0.1)
              )
          ) > 0.1
    `,
      [version_id],
    );

    // 3. Tạo bản ghi job
    const jobRes = await pool.query(
      `INSERT INTO optimization_jobs (version_id, status, total, message)
             VALUES ($1, 'pending', $2, 'Đang khởi tạo...')
             RETURNING id`,
      [version_id, config.maxIterations || 2020],
    );
    const jobId = jobRes.rows[0].id;

    // 4. Trả lời ngay lập tức (non-blocking) để client biết jobId
    res.json({
      success: true,
      jobId,
      message: `Job #${jobId} đã được tạo. Thuật toán đang khởi động...`,
    });

    // 5. Spawn Worker Thread (chạy ngầm, KHÔNG await)
    const worker = new Worker(WORKER_PATH, {
      workerData: { versionId: version_id, config, jobId },
    });
    activeWorkers.set(jobId, worker);

    await markJobRunning(jobId);

    // 6. Lắng nghe tin nhắn từ Worker
    worker.on("message", async (msg) => {
      if (msg.type === "progress") {
        await updateJobProgress(jobId, msg.current, msg.total, msg.message);
      } else if (msg.type === "done") {
        activeWorkers.delete(jobId);
        const resultStr = JSON.stringify(msg.result); // Remove truncation
        await markJobDone(jobId, version_id, resultStr);
        console.log(`[OptimJob #${jobId}] DONE`);
      } else if (msg.type === "error") {
        activeWorkers.delete(jobId);
        await markJobError(jobId, version_id, msg.message);
        console.log(`[OptimJob #${jobId}] ERROR (Custom):`, msg.message);
      }
    });

    worker.on("error", async (err) => {
      activeWorkers.delete(jobId);
      console.error(`[OptimJob #${jobId}] ERROR:`, err.message);
      await markJobError(jobId, version_id, err.message);
    });

    worker.on("exit", (code) => {
      activeWorkers.delete(jobId);
      if (code !== 0) {
        console.error(`[OptimJob #${jobId}] Worker exited with code ${code}`);
      }
    });
  } catch (err) {
    // Rollback khoá nếu khởi tạo thất bại
    await pool
      .query("UPDATE versions SET is_optimizing = FALSE WHERE id = $1", [
        version_id,
      ])
      .catch(() => {});
    console.error("[OptimJob START] Error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
//  GET /api/optimization/status/:jobId
//  Trả về trạng thái và tiến độ của 1 job
// ================================================================
router.get("/status/:jobId", async (req, res) => {
  const { jobId } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, version_id, status, progress, total, message, started_at, finished_at
             FROM optimization_jobs WHERE id = $1`,
      [jobId],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy job" });
    }
    const job = result.rows[0];
    const percent =
      job.total > 0 ? Math.round((job.progress / job.total) * 100) : 0;
    res.json({ success: true, job: { ...job, percent } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
//  GET /api/optimization/jobs?version_id=X
//  Danh sách các job gần đây của 1 version
// ================================================================
router.get("/jobs", async (req, res) => {
  const { version_id } = req.query;
  if (!version_id)
    return res
      .status(400)
      .json({ success: false, message: "Thiếu version_id" });
  try {
    const result = await pool.query(
      `SELECT id, status, progress, total, message, started_at, finished_at
             FROM optimization_jobs
             WHERE version_id = $1
             ORDER BY created_at DESC LIMIT 10`,
      [version_id],
    );
    res.json({ success: true, jobs: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
//  POST /api/optimization/cancel/:jobId
//  Huỷ job đang chạy
// ================================================================
router.post("/cancel/:jobId", async (req, res) => {
  const jobId = parseInt(req.params.jobId);
  try {
    const jobRes = await pool.query(
      "SELECT version_id, status FROM optimization_jobs WHERE id = $1",
      [jobId],
    );
    if (jobRes.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Job không tồn tại" });
    }
    const { version_id, status } = jobRes.rows[0];

    if (status !== "running" && status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Job đã ở trạng thái "${status}", không thể huỷ.`,
      });
    }

    // Terminate worker nếu còn đang chạy
    const worker = activeWorkers.get(jobId);
    if (worker) {
      await worker.terminate();
      activeWorkers.delete(jobId);
    }

    // Cập nhật DB
    await pool.query(
      `UPDATE optimization_jobs SET status = 'cancelled', finished_at = NOW(), message = 'Huỷ bởi người dùng.' WHERE id = $1`,
      [jobId],
    );
    await pool.query(
      "UPDATE versions SET is_optimizing = FALSE WHERE id = $1",
      [version_id],
    );

    res.json({ success: true, message: `Job #${jobId} đã được huỷ.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
//  POST /api/optimization/apply
//  Áp dụng phương án phân chia vùng đã chọn
//  Body: { jobId, optionIndex }
// ================================================================
router.post("/apply", async (req, res) => {
  const { jobId, optionIndex } = req.body;
  if (jobId === undefined || optionIndex === undefined) {
    return res.status(400).json({ success: false, message: "Thiếu jobId hoặc optionIndex" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Fetch the job from DB
    const jobRes = await client.query(
      `SELECT version_id, status, message FROM optimization_jobs WHERE id = $1`,
      [jobId]
    );
    if (jobRes.rows.length === 0) {
      throw new Error("Không tìm thấy job");
    }

    const { version_id, status, message } = jobRes.rows[0];
    if (status !== "done") {
      throw new Error(`Job chưa hoàn thành (Trạng thái hiện tại: ${status})`);
    }

    // Parse options from message
    const resultObj = JSON.parse(message);
    if (!resultObj.options || !resultObj.options[optionIndex]) {
      throw new Error("Phương án lựa chọn không hợp lệ hoặc không tồn tại!");
    }

    const chosenOption = resultObj.options[optionIndex];
    const assignments = chosenOption.assignments; // Object mapping: unitId -> color

    const idUpdates = Object.keys(assignments);
    const colorUpdates = Object.values(assignments);

    if (idUpdates.length > 0) {
      // Thực hiện update hàng loạt basic_units sử dụng session_replication_role = replica 
      // để bypass trigger kiểm tra overlap (tương tự bulk update, bảo toàn dữ liệu và tối ưu hiệu suất)
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      await client.query("SET session_replication_role = replica");

      await client.query(`
        UPDATE basic_units AS b
        SET color = c.color
        FROM (SELECT unnest($1::text[]) AS id, unnest($2::text[]) AS color) AS c
        WHERE b.id::text = c.id AND b.version_id = $3
      `, [idUpdates, colorUpdates, version_id]);

      await client.query("SET session_replication_role = DEFAULT");
    }

    // Mở khoá version
    await client.query(
      `UPDATE versions SET is_optimizing = FALSE WHERE id = $1`,
      [version_id]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Áp dụng thành công "${chosenOption.name}"!`
    });

    // Kích hoạt triggerAutoDump để backup database
    const { triggerAutoDump } = require("../js/autoDump");
    if (triggerAutoDump) {
      console.log("[Apply Optimization] Triggering database dump backup...");
      triggerAutoDump();
    }

  } catch (err) {
    await client.query("SET session_replication_role = DEFAULT").catch(() => {});
    await client.query("ROLLBACK");
    console.error("[Apply Optimization] Error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ================================================================
//  POST /api/optimization/discard
//  Huỷ bỏ kết quả phân chia (Không áp dụng) và mở khoá version
//  Body: { jobId }
// ================================================================
router.post("/discard", async (req, res) => {
  const { jobId } = req.body;
  if (!jobId) {
    return res.status(400).json({ success: false, message: "Thiếu jobId" });
  }
  try {
    const jobRes = await pool.query(
      "SELECT version_id FROM optimization_jobs WHERE id = $1",
      [jobId]
    );
    if (jobRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Không tìm thấy job" });
    }
    const versionId = jobRes.rows[0].version_id;

    // Mở khoá version
    await pool.query(
      `UPDATE versions SET is_optimizing = FALSE WHERE id = $1`,
      [versionId]
    );

    res.json({ success: true, message: "Đã hủy bỏ kết quả phân chia và mở khóa phiên bản thành công." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
//  MIDDLEWARE GUARD: Kiểm tra version có đang bị khoá không
//  Được dùng bởi các route cần bảo vệ (units, districts)
// ================================================================
async function checkVersionLock(req, res, next) {
  // Cho phép tất cả các yêu cầu đọc (GET) đi qua bình thường để bản đồ tải được dữ liệu
  if (req.method === "GET") {
    return next();
  }

  // Lấy version_id từ body hoặc query
  const versionId = req.body?.version_id || req.query?.versionId;
  if (!versionId) return next(); // Không biết version thì bỏ qua guard

  try {
    const vRes = await pool.query(
      "SELECT is_optimizing FROM versions WHERE id = $1",
      [versionId],
    );
    if (vRes.rows.length > 0 && vRes.rows[0].is_optimizing) {
      return res.status(423).json({
        success: false,
        message:
          "🔒 Phiên bản này đang bị khoá vì thuật toán tối ưu hóa đang chạy. Vui lòng chờ hoặc huỷ job trước khi chỉnh sửa.",
      });
    }
    next();
  } catch (err) {
    next(); // Không chặn nếu lỗi kiểm tra
  }
}

router.checkVersionLock = checkVersionLock;
module.exports = router;
module.exports.checkVersionLock = checkVersionLock;
