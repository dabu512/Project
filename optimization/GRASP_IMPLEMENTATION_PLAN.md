# GRASP Implementation Plan - Districting Problem

## I. TỔNG QUAN VỀ THUẬT TOÁN

Thuật toán GRASP có 2 biến thể:
- **BGRASP** (Bi-objective): Optimize 2 mục tiêu (compactness + balancing)
- **TGRASP** (Tri-objective): Optimize 3 mục tiêu (compactness + balancing + feasibility)

Cấu trúc chính: **Construction Phase → Local Search Phase → Filter & Select Best Solutions**

---

## II. MAPPING CÔNG THỨC → BIẾN CODE

### A. BIẾN ĐẦU VÀO (Input Parameters)

```
Parameters Group:
├─ maxIterations          : MAX_ITER (e.g., 2020)
├─ alphaRCL              : α (e.g., 0.04 or 0.05) - RCL quality parameter
├─ minNodeDegree         : min_degree (e.g., 3) - Minimum connectivity for seed selection
├─ maxLocalSearchMoves   : MAX_MOVES (e.g., 2000-3000) - Max moves in local search
├─ lambdaWeights         : [λ1, λ2, λ3] or [λ, 1-λ] - Objective weights
│  └─ BGRASP            : λ = weight for dispersion (0-1)
│  └─ TGRASP            : λ1 + λ2 + λ3 = 1
├─ toleranceLowerBound   : τ^(2) (e.g., 0.05 = 5%) - Sales volume tolerance
├─ filterTopSolutions    : 100 (or configurable) - Top solutions to apply local search
└─ maxBreakConnections   : For connectivity check
```

### B. BIẾN ĐẦU RA & TRẠNG THÁI (Output & State Variables)

```
Data Structure:
├─ Solution S
│  ├─ assignment[][]  : assignment[j] = t (unit j belongs to district t)
│  ├─ districts[]     : List of p districts
│  │  ├─ id
│  │  ├─ units[]      : Units in this district
│  │  ├─ w1           : Total customers (weight 1)
│  │  ├─ w2           : Total sales volume (weight 2)
│  │  ├─ centroid     : Geometric center
│  │  └─ connectivity : Is region connected?
│  └─ objectives[]    : [z1, z2, z3, z4] objective values
│
├─ distanceMatrix[][]   : d_ij - Euclidean/geodesic distance
├─ allSolutions[]      : Archive of solutions from construction phase
├─ paretoFront[]       : Non-dominated solutions for multi-objective
└─ bestSolution       : Final best solution after local search
```

### C. HẰNG SỐ & DERIVED CONSTANTS

```
Constants:
├─ V              : Set of all units (|V| = total units)
├─ T              : Set of all districts (|T| = p)
├─ d_max          : Max distance between any two units
├─ μ^(1)          : Average customers per district = (Σ w1) / p
├─ μ^(2)          : Average sales per district = (Σ w2) / p
├─ CapacityUpper^(2) : Upper bound for sales = (1 + τ^(2)) * μ^(2)
├─ CapacityLower^(2) : Lower bound for sales = (1 - τ^(2)) * μ^(2)
└─ N(t*)          : Neighbors of district t* (units adjacent but not yet assigned)
```

---

## III. CÔNG THỨC & BIẾN TƯƠNG ỨNG

### PHASE 1: CONSTRUCTION PHASE

#### **BGRASP - Hàm đánh giá giá trị (Cost Function for Assignment)**

**Công thức:**
$$\varphi(j, t^*) = \lambda f_{\text{disp}}(j, t^*) + (1 - \lambda) f_{\text{dev}}(j, t^*)$$

