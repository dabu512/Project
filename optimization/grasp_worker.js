// optimization/grasp_worker.js
// Worker Thread - Thuật toán BGRASP (Bi-objective GRASP)
// Theo đúng paper: Construction → Filter ρ(S) → Relinked Local Search

const { workerData, parentPort } = require("worker_threads");
const pool = require("../db");

function reportProgress(current, total, message = "") {
  parentPort.postMessage({ type: "progress", current, total, message });
}
function reportDone(result) {
  parentPort.postMessage({ type: "done", result });
}
function reportError(err) {
  parentPort.postMessage({
    type: "error",
    message: err.message || String(err),
  });
}

// Haversine: khoảng cách (km) giữa 2 điểm trên mặt cầu
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hslToHex(h, s, l) {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Kiểm tra tính liên thông của tập ô
function isConnectedSubgraph(unitIds, adjList) {
  if (unitIds.length <= 1) return true;
  const idSet = new Set(unitIds);
  const visited = new Set();
  const queue = [unitIds[0]];
  visited.add(unitIds[0]);
  while (queue.length > 0) {
    const curr = queue.shift();
    for (const nb of adjList[curr]) {
      if (idSet.has(nb) && !visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }
  return visited.size === idSet.size;
}

// Tìm ô biên chưa gán của một vùng
function getBorderCandidates(territoryUnits, adjList, assigned) {
  const candidates = new Set();
  for (const uid of territoryUnits) {
    for (const adjId of adjList[uid]) {
      if (!assigned.has(adjId)) candidates.add(adjId);
    }
  }
  return Array.from(candidates);
}

// ================================================================
//  THUẬT TOÁN BGRASP CHÍNH
// ================================================================
async function runGRASP(versionId, config) {
  const MAX_ITER = config.maxIterations || 200;
  const p = config.numRegions || 5;
  const alpha = config.alpha || 0.05;
  const TOP_K = Math.min(config.filterTop || 50, MAX_ITER);
  const MAX_LS_MOVES = config.maxLocalSearchMoves || 500;

  // --- FETCH DATA ---
  let unitsRes;
  if (config.selectedIds && config.selectedIds.length > 0) {
    const ids = config.selectedIds.join(",");
    unitsRes = await pool.query(
      `SELECT id, customer_count, order_count, area_km2,
              ST_X(centroid) as cx, ST_Y(centroid) as cy
       FROM basic_units
       WHERE version_id = $1 AND geom IS NOT NULL AND id IN (${ids})`,
      [versionId],
    );
  } else {
    unitsRes = await pool.query(
      `SELECT id, customer_count, order_count, area_km2,
              ST_X(centroid) as cx, ST_Y(centroid) as cy
       FROM basic_units
       WHERE version_id = $1 AND geom IS NOT NULL`,
      [versionId],
    );
  }
  const units = unitsRes.rows;
  if (units.length < p) {
    throw new Error(
      `Số lượng ô (${units.length}) ít hơn số vùng cần chia (${p})!`,
    );
  }

  // --- ADJACENCY ---
  const adjacencyRes = await pool.query(
    `SELECT unit_a_id, unit_b_id FROM unit_adjacencies WHERE version_id = $1`,
    [versionId],
  );
  const adjList = {};
  units.forEach((u) => (adjList[u.id] = new Set()));
  adjacencyRes.rows.forEach((r) => {
    if (adjList[r.unit_a_id] && adjList[r.unit_b_id]) {
      adjList[r.unit_a_id].add(r.unit_b_id);
      adjList[r.unit_b_id].add(r.unit_a_id);
    }
  });

  // Kiểm tra liên thông đầu vào
  if (config.selectedIds && config.selectedIds.length > 0 && units.length > 0) {
    let visited = new Set();
    let queue = [units[0].id];
    visited.add(units[0].id);
    while (queue.length > 0) {
      let curr = queue.shift();
      for (let nb of adjList[curr]) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    if (visited.size !== units.length) {
      throw new Error(
        "Các đa giác được chọn rời rạc (không liền kề nhau). Vui lòng chọn một cụm liền mạch!",
      );
    }
  }

  reportProgress(0, MAX_ITER, `Bắt đầu BGRASP: ${units.length} ô, ${p} vùng`);

  // --- PRE-COMPUTE ---
  const unitMap = {};
  units.forEach((u) => {
    // Ép kiểu số để tránh lỗi cộng chuỗi (Data Type Mismatch)
    u.customer_count = Number(u.customer_count) || 0;
    u.order_count = Number(u.order_count) || 0;
    unitMap[String(u.id)] = u; // Chuẩn hoá ID
  });

  let minCx = Infinity, maxCx = -Infinity, minCy = Infinity, maxCy = -Infinity;
  let totalCustomers = 0;
  units.forEach((u) => {
    totalCustomers += u.customer_count;
    if (u.cx < minCx) minCx = u.cx;
    if (u.cx > maxCx) maxCx = u.cx;
    if (u.cy < minCy) minCy = u.cy;
    if (u.cy > maxCy) maxCy = u.cy;
  });

  // Xấp xỉ khoảng cách lớn nhất bằng khoảng cách giữa các góc của bounding box
  const globalMaxDist = Math.max(
    haversine(minCy, minCx, maxCy, maxCx),
    haversine(minCy, maxCx, maxCy, minCx)
  );

  const mu1 = totalCustomers / p;
  // d_max theo paper: ((|V| - p) / p) * max{d_ij}
  const d_max = ((units.length - p) / p) * globalMaxDist;

  const getDist = (id1, id2) => {
    if (id1 === id2) return 0;
    const u1 = unitMap[id1], u2 = unitMap[id2];
    return haversine(u1.cy, u1.cx, u2.cy, u2.cx);
  };
  const getDistToCenter = (uid, center) => {
    return haversine(unitMap[uid].cy, unitMap[uid].cx, center.cy, center.cx);
  };
  // Dùng bình phương khoảng cách (MSE) để phạt nặng các ô nằm xa tâm, ép hình dáng vùng phải tròn và gọn.
  const getDistToCenterSq = (uid, center) => {
    const d = haversine(unitMap[uid].cy, unitMap[uid].cx, center.cy, center.cx);
    return d * d;
  };

  // Center: Thay vì dùng Medoid (độ phức tạp O(N^2) gây cực kỳ chậm ở Local Search),
  // ta dùng Average Spatial Centroid (Trung bình toạ độ - độ phức tạp O(N)) giúp tốc độ chạy tăng gấp trăm lần.
  const computeCenter = (unitIds) => {
    if (unitIds.length === 0) return { cy: 0, cx: 0 };
    let sumCy = 0, sumCx = 0;
    for (const id of unitIds) {
      sumCy += unitMap[id].cy;
      sumCx += unitMap[id].cx;
    }
    return { cy: sumCy / unitIds.length, cx: sumCx / unitIds.length };
  };

  // ================================================================
  //  PHA 1: CONSTRUCTION - Tạo MAX_ITER giải pháp
  // ================================================================
  const allSolutions = [];

  for (let iter = 0; iter < MAX_ITER; iter++) {
    // Đã thay đổi hệ số cân bằng cố định là 0.5 theo yêu cầu
    const lambda = 0.7;

    // 1a. Chọn seeds (ngẫu nhiên từ top-degree, rải đều)
    let sortedByDegree = [...units].sort(
      (a, b) => adjList[b.id].size - adjList[a.id].size,
    );
    let topK = Math.max(1, Math.floor(sortedByDegree.length * 0.15));
    let firstSeed = sortedByDegree[Math.floor(Math.random() * topK)];

    let seeds = [firstSeed.id];
    let assigned = new Set([firstSeed.id]);

    for (let i = 1; i < p; i++) {
      let scored = [];
      for (const u of units) {
        if (assigned.has(u.id)) continue;
        let minD = Infinity;
        for (const sid of seeds) {
          let d = getDist(u.id, sid);
          if (d < minD) minD = d;
        }
        scored.push({ id: u.id, dist: minD });
      }
      scored.sort((a, b) => b.dist - a.dist);
      let topN = Math.max(1, Math.floor(scored.length * 0.2));
      let pick = scored[Math.floor(Math.random() * topN)];
      seeds.push(pick.id);
      assigned.add(pick.id);
    }

    // 1b. Khởi tạo territories
    let territories = seeds.map((sid) => ({
      units: [sid],
      customers: unitMap[sid].customer_count || 0,
      center: { cy: unitMap[sid].cy, cx: unitMap[sid].cx },
    }));

    // 1c. Round-robin Voronoi-like expansion
    // Mỗi vòng: sắp xếp vùng theo kích thước tăng dần, vùng nhỏ mở rộng trước.
    // Mỗi vùng chọn 1 ô biên GẦN TÂM NHẤT (thông qua RCL cục bộ).
    // Giúp các vùng phát triển tròn trịa kiểu Voronoi, không đâm xuyên vào nhau.
    while (assigned.size < units.length) {
      // Sắp xếp vùng theo kích thước (ít ô → nhiều ô) để cân bằng tốc độ mở rộng
      let order = Array.from({ length: p }, (_, i) => i);
      order.sort((a, b) => territories[a].units.length - territories[b].units.length);

      let addedAny = false;

      for (const idx of order) {
        const cands = getBorderCandidates(territories[idx].units, adjList, assigned);
        if (cands.length === 0) continue;

        const t = territories[idx];

        // Score mỗi candidate: lambda * phân_tán (MSE) + (1-lambda) * độ_lệch_cân_bằng
        let scored = [];
        let scoreMin = Infinity, scoreMax = -Infinity;

        for (const cid of cands) {
          const u = unitMap[cid];
          let distSq = getDistToCenterSq(cid, t.center);
          let newCust = t.customers + u.customer_count;
          // Chuẩn hoá f_disp và f_dev về cùng một thang đo (tương đối [0, 1])
          // Lấy căn bậc 2 của distSq / d_max^2 để khoảng cách tuyến tính hơn, tăng độ nhạy
          let f_disp = globalMaxDist > 0 ? Math.sqrt(distSq) / globalMaxDist : 0;
          let f_dev = mu1 > 0 ? Math.abs(newCust - mu1) / mu1 : 0;

          let score = lambda * f_disp + (1 - lambda) * f_dev;
          scored.push({ id: cid, score });
          if (score < scoreMin) scoreMin = score;
          if (score > scoreMax) scoreMax = score;
        }

        // Tạo RCL cục bộ (chỉ trong các ứng viên của Vùng này)
        let threshold = scoreMin + alpha * (scoreMax - scoreMin);
        let rcl = scored.filter(v => v.score <= threshold);
        if (rcl.length === 0) rcl = [scored.reduce((a, b) => a.score < b.score ? a : b)];

        let chosen = rcl[Math.floor(Math.random() * rcl.length)];

        t.units.push(chosen.id);
        t.customers += unitMap[chosen.id].customer_count;
        t.center = computeCenter(t.units);
        assigned.add(chosen.id);
        addedAny = true;
      }

      if (!addedAny) {
        // Xử lý ô cô lập bằng BFS nếu bị kẹt
        let unassignedIds = units
          .filter((u) => !assigned.has(u.id))
          .map((u) => u.id);
        for (const orphanId of unassignedIds) {
          let bfsVisited = new Set([orphanId]);
          let bfsQueue = [orphanId];
          let foundT = -1;
          while (bfsQueue.length > 0 && foundT === -1) {
            let curr = bfsQueue.shift();
            for (const nb of adjList[curr]) {
              if (!bfsVisited.has(nb)) {
                bfsVisited.add(nb);
                if (assigned.has(nb)) {
                  for (let ti = 0; ti < p; ti++) {
                    if (territories[ti].units.some(id => String(id) === String(nb))) {
                      foundT = ti;
                      break;
                    }
                  }
                  break;
                }
                bfsQueue.push(nb);
              }
            }
          }
          if (foundT === -1) {
            let minD = Infinity;
            for (let ti = 0; ti < p; ti++) {
              let d = getDistToCenter(orphanId, territories[ti].center);
              if (d < minD) {
                minD = d;
                foundT = ti;
              }
            }
          }
          territories[foundT].units.push(orphanId);
          territories[foundT].customers += unitMap[orphanId].customer_count;
          territories[foundT].center = computeCenter(territories[foundT].units);
          assigned.add(orphanId);
        }
        break;
      }
    }

    // 1d. Sửa chữa tính liên thông
    for (let repair = 0; repair < 5; repair++) {
      let hadRepair = false;
      for (let i = 0; i < p; i++) {
        const t = territories[i];
        if (t.units.length <= 1) continue;
        const unitSet = new Set(t.units);
        const components = [];
        const visited = new Set();
        for (const startId of t.units) {
          if (visited.has(startId)) continue;
          const comp = [];
          const q = [startId];
          visited.add(startId);
          while (q.length > 0) {
            const curr = q.shift();
            comp.push(curr);
            for (const nb of adjList[curr]) {
              if (!visited.has(nb) && unitSet.has(nb)) {
                visited.add(nb);
                q.push(nb);
              }
            }
          }
          components.push(comp);
        }
        if (components.length <= 1) continue;
        components.sort((a, b) => b.length - a.length);
        const mainComp = new Set(components[0]);
        for (let ci = 1; ci < components.length; ci++) {
          const comp = components[ci];
          let adjacentTerritories = new Set();

          for (const uid of comp) {
            for (const nb of adjList[uid]) {
              if (!comp.some(id => String(id) === String(nb))) {
                if (mainComp.has(nb)) adjacentTerritories.add(i);
                else {
                  for (let j = 0; j < p; j++) {
                    if (j !== i && territories[j].units.some(id => String(id) === String(nb))) adjacentTerritories.add(j);
                  }
                }
              }
            }
          }

          if (adjacentTerritories.size > 0) {
            let bestTarget = -1, bestImprove = -Infinity;
            let compCust = 0;
            for (const uid of comp) compCust += unitMap[uid].customer_count || 0;

            if (adjacentTerritories.has(i)) {
              bestTarget = i;
            } else {
              for (const j of adjacentTerritories) {
                const improve = Math.abs(territories[j].customers - mu1) - Math.abs(territories[j].customers + compCust - mu1);
                if (improve > bestImprove) {
                  bestImprove = improve;
                  bestTarget = j;
                }
              }
            }

            if (bestTarget !== -1 && bestTarget !== i) {
              for (const uid of comp) {
                t.units = t.units.filter((id) => String(id) !== String(uid));
                t.customers -= unitMap[uid].customer_count;
                territories[bestTarget].units.push(uid);
                territories[bestTarget].customers += unitMap[uid].customer_count;
              }
              t.center = computeCenter(t.units);
              territories[bestTarget].center = computeCenter(territories[bestTarget].units);
              hadRepair = true;
            }
          }
        }
      }
      if (!hadRepair) break;
    }

    // 1e. Sửa chữa ngoại lệ (Hard-limit cân bằng cưỡng bức)
    // Nếu có vùng quá bé do bị bao vây, ép nó mở rộng từ láng giềng lớn hơn
    for (let i = 0; i < p; i++) {
      let t = territories[i];
      let forcedMoves = 0;
      while (t.customers < mu1 * 0.5 && forcedMoves < 5) {
        let bestNeighborNode = null;
        let bestSourceT = -1;
        let maxGain = -Infinity;

        for (let uid of t.units) {
          for (let nb of adjList[uid]) {
            if (!t.units.some(id => String(id) === String(nb))) {
              let j = -1;
              for (let k = 0; k < p; k++) if (territories[k].units.some(id => String(id) === String(nb))) j = k;

              if (j !== -1 && territories[j].customers > mu1 * 0.8) {
                let t2New = territories[j].units.filter(id => String(id) !== String(nb));
                let connected = true;
                if (t2New.length > 0) {
                  let remainSet = new Set(t2New);
                  let vis = new Set([t2New[0]]);
                  let q = [t2New[0]];
                  while (q.length > 0) {
                    let c = q.shift();
                    for (let n of adjList[c]) {
                      if (remainSet.has(n) && !vis.has(n)) { vis.add(n); q.push(n); }
                    }
                  }
                  connected = vis.size === t2New.length;
                }
                if (connected) {
                  let gain = unitMap[nb].customer_count || 0;
                  if (gain > maxGain) {
                    maxGain = gain;
                    bestNeighborNode = nb;
                    bestSourceT = j;
                  }
                }
              }
            }
          }
        }
        if (bestNeighborNode) {
          territories[bestSourceT].units = territories[bestSourceT].units.filter(id => String(id) !== String(bestNeighborNode));
          territories[bestSourceT].customers -= maxGain;
          territories[bestSourceT].center = computeCenter(territories[bestSourceT].units);
          t.units.push(bestNeighborNode);
          t.customers += maxGain;
          t.center = computeCenter(t.units);
          forcedMoves++;
        } else {
          break;
        }
      }
    }

    // 1f. Tính ρ(S) theo paper để đánh giá solution
    // ρ(S) = 2·f_disp(S) / ((|V|-p)·d_max^2) + f_Tdev / p
    let fDispS = 0; // f_disp(S) = Σ_t Σ_j d_j(c_t)^2
    let fTdev = 0; // f_Tdev = Σ_t (1/μ) * |w(V_t) - μ|
    for (let i = 0; i < p; i++) {
      const t = territories[i];
      t.center = computeCenter(t.units);
      for (const uid of t.units) fDispS += getDistToCenterSq(uid, t.center);
      fTdev += mu1 > 0 ? Math.abs(t.customers - mu1) / mu1 : 0;
    }
    let rho =
      globalMaxDist > 0 && units.length > p
        ? (2 * fDispS) / ((units.length - p) * globalMaxDist * globalMaxDist) + fTdev / p
        : Infinity;

    allSolutions.push({
      territories: JSON.parse(JSON.stringify(territories)),
      rho,
      lambda,
      fDispS,
      fTdev,
    });

    if (iter % 10 === 0 || iter === MAX_ITER - 1) {
      reportProgress(
        iter + 1,
        MAX_ITER,
        `Construction ${iter + 1}/${MAX_ITER} (λ=${lambda.toFixed(1)}, ρ=${rho.toFixed(4)})`,
      );
    }
    await new Promise((r) => setTimeout(r, 2));
  }

  // ================================================================
  //  PHA 2: LỌC - Chọn TOP_K giải pháp tốt nhất bằng ρ(S)
  // ================================================================
  allSolutions.sort((a, b) => a.rho - b.rho);
  const filtered = allSolutions.slice(0, TOP_K);
  reportProgress(
    MAX_ITER,
    MAX_ITER,
    `Đã lọc ${filtered.length} giải pháp tốt nhất (ρ tốt nhất: ${filtered[0].rho.toFixed(4)})`,
  );

  // ================================================================
  //  PHA 3: RELINKED LOCAL SEARCH trên các giải pháp đã lọc
  //  Theo paper: N(S) = {(i,j) ∈ E : q(i) ≠ q(j)}
  //  Move operator: move(i,j) chuyển node i từ q(i) sang q(j)
  //  Tối ưu lần lượt z1 → z2 → z1 → z2 (relinked)
  // ================================================================
  let bestSolution = filtered[0].territories;
  let bestRho = filtered[0].rho;
  let totalLsMoves = 0;

  for (let si = 0; si < filtered.length; si++) {
    const lambda = filtered[si].lambda; // Lấy lambda đã lưu từ pha Construction

    // Thay thế JSON.stringify bằng Shallow Copy để tối ưu hiệu suất
    let sol = filtered[si].territories.map(t => ({
      units: [...t.units],
      customers: t.customers,
      center: { ...t.center }
    }));

    // assignMap: q(i) - territory chứa node i
    let assignMap = {};
    for (let i = 0; i < p; i++) {
      for (const uid of sol[i].units) assignMap[uid] = i;
    }

    // Cập nhật center (medoid)
    for (let i = 0; i < p; i++) sol[i].center = computeCenter(sol[i].units);

    // Xây dựng tập lân cận N(S): các cạnh biên giữa 2 territory khác nhau
    // N(S) = {(i,j) ∈ E : q(i) ≠ q(j)}
    const buildBorderEdges = () => {
      const edges = [];
      for (const u of units) {
        const qi = assignMap[u.id];
        if (qi === undefined) continue;
        for (const adjId of adjList[u.id]) {
          const qj = assignMap[adjId];
          if (qj !== undefined && qi !== qj) {
            edges.push({ nodeId: u.id, fromT: qi, toT: qj });
          }
        }
      }
      return edges;
    };

    let lsMoves = 0;
    let noImproveCycles = 0;

    while (lsMoves < MAX_LS_MOVES && noImproveCycles < 4) {
      let improved = false;
      // Lấy tất cả cạnh biên N(S)
      const borderEdges = buildBorderEdges();

      let bestMoveEdge = null;
      let maxImprovement = -Infinity; // Khởi tạo âm vô cực để so sánh delta tốt hơn
      let bestMoveData = null;

      // Đánh giá tất cả để tìm Best-Improvement dựa trên hàm mục tiêu KẾT HỢP ρ
      // Việc này giúp mọi bước di chuyển đều phải thoả mãn cải thiện TỔNG THỂ,
      // không bao giờ hy sinh hoàn toàn độ tròn trịa (compactness) chỉ để lấy 1 chút cân bằng (balance).
      for (const edge of borderEdges) {
        const { nodeId: uid, fromT: i, toT: j } = edge;
        let t = sol[i];
        let t2 = sol[j];
        if (t.units.length <= 1) continue;

        let uCust = unitMap[uid].customer_count;
        let t1New = t.units.filter((id) => String(id) !== String(uid));
        let t2New = [...t2.units, uid];

        // 1. Tính sự thay đổi của độ phân tán (Dispersion - MSE compactness)
        let oldZ1 = 0, newZ1 = 0;
        for (const id of t.units) oldZ1 += getDistToCenterSq(id, t.center);
        for (const id of t2.units) oldZ1 += getDistToCenterSq(id, t2.center);
        let nc1 = computeCenter(t1New);
        let nc2 = computeCenter(t2New);
        for (const id of t1New) newZ1 += getDistToCenterSq(id, nc1);
        for (const id of t2New) newZ1 += getDistToCenterSq(id, nc2);

        // Tính toán khoảng cách tuyến tính trung bình (RMS) thay vì tổng bình phương
        // để dispDelta có cùng độ lớn đại số (magnitude) với balDelta
        let dispDelta = globalMaxDist > 0 ? (Math.sqrt(newZ1) - Math.sqrt(oldZ1)) / globalMaxDist : 0;

        // 2. Tính sự thay đổi của độ lệch cân bằng (Balance deviation)
        let oldDev = Math.abs(t.customers - mu1) + Math.abs(t2.customers - mu1);
        let newDev = Math.abs(t.customers - uCust - mu1) + Math.abs(t2.customers + uCust - mu1);

        // Chia cho mu1 * 2 thay vì mu1 * p vì ta chỉ quan tâm delta giữa 2 vùng đang xét
        let balDelta = mu1 > 0 ? (newDev - oldDev) / (mu1 * 2) : 0;

        // 3. Kết hợp lại thành sự thay đổi của ρ (rhoDelta)
        // Nếu rhoDelta < 0 nghĩa là giải pháp MỚI tốt hơn (ρ giảm)
        let rhoDelta = lambda * dispDelta + (1 - lambda) * balDelta;
        let improvement = -rhoDelta; // Cải thiện dương nghĩa là ρ giảm

        if (improvement > 0 && improvement > maxImprovement) {
          // Connectivity check: Sau khi bỏ uid, territory nguồn vẫn liên thông?
          let connected = true;
          if (t.units.length > 2) {
            let remainSet = new Set(t1New);
            let vis = new Set([t1New[0]]);
            let q = [t1New[0]];
            while (q.length > 0) {
              let c = q.shift();
              for (let n of adjList[c]) {
                if (remainSet.has(n) && !vis.has(n)) {
                  vis.add(n);
                  q.push(n);
                }
              }
            }
            connected = vis.size === t1New.length;
          }

          if (connected) {
            maxImprovement = improvement;
            bestMoveEdge = edge;
            bestMoveData = { uCust, t1New, t2New };
          }
        }
      }

      if (bestMoveEdge) {
        // Thực hiện Best-Improvement
        const { nodeId: uid, fromT: i, toT: j } = bestMoveEdge;
        let t = sol[i];
        let t2 = sol[j];

        t.units = bestMoveData.t1New;
        t.customers -= bestMoveData.uCust;
        t2.units = bestMoveData.t2New;
        t2.customers += bestMoveData.uCust;

        // Cập nhật center (medoid) sau move
        t.center = computeCenter(t.units);
        t2.center = computeCenter(t2.units);
        // Cập nhật assignMap: q(uid) = j
        assignMap[uid] = j;
        lsMoves++;
        improved = true;
      }

      if (!improved) {
        noImproveCycles++;
      } else {
        noImproveCycles = 0;
      }
    }

    totalLsMoves += lsMoves;

    // Đánh giá lại ρ(S) sau Local Search
    let fDispS = 0,
      fTdev = 0;
    for (let i = 0; i < p; i++) {
      sol[i].center = computeCenter(sol[i].units);
      for (const uid of sol[i].units)
        fDispS += getDistToCenterSq(uid, sol[i].center);
      fTdev += mu1 > 0 ? Math.abs(sol[i].customers - mu1) / mu1 : 0;
    }
    let rho = (2 * fDispS) / ((units.length - p) * globalMaxDist * globalMaxDist) + fTdev / p;

    if (rho < bestRho) {
      bestRho = rho;
      bestSolution = sol;
    }

    if (si % 5 === 0) {
      reportProgress(
        MAX_ITER,
        MAX_ITER,
        `Local Search ${si + 1}/${filtered.length} (ρ=${bestRho.toFixed(4)}, moves: ${lsMoves})`,
      );
    }
    await new Promise((r) => setTimeout(r, 2));
  }

  // --- FINAL VALIDATION ---
  let contiguityOk = true;
  for (let i = 0; i < p; i++) {
    if (!isConnectedSubgraph(bestSolution[i].units, adjList)) {
      contiguityOk = false;
      break;
    }
  }

  // --- SAVE TO DB ---
  reportProgress(MAX_ITER, MAX_ITER, `Đang cập nhật màu sắc bản đồ...`);

  const summary = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const idUpdates = [];
    const colorUpdates = [];
    const globalAssigned = new Set(); // Global conflict check để ngăn đếm lặp 1 ô cho nhiều vùng

    for (let i = 0; i < p; i++) {
      const hue = (i * 360) / p;
      const color = hslToHex(hue, 75, 55);
      let t = bestSolution[i];

      let uniqueUnits = [];
      for (const uid of t.units) {
        const strId = String(uid);
        if (!globalAssigned.has(strId)) {
          globalAssigned.add(strId);
          uniqueUnits.push(uid);
        }
      }

      let totalOrders = 0;
      let totalCustomers = 0;

      uniqueUnits.forEach((uid) => {
        totalOrders += unitMap[uid].order_count;
        totalCustomers += unitMap[uid].customer_count;
        idUpdates.push(uid);
        colorUpdates.push(color);
      });

      summary.push({
        color,
        polygonCount: uniqueUnits.length,
        customerCount: totalCustomers,
        orderCount: totalOrders,
      });
    }

    if (idUpdates.length > 0) {
      // Gộp các ID và thực hiện UPDATE theo lô (Bulk Update) để tối ưu round-trip
      await client.query(`
        UPDATE basic_units AS b
        SET color = c.color
        FROM (SELECT unnest($1::text[]) AS id, unnest($2::text[]) AS color) AS c
        WHERE b.id::text = c.id
      `, [idUpdates.map(String), colorUpdates]);
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  return {
    iterations: MAX_ITER,
    filteredSolutions: filtered.length,
    bestRho,
    localSearchMoves: totalLsMoves,
    contiguityVerified: contiguityOk,
    summary,
    message: contiguityOk
      ? "Hoàn tất BGRASP. Tất cả các vùng đều liên thông."
      : "Hoàn tất BGRASP. CẢNH BÁO: Một số vùng có thể chưa hoàn toàn liên thông.",
  };
}

(async () => {
  try {
    const { versionId, config, jobId } = workerData;
    const result = await runGRASP(versionId, config);
    reportDone(result);
  } catch (err) {
    reportError(err);
  } finally {
    pool.end().catch(() => { });
  }
})();
