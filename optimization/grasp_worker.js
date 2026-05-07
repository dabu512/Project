// optimization/grasp_worker.js
// Worker Thread chạy ngầm thuật toán GRASP
// Được spawn bởi routes/optimization.js, KHÔNG bao giờ import trực tiếp

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

// Công thức Haversine: Tính khoảng cách đường chim bay giữa
// 2 điểm (Lat, Lng) trên mặt cầu
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
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Random màu hex cho việc tô màu bản đồ sau khi phân vùng
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

// ================================================================
//  HELPER: Kiểm tra tính liên thông (connected) của một tập ô
//  Trả về true nếu tất cả các ô trong unitIds tạo thành 1 cụm liên thông
// ================================================================
function isConnectedSubgraph(unitIds, adjList) {
  if (unitIds.length <= 1) return true;
  const idSet = new Set(unitIds);
  const visited = new Set();
  const queue = [unitIds[0]];
  visited.add(unitIds[0]);
  while (queue.length > 0) {
    const curr = queue.shift();
    for (const neighbor of adjList[curr]) {
      if (idSet.has(neighbor) && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited.size === idSet.size;
}

// ================================================================
//  HELPER: Tìm tất cả ô biên của một vùng (có ít nhất 1 neighbor chưa gán)
// ================================================================
function getBorderCandidates(territoryUnits, adjList, assigned) {
  const candidates = new Set();
  for (const uid of territoryUnits) {
    for (const adjId of adjList[uid]) {
      if (!assigned.has(adjId)) candidates.add(adjId);
    }
  }
  return Array.from(candidates);
}

async function runGRASP(versionId, config) {
  const MAX_ITER = config.maxIterations || 200;
  const p = config.numRegions || 5;
  const lambda = config.lambda !== undefined ? config.lambda : 0.5;
  const alpha = config.alpha || 0.05;

  // Fetch units
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

  // Lấy dữ liệu ô nào chạm cạnh ô nào
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

  // Kiểm tra tính liên kết
  if (config.selectedIds && config.selectedIds.length > 0 && units.length > 0) {
    let visited = new Set();
    let queue = [units[0].id];
    visited.add(units[0].id);
    while (queue.length > 0) {
      let curr = queue.shift();
      for (let neighbor of adjList[curr]) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
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

  // Tính toán các hằng số mục tiêu
  const unitMap = {};
  units.forEach((u) => (unitMap[u.id] = u));

  // Pre-calculate distances
  const distMap = {}; // ma trận khoảng cách giữa các đa giác (id1_id2 -> distance)
  let maxDist = 0;
  let totalCustomers = 0;
  units.forEach((u1) => {
    totalCustomers += u1.customer_count || 0;
    units.forEach((u2) => {
      if (u1.id < u2.id) {
        const d = haversine(u1.cy, u1.cx, u2.cy, u2.cx);
        distMap[`${u1.id}_${u2.id}`] = d;
        distMap[`${u2.id}_${u1.id}`] = d;
        if (d > maxDist) maxDist = d;
      }
    });
    distMap[`${u1.id}_${u1.id}`] = 0;
  });

  const mu1 = totalCustomers / p; // Số lượng khách hàng lý tưởng
  const d_max = ((units.length - p) / p) * maxDist;

  // Helper func
  const getDist = (id1, id2) => distMap[`${id1}_${id2}`] || 0;

  const getDistToCenter = (uid, center) => {
    return haversine(unitMap[uid].cy, unitMap[uid].cx, center.cy, center.cx);
  };

  const updateCenter = (t) => {
    if (t.units.length === 0) return;
    let sumY = 0,
      sumX = 0;
    for (const id of t.units) {
      sumY += unitMap[id].cy;
      sumX += unitMap[id].cx;
    }
    t.center = {
      cy: sumY / t.units.length,
      cx: sumX / t.units.length,
    };
  };

  const calcPhi = (unitsArray, customers) => {
    if (unitsArray.length === 0) return Infinity;
    let sumY = 0,
      sumX = 0;
    for (const id of unitsArray) {
      sumY += unitMap[id].cy;
      sumX += unitMap[id].cx;
    }
    let cy = sumY / unitsArray.length;
    let cx = sumX / unitsArray.length;

    let sumDist = 0;
    for (const id of unitsArray) {
      sumDist += haversine(unitMap[id].cy, unitMap[id].cx, cy, cx);
    }
    let f_disp = maxDist > 0 ? sumDist / maxDist : 0;
    let f_dev = mu1 > 0 ? Math.abs(mu1 - customers) / mu1 : 0;
    return lambda * f_disp + (1 - lambda) * f_dev;
  };

  // Tạo lookup nhanh: unitId -> territoryIndex
  function buildAssignmentMap(territories) {
    const map = {};
    for (let i = 0; i < territories.length; i++) {
      for (const uid of territories[i].units) {
        map[uid] = i;
      }
    }
    return map;
  }

  let bestSolution = null;
  let bestRho = Infinity;

  for (let iter = 1; iter <= MAX_ITER; iter++) {
    // --- PHASE 1: CONSTRUCTION ---
    // 1. Chọn seeds với randomization (BGRASP)
    let sortedByDegree = [...units].sort(
      (a, b) => adjList[b.id].size - adjList[a.id].size,
    );
    // Chọn seed đầu tiên ngẫu nhiên từ top-degree candidates
    let topK = Math.max(1, Math.floor(sortedByDegree.length * 0.15));
    let firstSeed = sortedByDegree[Math.floor(Math.random() * topK)];

    let seeds = [];
    let assigned = new Set();

    seeds.push(firstSeed.id);
    assigned.add(firstSeed.id);

    // chọn p - 1 seeds còn lại: greedy-random (xa các seeds đã chọn)
    for (let i = 1; i < p; i++) {
      let scoredCandidates = [];
      for (const u of units) {
        if (assigned.has(u.id)) continue;
        let minDistToSeed = Infinity;
        for (const sid of seeds) {
          let d = getDist(u.id, sid);
          if (d < minDistToSeed) minDistToSeed = d;
        }
        scoredCandidates.push({ id: u.id, dist: minDistToSeed });
      }
      scoredCandidates.sort((a, b) => b.dist - a.dist);
      // Chọn ngẫu nhiên từ top 20% xa nhất
      let topN = Math.max(1, Math.floor(scoredCandidates.length * 0.2));
      let chosen = scoredCandidates[Math.floor(Math.random() * topN)];
      seeds.push(chosen.id);
      assigned.add(chosen.id);
    }

    // Initialize territories
    let territories = seeds.map((sid) => {
      let u = unitMap[sid];
      return {
        units: [sid],
        customers: u.customer_count || 0,
        center: { cy: u.cy, cx: u.cx },
      };
    });

    // 2. Gán các ô còn lại - Round-robin growth (vùng ít ô nhất mở rộng trước)
    let stuckCount = 0;
    while (assigned.size < units.length) {
      // Tìm tất cả các vùng có thể mở rộng (có neighbor chưa gán)
      let expandable = [];
      for (let i = 0; i < p; i++) {
        const candidates = getBorderCandidates(
          territories[i].units,
          adjList,
          assigned,
        );
        if (candidates.length > 0) {
          expandable.push({ idx: i, candidates });
        }
      }

      if (expandable.length === 0) {
        // Orphan handling (giữ nguyên logic BFS)
        let unassignedIds = units
          .filter((u) => !assigned.has(u.id))
          .map((u) => u.id);

        for (const orphanId of unassignedIds) {
          let bfsVisited = new Set([orphanId]);
          let bfsQueue = [orphanId];
          let foundTerritory = -1;

          while (bfsQueue.length > 0 && foundTerritory === -1) {
            let curr = bfsQueue.shift();
            for (const nb of adjList[curr]) {
              if (!bfsVisited.has(nb)) {
                bfsVisited.add(nb);
                if (assigned.has(nb)) {
                  for (let ti = 0; ti < p; ti++) {
                    if (territories[ti].units.includes(nb)) {
                      foundTerritory = ti;
                      break;
                    }
                  }
                  break;
                }
                bfsQueue.push(nb);
              }
            }
          }

          if (foundTerritory === -1) {
            let minD = Infinity;
            for (let ti = 0; ti < p; ti++) {
              let d = getDistToCenter(orphanId, territories[ti].center);
              if (d < minD) {
                minD = d;
                foundTerritory = ti;
              }
            }
          }

          territories[foundTerritory].units.push(orphanId);
          territories[foundTerritory].customers +=
            unitMap[orphanId].customer_count || 0;
          updateCenter(territories[foundTerritory]);
          assigned.add(orphanId);
        }
        break;
      }

      // Round-robin: chọn vùng có ÍT Ô NHẤT (không phải ít khách nhất)
      // Điều này đảm bảo các vùng phát triển đều đặn, tránh 1 vùng bò dài
      let tIdx = -1;
      let minUnits = Infinity;
      let bestNt = [];
      for (const { idx, candidates } of expandable) {
        if (territories[idx].units.length < minUnits) {
          minUnits = territories[idx].units.length;
          tIdx = idx;
          bestNt = candidates;
        }
      }

      let t = territories[tIdx];

      // Tính phi(j, t*) theo đúng paper BGRASP
      let phiVals = [];
      let phiMin = Infinity;
      let phiMax = -Infinity;

      for (const j of bestNt) {
        let u = unitMap[j];
        // Tính tâm ảo nếu thêm ô j vào vùng t
        let newCy =
          (t.center.cy * t.units.length + u.cy) / (t.units.length + 1);
        let newCx =
          (t.center.cx * t.units.length + u.cx) / (t.units.length + 1);
        let hypCenter = { cy: newCy, cx: newCx };

        // f_disp theo paper: (1/d_max) * Σ d_i(c_t)
        // Sum of distances (KHÔNG phải MSE) từ tất cả ô đến tâm mới
        let sumDist = getDistToCenter(j, hypCenter);
        for (const i of t.units) sumDist += getDistToCenter(i, hypCenter);
        let f_disp = maxDist > 0 ? sumDist / maxDist : 0;

        // f_dev theo paper: (1/μ) * |w(V_t ∪ {j}) - μ|
        let newCust = t.customers + (u.customer_count || 0);
        let f_dev = mu1 > 0 ? Math.abs(mu1 - newCust) / mu1 : 0;

        // phi(j, t*) = λ * f_disp + (1-λ) * f_dev
        let phi = lambda * f_disp + (1 - lambda) * f_dev;

        phiVals.push({ id: j, phi, hypCenter });
        if (phi < phiMin) phiMin = phi;
        if (phi > phiMax) phiMax = phi;
      }

      // Tạo RCL : chọn các ô có phi <= phiMin + alpha * (phiMax - phiMin)
      let threshold = phiMin + alpha * (phiMax - phiMin);
      let rcl = phiVals.filter((item) => item.phi <= threshold);
      let chosen = rcl[Math.floor(Math.random() * rcl.length)];

      t.units.push(chosen.id);
      t.customers += unitMap[chosen.id].customer_count || 0;
      t.center = chosen.hypCenter;
      assigned.add(chosen.id);
    }

    // --- POST-CONSTRUCTION: Sửa chữa tính liên thông ---
    // Kiểm tra mỗi vùng có liên thông không, nếu không thì chuyển các mảnh rời
    // sang vùng liền kề phù hợp nhất
    for (let repair = 0; repair < 5; repair++) {
      let hadRepair = false;
      for (let i = 0; i < p; i++) {
        const t = territories[i];
        if (t.units.length <= 1) continue;

        // Tìm các thành phần liên thông trong vùng
        const components = [];
        const visited = new Set();
        for (const startId of t.units) {
          if (visited.has(startId)) continue;
          const component = [];
          const q = [startId];
          visited.add(startId);
          while (q.length > 0) {
            const curr = q.shift();
            component.push(curr);
            for (const nb of adjList[curr]) {
              if (!visited.has(nb) && t.units.includes(nb)) {
                visited.add(nb);
                q.push(nb);
              }
            }
          }
          components.push(component);
        }

        if (components.length <= 1) continue; // Đã liên thông

        // Giữ thành phần lớn nhất, chuyển các mảnh nhỏ sang vùng khác
        components.sort((a, b) => b.length - a.length);
        const mainComponent = new Set(components[0]);

        for (let ci = 1; ci < components.length; ci++) {
          for (const orphanId of components[ci]) {
            // Tìm vùng liền kề tốt nhất cho orphan
            let bestTarget = -1;
            let bestDevImprovement = -Infinity;

            for (const nb of adjList[orphanId]) {
              for (let j = 0; j < p; j++) {
                if (j === i && mainComponent.has(nb)) {
                  bestTarget = i; // Có thể nối lại vào main component
                  break;
                }
                if (j !== i && territories[j].units.includes(nb)) {
                  // Tính xem chuyển sang j có tốt không
                  const uCust = unitMap[orphanId].customer_count || 0;
                  const oldDev = Math.abs(territories[j].customers - mu1);
                  const newDev = Math.abs(
                    territories[j].customers + uCust - mu1,
                  );
                  const improvement = oldDev - newDev;
                  if (improvement > bestDevImprovement) {
                    bestDevImprovement = improvement;
                    bestTarget = j;
                  }
                }
              }
              if (bestTarget === i) break; // Nối lại main component
            }

            if (bestTarget >= 0 && bestTarget !== i) {
              // Chuyển orphan sang vùng khác
              t.units = t.units.filter((id) => id !== orphanId);
              t.customers -= unitMap[orphanId].customer_count || 0;
              updateCenter(t);
              territories[bestTarget].units.push(orphanId);
              territories[bestTarget].customers +=
                unitMap[orphanId].customer_count || 0;
              updateCenter(territories[bestTarget]);
              hadRepair = true;
            }
          }
        }
      }
      if (!hadRepair) break;
    }

    // --- EVALUATE SOLUTION ---
    let totalFDisp = 0;
    let totalFDev = 0;
    for (let i = 0; i < p; i++) {
      let t = territories[i];
      for (const uid of t.units) {
        totalFDisp += getDistToCenter(uid, t.center);
      }
      totalFDev += mu1 > 0 ? (1 / mu1) * Math.abs(t.customers - mu1) : 0;
    }

    let rho =
      (units.length - p) * d_max > 0
        ? (2 * totalFDisp) / ((units.length - p) * d_max) + totalFDev / p
        : Infinity;

    if (rho < bestRho) {
      bestRho = rho;
      bestSolution = JSON.parse(JSON.stringify(territories)); // deep copy
    }

    reportProgress(
      iter,
      MAX_ITER,
      `Vòng lặp ${iter}/${MAX_ITER} (Rho tốt nhất: ${bestRho.toFixed(4)})`,
    );
    await new Promise((resolve) => setTimeout(resolve, 5)); // Yield to event loop
  }

  // --- PHASE 2: Tìm kiếm cục bộ (Relinked Local Search) ---
  reportProgress(MAX_ITER, MAX_ITER, `Bắt đầu Local Search...`);

  let improved = true;
  let lsMoves = 0;
  // Tạo lookup nhanh: unitId -> territoryIndex
  let assignMap = buildAssignmentMap(bestSolution);

  {
    improved = false;
    // Relinked Local Search: cycle giữa z1 (dispersion) và z2 (balance)
    let currentObjective = 0; // 0 = z1, 1 = z2
    let noImproveCycles = 0;

    while (lsMoves < 500 && noImproveCycles < 4) {
      improved = false;
      for (let i = 0; i < p; i++) {
        let t = bestSolution[i];
        for (let k = 0; k < t.units.length; k++) {
          let uid = t.units[k];

          // Tìm các vùng liền kề mà uid có thể chuyển sang (dùng assignMap)
          let neighborTerritories = new Set();
          for (const adjId of adjList[uid]) {
            const tj = assignMap[adjId];
            if (tj !== undefined && tj !== i) {
              neighborTerritories.add(tj);
            }
          }

          if (neighborTerritories.size > 0 && t.units.length > 1) {
            for (const j of neighborTerritories) {
              let t2 = bestSolution[j];

              let uCust = unitMap[uid].customer_count || 0;
              let t1NewUnits = t.units.filter((id) => id !== uid);
              let t2NewUnits = [...t2.units, uid];
              let t1NewCust = t.customers - uCust;
              let t2NewCust = t2.customers + uCust;

              let shouldMove = false;

              if (currentObjective === 0) {
                // z1: Tối ưu dispersion (compact) - tổng khoảng cách đến tâm phải giảm
                let oldZ1 = 0, newZ1 = 0;
                let oldCenter1 = t.center, oldCenter2 = t2.center;
                for (const id of t.units) oldZ1 += getDistToCenter(id, oldCenter1);
                for (const id of t2.units) oldZ1 += getDistToCenter(id, oldCenter2);

                // Tính tâm mới
                let nc1 = { cy: 0, cx: 0 }, nc2 = { cy: 0, cx: 0 };
                for (const id of t1NewUnits) { nc1.cy += unitMap[id].cy; nc1.cx += unitMap[id].cx; }
                if (t1NewUnits.length > 0) { nc1.cy /= t1NewUnits.length; nc1.cx /= t1NewUnits.length; }
                for (const id of t2NewUnits) { nc2.cy += unitMap[id].cy; nc2.cx += unitMap[id].cx; }
                nc2.cy /= t2NewUnits.length; nc2.cx /= t2NewUnits.length;

                for (const id of t1NewUnits) newZ1 += getDistToCenter(id, nc1);
                for (const id of t2NewUnits) newZ1 += getDistToCenter(id, nc2);

                shouldMove = newZ1 < oldZ1 * 0.995; // Cải thiện ít nhất 0.5%
              } else {
                // z2: Tối ưu balance - tổng deviation phải giảm
                let oldDev = Math.abs(t.customers - mu1) + Math.abs(t2.customers - mu1);
                let newDev = Math.abs(t1NewCust - mu1) + Math.abs(t2NewCust - mu1);
                shouldMove = newDev < oldDev * 0.99;
              }

              if (shouldMove) {
                // Kiểm tra vùng nguồn vẫn liên thông (dùng Set thay Array.includes)
                let isSourceConnected = true;
                if (t.units.length > 2) {
                  let remainSet = new Set(t1NewUnits);
                  let visited = new Set();
                  let q = [t1NewUnits[0]];
                  visited.add(t1NewUnits[0]);
                  while (q.length > 0) {
                    let curr = q.shift();
                    for (let n of adjList[curr]) {
                      if (remainSet.has(n) && !visited.has(n)) {
                        visited.add(n);
                        q.push(n);
                      }
                    }
                  }
                  if (visited.size !== t1NewUnits.length)
                    isSourceConnected = false;
                }

                if (isSourceConnected) {
                  t.units.splice(k, 1);
                  t.customers -= uCust;
                  t2.units.push(uid);
                  t2.customers += uCust;

                  updateCenter(t);
                  updateCenter(t2);

                  assignMap[uid] = j;
                  improved = true;
                  lsMoves++;
                  break;
                }
              }
            }
          }
          if (improved) break;
        }
        if (improved) break;
      }
      if (!improved) {
        noImproveCycles++;
        currentObjective = (currentObjective + 1) % 2; // Chuyển objective
      } else {
        noImproveCycles = 0;
      }
    }
  }

  // --- FINAL VALIDATION: Đảm bảo mỗi vùng liên thông ---
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
    for (let i = 0; i < p; i++) {
      // Đảm bảo các vùng có màu sắc khác biệt rõ rệt bằng cách chia đều dải màu (Hue)
      const hue = (i * 360) / p;
      const color = hslToHex(hue, 75, 55);
      let t = bestSolution[i];

      let totalOrders = 0;
      t.units.forEach((uid) => {
        totalOrders += unitMap[uid].order_count || 0;
      });

      summary.push({
        color: color,
        polygonCount: t.units.length,
        customerCount: t.customers,
        orderCount: totalOrders,
      });

      if (t.units.length > 0) {
        const ids = t.units.join(",");
        await client.query(
          `UPDATE basic_units SET color = $1 WHERE id IN (${ids})`,
          [color],
        );
      }
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
    bestRho: bestRho,
    localSearchMoves: lsMoves,
    contiguityVerified: contiguityOk,
    summary: summary, // Added summary data
    message: contiguityOk
      ? "Hoàn tất phân chia vùng BGRASP. Tất cả các vùng đều liên thông."
      : "Hoàn tất phân chia vùng BGRASP. CẢNH BÁO: Một số vùng có thể chưa hoàn toàn liên thông.",
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
    pool.end().catch(() => {});
  }
})();