**Biến code:**
```javascript
// After assigning unit j to district t*
function computeCostBGRASP(unitJ, districtT, distanceMatrix, mu1) {
  const fDisp = computeDispersion(unitJ, districtT, distanceMatrix);      // f_disp(j,t*)
  const fDev = computeDeviation(unitJ, districtT, mu1);                   // f_dev(j,t*)
  const lambda = parameters.lambdaDispersion;                             // λ ∈ (0,1)
  
  return lambda * fDisp + (1 - lambda) * fDev;
}

// Dispersion cost - normalized sum of distances from units in district to its centroid
function computeDispersion(unitJ, districtT, distanceMatrix, dMax) {
  // f_disp(j,t*) = (1 / d_max) * ∑_{i ∈ V_{t*} ∪ {j}} d_i(c_{t*})
  // V_{t*} = current units in district T
  // c_{t*} = centroid of district T
  // d_i(c_{t*}) = distance from unit i to centroid c
  
  let sumDistances = 0;
  const unitsInDistrict = districtT.units.concat([unitJ]);
  const centroid = computeCentroid(unitsInDistrict);
  
  for (let unit of unitsInDistrict) {
    sumDistances += distanceMatrix[unit.id][centroid];
  }
  
  return sumDistances / dMax;
}

// Deviation cost - how far is the new total weight from target average
function computeDeviation(unitJ, districtT, mu1) {
  // f_dev(j,t*) = (1 / μ^(1)) * max{ |w^(1)(V_{t*} ∪ {j}) - μ^(1)|, ... }
  // w^(1)(V_{t*} ∪ {j}) = total customers if unit j is added
  
  const newWeight1 = districtT.w1 + unitJ.customerCount;
  const deviation = Math.abs(newWeight1 - mu1);
  
  return deviation / mu1;
}
```

---

#### **TGRASP - Mở rộng với Infeasibility Cost**

**Công thức:**
$$\gamma(j, t) = \lambda_1 f_{\text{disp}}(j,t) + \lambda_2 f_{\text{dev}}(j,t) + \lambda_3 f_{\text{infeas}}(j,t)$$

**Biến code:**
```javascript
function computeCostTGRASP(unitJ, districtT, distanceMatrix, mu1, mu2, tau2, dMax) {
  const fDisp = computeDispersion(unitJ, districtT, distanceMatrix, dMax);
  const fDev = computeDeviation(unitJ, districtT, mu1);
  const fInfeas = computeInfeasibility(unitJ, districtT, mu2, tau2);
  
  const [lambda1, lambda2, lambda3] = parameters.lambdaWeights;  // λ1, λ2, λ3
  // Ensure lambda1 + lambda2 + lambda3 = 1
  
  return lambda1 * fDisp + lambda2 * fDev + lambda3 * fInfeas;
}

// Infeasibility cost - penalty if exceeds sales capacity
function computeInfeasibility(unitJ, districtT, mu2, tau2) {
  // f_infeas(j,t) = (1 / μ^(2)) * max{ w^(2)(V_t ∪ {j}) - (1 + τ^(2)) μ^(2), 0 }
  // τ^(2) = tolerance (e.g., 0.05)
  // μ^(2) = average sales volume per district
  
  const newWeight2 = districtT.w2 + unitJ.salesVolume;
  const capacityUpper = (1 + tau2) * mu2;
  const excess = Math.max(newWeight2 - capacityUpper, 0);
  
  return excess / mu2;
}
```

---

#### **Tạo Danh Sách Ứng Viên (RCL - Restricted Candidate List)**

**Công thức:**
$$\text{RCL} = \{ j \in N(t^*) : \varphi(j, t^*) \in [\varphi_{\min}, \varphi_{\min} + \alpha(\varphi_{\max} - \varphi_{\min})] \}$$

**Biến code:**
```javascript
function buildRCL(districtT, neighbors, costArray, alpha) {
  // neighbors = N(t*) = units available to assign to district T
  // costArray = [φ(j, t*) for each j in neighbors]
  // alpha = α parameter (e.g., 0.04)
  
  const costMin = Math.min(...costArray);
  const costMax = Math.max(...costArray);
  const threshold = costMin + alpha * (costMax - costMin);
  
  const RCL = [];
  for (let i = 0; i < neighbors.length; i++) {
    if (costArray[i] <= threshold) {
      RCL.push(neighbors[i]);
    }
  }
  
  return RCL;  // List of candidate units to pick randomly from
}
```

---

#### **Lựa chọn Seed (Hạt giống)**

**Mục đích:** Chọn một unit có độ kết nối cao làm tâm cho district đầu tiên

