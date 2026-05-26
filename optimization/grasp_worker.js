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
async function runGRASP(versionId, config, lambdaParam = 0.70) {
  const MAX_ITER = config.maxIterations || 200;
  const p = config.numRegions || 5;
  const alpha = config.alpha || 0.05;
  const TOP_K = Math.min(config.filterTop || 50, MAX_ITER);
  const MAX_LS_MOVES = config.maxLocalSearchMoves || 500;

  // --- FETCH DATA ---
  let unitsRes;
  if (config.selectedIds && config.selectedIds.length > 0) {
    unitsRes = await pool.query(
      `SELECT id, customer_count, order_count, area_km2,
              ST_X(centroid) as cx, ST_Y(centroid) as cy
       FROM basic_units
       WHERE version_id = $1 AND geom IS NOT NULL AND id = ANY($2::int[])`,
      [versionId, config.selectedIds],
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

  // Ma trận khoảng cách lưu sẵn cực nhanh (N x N)
  const distMatrix = {};
  units.forEach((u1) => {
    distMatrix[u1.id] = {};
    units.forEach((u2) => {
      distMatrix[u1.id][u2.id] = haversine(u1.cy, u1.cx, u2.cy, u2.cx);
    });
  });

  const getDist = (id1, id2) => {
    if (id1 === id2) return 0;
    return distMatrix[id1]?.[id2] ?? 0;
  };
  const getDistToCenter = (uid, center) => {
    return haversine(unitMap[uid].cy, unitMap[uid].cx, center.cy, center.cx);
  };
  // Hệ tọa độ phẳng mét phẳng dãn 2D thay thế Haversine siêu tốc
  const getDistToCenterSq = (uid, center) => {
    const dy = unitMap[uid].cy - center.cy;
    const dx = (unitMap[uid].cx - center.cx) * 0.93; // cos(Hanoi latitude 21) ~ 0.93
    return (dy * dy + dx * dx) * 12387.69; // km^2
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
    // Sử dụng lambdaParam truyền vào
    const lambda = lambdaParam;

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

        // Tạo tSet dạng Set để tra cứu lân cận O(1)
        const tSet = new Set(t.units);

        // Score mỗi candidate: lambda * phân_tán (MSE) + (1-lambda) * độ_lệch_cân_bằng - beta * nestedness
        let scored = [];
        let scoreMin = Infinity, scoreMax = -Infinity;

        for (const cid of cands) {
          const u = unitMap[cid];
          let distSq = getDistToCenterSq(cid, t.center);
          let newCust = t.customers + u.customer_count;
          
          // 1. Phạt khoảng cách Bình Phương (Quadratic Penalty) thay vì Tuyến Tính (Linear)
          // giúp các ô lân cận nằm xa tâm bị phạt cực nặng, cưỡng ép hình dạng vùng phải bo tròn
          let f_disp = globalMaxDist > 0 ? distSq / (globalMaxDist * globalMaxDist) : 0;
          let f_dev = mu1 > 0 ? Math.abs(newCust - mu1) / mu1 : 0;

          // 2. Điểm thưởng lân cận biên giới (Nestedness Bonus)
          // Ưu tiên các ô được "ôm" bởi nhiều ô đã có trong Vùng để tăng tối đa độ chặt chẽ (compactness)
          let sharedNeighbors = 0;
          for (const nb of adjList[cid]) {
            if (tSet.has(nb)) sharedNeighbors++;
          }
          let totalNeighbors = adjList[cid].size || 1;
          let nestedness = sharedNeighbors / totalNeighbors; // tỉ lệ [0, 1]

          // Trừ đi điểm thưởng nestedness (beta = 0.25)
          let score = lambda * f_disp + (1 - lambda) * f_dev - 0.25 * nestedness;
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

    // Cập nhật center và tính sumCy, sumCx lưu sẵn để cập nhật O(1)
    for (let i = 0; i < p; i++) {
      let sumCy = 0, sumCx = 0;
      for (const id of sol[i].units) {
        sumCy += unitMap[id].cy;
        sumCx += unitMap[id].cx;
      }
      sol[i].sumCy = sumCy;
      sol[i].sumCx = sumCx;
      sol[i].center = { cy: sumCy / sol[i].units.length, cx: sumCx / sol[i].units.length };
    }

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
        let maxD_t_old = 0, maxD_t2_old = 0;
        for (const id of t.units) {
          const dSq = getDistToCenterSq(id, t.center);
          oldZ1 += dSq;
          if (dSq > maxD_t_old) maxD_t_old = dSq;
        }
        for (const id of t2.units) {
          const dSq = getDistToCenterSq(id, t2.center);
          oldZ1 += dSq;
          if (dSq > maxD_t2_old) maxD_t2_old = dSq;
        }
        
        // Tính toán tâm mới nc1, nc2 cực nhanh bằng O(1)
        let newSumCy1 = t.sumCy - unitMap[uid].cy;
        let newSumCx1 = t.sumCx - unitMap[uid].cx;
        let nc1 = { cy: newSumCy1 / t1New.length, cx: newSumCx1 / t1New.length };

        let newSumCy2 = t2.sumCy + unitMap[uid].cy;
        let newSumCx2 = t2.sumCx + unitMap[uid].cx;
        let nc2 = { cy: newSumCy2 / t2New.length, cx: newSumCx2 / t2New.length };

        let maxD_t_new = 0, maxD_t2_new = 0;
        for (const id of t1New) {
          const dSq = getDistToCenterSq(id, nc1);
          newZ1 += dSq;
          if (dSq > maxD_t_new) maxD_t_new = dSq;
        }
        for (const id of t2New) {
          const dSq = getDistToCenterSq(id, nc2);
          newZ1 += dSq;
          if (dSq > maxD_t2_new) maxD_t2_new = dSq;
        }

        // Tính toán độ gọn dựa trên cả độ phân tán và BÁN KÍNH LỚN NHẤT (maxD)
        // Việc phạt nặng bán kính lớn nhất (phân bổ dài mảnh) bằng hệ số 1.5
        // sẽ triệt tiêu hoàn toàn các hình dạng nối dài xiên xẹo, ép đa giác bo tròn gọn.
        let oldCompactness = Math.sqrt(oldZ1) + 1.5 * (Math.sqrt(maxD_t_old) + Math.sqrt(maxD_t2_old));
        let newCompactness = Math.sqrt(newZ1) + 1.5 * (Math.sqrt(maxD_t_new) + Math.sqrt(maxD_t2_new));
        let dispDelta = globalMaxDist > 0 ? (newCompactness - oldCompactness) / globalMaxDist : 0;

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
        
        // Cập nhật tổng toạ độ và tâm vùng O(1) sau hoán đổi
        t.sumCy -= unitMap[uid].cy;
        t.sumCx -= unitMap[uid].cx;
        t.center = { cy: t.sumCy / t.units.length, cx: t.sumCx / t.units.length };

        t2.units = bestMoveData.t2New;
        t2.customers += bestMoveData.uCust;
        t2.sumCy += unitMap[uid].cy;
        t2.sumCx += unitMap[uid].cx;
        t2.center = { cy: t2.sumCy / t2.units.length, cx: t2.sumCx / t2.units.length };

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
      sol[i].center = { cy: sol[i].sumCy / sol[i].units.length, cx: sol[i].sumCx / sol[i].units.length };
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

  // --- PREPARE ASSIGNMENTS AND SUMMARIES ---
  const summary = [];
  const assignments = {};
  const globalAssigned = new Set(); // Global conflict check để ngăn đếm lặp 1 ô cho nhiều vùng

  for (let i = 0; i < p; i++) {
    const hue = (i * 137.5) % 360;
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
      assignments[String(uid)] = color;
    });

    summary.push({
      color,
      polygonCount: uniqueUnits.length,
      customerCount: totalCustomers,
      orderCount: totalOrders,
    });
  }

  // Calculate load metrics
  let sumDevSq = 0;
  let maxZoneCust = 0;
  let minZoneCust = Infinity;
  for (const s of summary) {
    if (s.customerCount > maxZoneCust) maxZoneCust = s.customerCount;
    if (s.customerCount < minZoneCust) minZoneCust = s.customerCount;
    const dev = s.customerCount - mu1;
    sumDevSq += dev * dev;
  }
  const stdDev = Math.sqrt(sumDevSq / p);
  const cv = mu1 > 0 ? (stdDev / mu1) * 100 : 0; // Coefficient of Variation in %
  const maxDevPercent = mu1 > 0 ? (Math.max(Math.abs(maxZoneCust - mu1), Math.abs(minZoneCust - mu1)) / mu1) * 100 : 0;

  return {
    iterations: MAX_ITER,
    filteredSolutions: filtered.length,
    bestRho,
    localSearchMoves: totalLsMoves,
    contiguityVerified: contiguityOk,
    cv,
    maxDevPercent,
    minZoneCust,
    maxZoneCust,
    summary,
    assignments,
    message: contiguityOk
      ? "Hoàn tất BGRASP."
      : "Hoàn tất BGRASP. CẢNH BÁO: Một số vùng có thể chưa hoàn toàn liên thông.",
  };
}

(async () => {
  try {
    const { versionId, config, jobId } = workerData;

    // Tiến hành chạy tuần tự 3 phương án để người dùng so sánh
    reportProgress(0, 3, "Đang tính toán Phương án 1 (Ưu tiên nhỏ gọn, lambda = 0.85)...");
    const opt1 = await runGRASP(versionId, config, 0.85);

    reportProgress(1, 3, "Đang tính toán Phương án 2 (Cân bằng tối ưu, lambda = 0.70)...");
    const opt2 = await runGRASP(versionId, config, 0.70);

    reportProgress(2, 3, "Đang tính toán Phương án 3 (Cân bằng tải trọng, lambda = 0.40)...");
    const opt3 = await runGRASP(versionId, config, 0.40);

    const options = [
      {
        name: "Phương án 1: Ưu tiên nhỏ gọn & bo tròn",
        description: "Tập trung tối đa vào việc làm gọn các vùng đa giác, tạo thành hình tròn/hình vuông khít nhau. Độ lệch khách hàng có thể cao hơn.",
        lambda: 0.85,
        metrics: {
          bestRho: opt1.bestRho,
          cv: opt1.cv,
          maxDevPercent: opt1.maxDevPercent,
          minZoneCust: opt1.minZoneCust,
          maxZoneCust: opt1.maxZoneCust,
          contiguityVerified: opt1.contiguityVerified
        },
        summary: opt1.summary,
        assignments: opt1.assignments
      },
      {
        name: "Phương án 2: Cân bằng tối ưu",
        description: "Cân đối hài hòa giữa độ gọn gàng hình học của các vùng và phân bổ số lượng khách hàng/đơn hàng tương đối đồng đều.",
        lambda: 0.70,
        metrics: {
          bestRho: opt2.bestRho,
          cv: opt2.cv,
          maxDevPercent: opt2.maxDevPercent,
          minZoneCust: opt2.minZoneCust,
          maxZoneCust: opt2.maxZoneCust,
          contiguityVerified: opt2.contiguityVerified
        },
        summary: opt2.summary,
        assignments: opt2.assignments
      },
      {
        name: "Phương án 3: Cân bằng tải trọng",
        description: "Ưu tiên tối đa việc chia khách hàng/đơn hàng cực kỳ đồng đều giữa các vùng, đồng thời duy trì độ liên thông và tránh hình dạng quá méo mó.",
        lambda: 0.40,
        metrics: {
          bestRho: opt3.bestRho,
          cv: opt3.cv,
          maxDevPercent: opt3.maxDevPercent,
          minZoneCust: opt3.minZoneCust,
          maxZoneCust: opt3.maxZoneCust,
          contiguityVerified: opt3.contiguityVerified
        },
        summary: opt3.summary,
        assignments: opt3.assignments
      }
    ];

    reportProgress(3, 3, "Hoàn tất tính toán cả 3 phương án!");
    reportDone({ options });
  } catch (err) {
    reportError(err);
  } finally {
    pool.end().catch(() => { });
  }
})();