**Biến code:**
```javascript
function selectSeed(allUnits, adjacencyGraph, minDegree) {
  // Find unit with high connectivity (degree >= minDegree)
  // and minimum dispersion
  
  let bestSeed = null;
  let minDispersion = Infinity;
  
  for (let unit of allUnits) {
    const degree = adjacencyGraph[unit.id].length;
    
    if (degree >= minDegree) {  // min_degree check
      // Prefer units with low dispersion
      const dispersion = computeUnitDispersion(unit, allUnits);
      
      if (dispersion < minDispersion) {
        minDispersion = dispersion;
        bestSeed = unit;
      }
    }
  }
  
  return bestSeed;
}
```

---

#### **Pha Xây dựng - Pseudocode Structure**

```javascript
// Construction Phase Main Loop
function constructionPhase() {
  const solutions = [];
  
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // 1. Initialize empty districts
    const districts = initializeEmptyDistricts(p);
    
    // 2. Select seeds for each district (in order)
    const seeds = [];
    const unassignedUnits = new Set(V);
    
    for (let t = 0; t < p; t++) {
      const seed = selectSeed(unassignedUnits, adjacencyGraph, minDegree);
      assignUnitToDistrict(seed, districts[t]);
      unassignedUnits.delete(seed);
      seeds.push(seed);
    }
    
    // 3. Greedily assign remaining units
    while (unassignedUnits.size > 0) {
      // Select district with smallest demand (w1)
      const targetDistrict = districts.reduce((prev, curr) => 
        curr.w1 < prev.w1 ? curr : prev
      );
      
      // Get neighbors of targetDistrict not yet assigned
      const candidates = getUnassignedNeighbors(targetDistrict, unassignedUnits);
      
      if (candidates.length === 0) {
        // No neighbors - pick any unassigned unit
        // (violated connectivity constraint if BGRASP-II)
      }
      
      // Compute costs for all candidates
      const costArray = candidates.map(j => 
        computeCost(j, targetDistrict, distanceMatrix, mu1, mu2, tau2, dMax)
      );
      
      // Build RCL with alpha parameter
      const RCL = buildRCL(targetDistrict, candidates, costArray, alpha);
      
      // Randomly select from RCL
      const selectedUnit = RCL[Math.floor(Math.random() * RCL.length)];
      assignUnitToDistrict(selectedUnit, targetDistrict);
      unassignedUnits.delete(selectedUnit);
    }
    
    // 4. Evaluate solution
    const solution = {
      assignment: districts,
      objectives: computeObjectives(districts)  // [z1, z2, z3, z4]
    };
    
    solutions.push(solution);
  }
  
  return solutions;
}
```

---

### PHASE 2: FILTERING & EVALUATION

#### **Hàm Đánh giá (Solution Quality Filter)**

**Công thức:**
$$\rho(S) = \frac{2 f_{\text{disp}}(S)}{(|V| - p) d_{\max}} + \frac{f_{\text{Tdev}}^{(1)}}{p}$$

**Biến code:**
```javascript
function evaluateSolutionQuality(solution, distanceMatrix, dMax) {
  // fDisp(S) = sum of all unit-to-centroid distances across all districts
  let fDispTotal = 0;
  for (let district of solution.districts) {
    const centroid = district.centroid;
    for (let unit of district.units) {
      fDispTotal += distanceMatrix[unit.id][centroid];
    }
  }
  
  // fTdev^(1) = sum of deviations in customers across districts
  let fTdevTotal = 0;
  const mu1 = computeAverageCustomers(solution);
  for (let district of solution.districts) {
    const deviation = Math.abs(district.w1 - mu1);
    fTdevTotal += deviation;
  }
  
  // Apply filtering formula
  const rho = (2 * fDispTotal) / ((V.length - p) * dMax) + (fTdevTotal / p);
  
  return rho;
}

function filterTopSolutions(allSolutions, topK) {
  // Evaluate all solutions and keep top K
  const evaluated = allSolutions.map(sol => ({
    solution: sol,
    quality: evaluateSolutionQuality(sol, distanceMatrix, dMax)
  }));
  
  evaluated.sort((a, b) => a.quality - b.quality);
  
  return evaluated.slice(0, topK).map(e => e.solution);
}
```

---

### PHASE 3: LOCAL SEARCH (Post-processing)

#### **Hàm Mục tiêu (Multi-objective Functions)**

**Công thức:**
$$z_1 = \sum_{t \in T} \sum_{j \in V_t} d_{j c(t)}$$
$$z_2 = \frac{1}{\mu^{(1)}} \max_{t \in T} \{|w^{(1)}(V_t) - \mu^{(1)}|\}$$
$$z_3 = \frac{1}{\mu^{(2)}} \sum_{t \in T} [\max(w^{(2)}(V_t) - (1+\tau^{(2)})\mu^{(2)}, 0) + \max((1-\tau^{(2)})\mu^{(2)} - w^{(2)}(V_t), 0)]$$
$$z_4 = \sum_{t \in T} |\eta(V_t)|$$

**Biến code:**
```javascript
// z1: Total dispersion (sum of distances)
function computeZ1_Dispersion(solution, distanceMatrix) {
  let z1 = 0;
  for (let district of solution.districts) {
    const centroid = district.centroid;
    for (let unit of district.units) {
      z1 += distanceMatrix[unit.id][centroid];
    }
  }
  return z1;
}

// z2: Max deviation in customers (balance metric)
function computeZ2_BalanceCustomers(solution) {
  const mu1 = computeAverageCustomers(solution);
  let z2_max = 0;
  
  for (let district of solution.districts) {
    const deviation = Math.abs(district.w1 - mu1);
    z2_max = Math.max(z2_max, deviation);
  }
  
  return z2_max / mu1;
}

// z3: Sales volume feasibility penalty
function computeZ3_FeasibilitySales(solution, mu2, tau2) {
  const capacityUpper = (1 + tau2) * mu2;
  const capacityLower = (1 - tau2) * mu2;
  let z3 = 0;
  
  for (let district of solution.districts) {
    const excessUpper = Math.max(district.w2 - capacityUpper, 0);
    const excessLower = Math.max(capacityLower - district.w2, 0);
    z3 += excessUpper + excessLower;
  }
  
  return z3 / mu2;
}

// z4: Number of disconnected components (connectivity penalty)
function computeZ4_Connectivity(solution, adjacencyGraph) {
  let z4 = 0;
  
  for (let district of solution.districts) {
    const componentCount = countConnectedComponents(district.units, adjacencyGraph);
    z4 += componentCount - 1;  // -1 because 1 connected component = 0 penalty
  }
  
  return z4;
}

// Aggregate objectives
function computeAllObjectives(solution, distanceMatrix, mu1, mu2, tau2, dMax) {
  return {
    z1: computeZ1_Dispersion(solution, distanceMatrix),
    z2: computeZ2_BalanceCustomers(solution),
    z3: computeZ3_FeasibilitySales(solution, mu2, tau2),
    z4: computeZ4_Connectivity(solution, adjacencyGraph)
  };
}
```

---

#### **Tìm kiếm Cục bộ (Local Search - Relinked Strategy)**

**Mục đích:** Cải thiện giải pháp bằng cách di chuyển units giữa các districts

**Biến code:**
```javascript
function localSearchRelinked(solution, maxMoves, distanceMatrix, mu1, mu2, tau2) {
  // Relinked LS: Optimize z1 → z2 → z3 → z4 → back to z1 cyclically
  // (Avoid cycling in multi-objective space)
  
  let currentSolution = JSON.parse(JSON.stringify(solution));  // Deep copy
  const objectives = ['z1', 'z2', 'z3', 'z4'];
  let objectiveIndex = 0;
  let movesCount = 0;
  let improved = true;
  
  while (movesCount < maxMoves && improved) {
    improved = false;
    const currentObjective = objectives[objectiveIndex];
    
    // Try all possible moves (unit j from district t to district t')
    for (let district_t of currentSolution.districts) {
      for (let unit of [...district_t.units]) {  // Copy array to allow modification
        for (let district_t_prime of currentSolution.districts) {
          if (district_t === district_t_prime) continue;
          
          // Try moving unit from district_t to district_t_prime
          const beforeObjective = computeAllObjectives(
            currentSolution, distanceMatrix, mu1, mu2, tau2
          )[currentObjective];
          
          // Tentative move
          moveUnit(unit, district_t, district_t_prime);
          
          const afterObjective = computeAllObjectives(
            currentSolution, distanceMatrix, mu1, mu2, tau2
          )[currentObjective];
          
          if (afterObjective < beforeObjective) {
            // Move improves current objective - keep it
            improved = true;
            movesCount++;
            break;  // Move to next objective
          } else {
            // Revert move
            moveUnit(unit, district_t_prime, district_t);
          }
        }
        
        if (improved) break;
      }
      
      if (improved) break;
    }
    
    // Cycle to next objective
    objectiveIndex = (objectiveIndex + 1) % objectives.length;
  }
  
  return currentSolution;
}

function moveUnit(unit, fromDistrict, toDistrict) {
  const idx = fromDistrict.units.indexOf(unit);
  if (idx > -1) {
    fromDistrict.units.splice(idx, 1);
    fromDistrict.w1 -= unit.customerCount;
    fromDistrict.w2 -= unit.salesVolume;
  }
  
  toDistrict.units.push(unit);
  toDistrict.w1 += unit.customerCount;
  toDistrict.w2 += unit.salesVolume;
  
  // Update centroids
  fromDistrict.centroid = computeCentroid(fromDistrict.units);
  toDistrict.centroid = computeCentroid(toDistrict.units);
}
```

---

## IV. CẤU TRÚC THẬP LỜI TOÀN BỘ (Overall Algorithm Structure)

```javascript
class GRASPSolver {
  
  constructor(parameters) {
    this.parameters = {
      maxIterations: 2020,
      alpha: 0.04,
      minNodeDegree: 3,
      maxLocalSearchMoves: 2000,
      lambdaWeights: [0.33, 0.33, 0.33],  // [λ1, λ2, λ3] for TGRASP
      toleranceSales: 0.05,               // τ^(2)
      filterTopSolutions: 100
    };
    
    // Merge with provided parameters
    Object.assign(this.parameters, parameters);
  }
  
  // Main entry point
  solve(units, districts_count, distanceMatrix, adjacencyGraph) {
    // 1. Pre-compute constants
    const V = units;
    const p = districts_count;
    const d_max = this.computeMaxDistance(distanceMatrix);
    const mu1 = this.computeAverageCost(V, 'customerCount') / p;
    const mu2 = this.computeAverageCost(V, 'salesVolume') / p;
    
    // 2. Construction Phase
    const allSolutions = this.constructionPhase(V, p, distanceMatrix, mu1, mu2, d_max);
    
    // 3. Filtering
    const topSolutions = this.filterTopSolutions(allSolutions, this.parameters.filterTopSolutions);
    
    // 4. Local Search on filtered solutions
    const improvedSolutions = topSolutions.map(sol => 
      this.localSearchRelinked(sol, this.parameters.maxLocalSearchMoves, distanceMatrix, mu1, mu2)
    );
    
    // 5. Select best solution (by Pareto dominance or aggregated metric)
    const bestSolution = this.selectBestSolution(improvedSolutions);
    
    return bestSolution;
  }
  
  constructionPhase(V, p, distanceMatrix, mu1, mu2, d_max) {
    // [Implementation as per pseudocode above]
  }
  
  filterTopSolutions(solutions, topK) {
    // [Implementation as per filtering function above]
  }
  
  localSearchRelinked(solution, maxMoves, distanceMatrix, mu1, mu2) {
    // [Implementation as per local search function above]
  }
  
  selectBestSolution(solutions) {
    // Select by:
    // - Lexicographic ordering of objectives
    // - Or Pareto front
    // - Or aggregated scalarization
  }
}
```

---

## V. INPUT DATA STRUCTURES (From Database)

```javascript
// From PostGIS DB:
const unit = {
  id: 1,
  name: "BU_001",
  geom: { type: 'Polygon', coordinates: [...] },  // PostGIS geometry
  centroid: { type: 'Point', coordinates: [lng, lat] },
  customerCount: 50,              // w^(1)
  salesVolume: 1500,              // w^(2)
  area_km2: 2.5,
  color: "#FF0000"
};

const district = {
  id: 1,
  name: "District_1",
  units: [unit, ...],
  w1: 0,      // Total customers (accumulate)
  w2: 0,      // Total sales (accumulate)
  centroid: { lat, lng },
  color: "#0000FF"
};
```

---

## VI. DEPENDENCY & UTILITY FUNCTIONS CHECKLIST

Các hàm phụ trợ cần implement trước khi code GRASP chính:

- [ ] `computeDistanceMatrix(units)` - Euclidean / Geodesic distances
- [ ] `computeCentroid(units)` - Geometric center of units
- [ ] `buildAdjacencyGraph(units)` - Neighbor relationships (spatial)
- [ ] `getUnassignedNeighbors(district, unassignedUnits)` - Get candidates
- [ ] `countConnectedComponents(units, adjacencyGraph)` - Check connectivity
- [ ] `assignUnitToDistrict(unit, district)` - Update district state
- [ ] `computeAverageCost(units, attribute)` - μ^(1) or μ^(2)
- [ ] `computeMaxDistance(distanceMatrix)` - d_max
- [ ] `moveUnit(unit, fromDistrict, toDistrict)` - Local search move
- [ ] `computeAllObjectives(solution, ...)` - Calculate [z1, z2, z3, z4]

---

## VII. FILE STRUCTURE PLAN

```
optimization/
├── config/
│   └── grasp_parameters.js         # Default params
├── core/
│   ├── grasp_solver.js             # Main GRASP class
│   ├── construction_phase.js        # Construction logic
│   ├── local_search.js             # Local search logic
│   └── filtering.js                # Solution filtering
├── utils/
│   ├── distance_calculator.js      # Distance matrices
│   ├── geometry_utils.js           # Centroid, connectivity
│   ├── objectives.js               # z1, z2, z3, z4 computations
│   └── data_converter.js           # DB data → algorithm input
├── models/
│   ├── solution.js                 # Solution class
│   ├── district.js                 # District class
│   └── unit.js                     # Unit class
├── routes/
│   └── optimization_api.js         # REST API endpoints
└── tests/
    ├── unit_tests.js
    ├── integration_tests.js
    └── sample_data.js
```

---

## VIII. EXTERNAL LIBRARIES & SETUP

**JavaScript/Node.js:**
- `turf.js` - Geospatial calculations (distance, centroid)
- `pg` - PostgreSQL connection (already have)
- `lodash` - Utility functions (sorting, grouping)
- `winston` - Logging

**Python (optional, for heavy computation):**
- `numpy` - Numeric operations
- `scipy.spatial` - Distance matrices
- `shapely` - Geometry operations

---

## IX. INITIALIZATION SEQUENCE

```
Step 1: Load configuration
  → Load parameters from config/grasp_parameters.js

Step 2: Data acquisition
  → Query database for units, districts, drivers
  → Validate data integrity

Step 3: Pre-computation (one-time, expensive)
  → Build distance matrix (|V| x |V|)
  → Build adjacency graph (spatial neighbors)
  → Compute d_max, μ^(1), μ^(2)

Step 4: Create GRASP solver instance
  → Initialize GRASPSolver with parameters

Step 5: Execute GRASP
  → Run solve() method
  → Monitor progress (iterations, improvements)

Step 6: Post-processing & storage
  → Validate solution feasibility
  → Store results in database
  → Return to API client
```

---

## X. TESTING STRATEGY (Chưa implement)

```javascript
// Unit Tests:
- Test computeDispersion() with sample districts
- Test buildRCL() threshold logic
- Test moveUnit() state consistency
- Test objective functions output ranges

// Integration Tests:
- 10 units, 2 districts
- 100 units, 5 districts
- 1000 units, 50 districts

// Validation:
- Check all units assigned (|V| = p * Σ|V_t|)
- Check feasibility constraints
- Verify objective function values
```

---

## XI. PERFORMANCE TARGETS

```
Expected performance (based on research paper):
- Execution time for 1000 units, 50 districts:
  → Construction Phase: ~30 seconds
  → Local Search Phase: ~5 seconds per solution
  → Total (2020 iterations, filter 100, LS on 100): ~10-15 minutes

Scalability:
- Small (100 units, 5 districts): <1 minute
- Medium (500 units, 20 districts): 2-5 minutes
- Large (1000 units, 50 districts): 10-30 minutes
```

---

