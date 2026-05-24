# GRASP Implementation - QUICK START GUIDE

## 📋 Tóm Tắt (TL;DR)

**Bạn cần chuẩn bị những gì trước khi code:**

1. ✓ **Hiểu rõ toán học** (công thức φ, γ, ρ, z1-z4)
2. ✓ **Chọn thuật toán** (BGRASP hay TGRASP? Hard hay Soft connectivity?)
3. ✓ **Chuẩn bị dữ liệu** (verify từ DB, validate integrity)
4. ✓ **Xây dựng utilities** (distance matrix, adjacency graph, đặc biệt)
5. ✓ **Tính toán hằng số** (d_max, μ^(1), μ^(2), bounds)
6. ✓ **Thiết lập framework** (folder structure, configs, classes)
7. ✓ **Kiểm tra nhỏ trước** (test trên 10 units trước khi scale up)

---

## 📁 Tài Liệu Đã Chuẩn Bị

```
optimization/
├── GRASP_IMPLEMENTATION_PLAN.md       ← Kế hoạch tổng thể & architecture
├── DATA_STRUCTURES_CONFIG.md           ← Cấu trúc dữ liệu, config, validation
├── FORMULAS_AND_UTILITIES.md           ← Công thức chi tiết + hàm utils checklist
├── STRATEGIC_CHOICES.md                ← Quyết định thiết kế (BGRASP vs TGRASP, etc.)
└── QUICK_START_GUIDE.md               ← File này
```

**Đọc theo thứ tự:** 1 → 2 → 3 → 4 → 5 (cái này)

---

## 🎯 IMMEDIATE ACTION ITEMS (Tuần 1)

### Task 1: Decision Making (1-2 ngày)

```
[ ] Quyết định: BGRASP hay TGRASP?
    └─ Recommendation: BGRASP đầu tiên (simpler)
    
[ ] Quyết định: Hard connectivity (Strategy I) hay Soft (Strategy II)?
    └─ Recommendation: Strategy II đầu tiên (more flexible)
    
[ ] Xác nhận tham số ban đầu
    ├─ maxIterations: 2020
    ├─ alphaRCL: 0.04
    ├─ toleranceSales: 0.05
    ├─ filterTopSolutions: 100
    └─ maxLocalSearchMoves: 2000
```

**Output:** Ghi vào file `optimization/config/grasp_parameters.js`

---

### Task 2: Data Preparation (2-3 ngày)

```
[ ] Query DB để lấy units
    └─ SQL: SELECT * FROM basic_units WHERE version_id = ?
    
[ ] Validate data integrity
    ├─ Check: No missing centroids
    ├─ Check: Valid customer_count & sales_volume
    ├─ Check: Geom không NULL
    └─ Fix: All issues trước khi proceed
    
[ ] Build distance matrix
    └─ Calculate Euclidean distances từ centroids
    └─ Store hoặc cache (sẽ dùng nhiều)
    
[ ] Build adjacency graph
    └─ Units are neighbors if distance ≤ threshold (e.g., 1-2 km)
    └─ Store as {unitId → [neighborIds]}
    
[ ] Pre-compute constants
    ├─ d_max = max distance among all pairs
    ├─ mu1 = total_customers / num_districts
    ├─ mu2 = total_sales / num_districts
    ├─ capacity_upper = (1 + tau2) * mu2
    └─ capacity_lower = (1 - tau2) * mu2
```

**Output:** Create `optimization/utils/data_converter.js` & `preprocessing.js`

---

### Task 3: Framework Setup (2-3 ngày)

```
[ ] Create folder structure
    ├─ mkdir optimization/{config,core,utils,models,routes,tests}
    
[ ] Define data models
    ├─ optimization/models/unit.js (Unit class)
    ├─ optimization/models/district.js (District class)
    ├─ optimization/models/solution.js (Solution class)
    
[ ] Create config
    └─ optimization/config/grasp_parameters.js (default params)
    
[ ] Implement utility functions (Phase 0)
    ├─ optimization/utils/distance_calculator.js
    │  ├─ computeDistanceMatrix()
    │  ├─ computeMaxDistance()
    │  └─ computeDistanceToCentroid()
    │
    ├─ optimization/utils/geometry_utils.js
    │  ├─ computeCentroid()
    │  ├─ buildAdjacencyGraph()
    │  └─ getUnassignedNeighbors()
    │
    └─ optimization/utils/data_converter.js
       ├─ loadFromDatabase()
       ├─ validateDataIntegrity()
       └─ sanitizeUnits()
```

**Output:** All utility functions implemented & tested on small data

---

### Task 4: Testing Setup (1-2 ngày)

```
[ ] Create test data
    └─ optimization/tests/sample_data.js
       ├─ SAMPLE_10_UNITS (for unit tests)
       ├─ SAMPLE_100_UNITS (for integration)
       └─ Document expected outputs
       
[ ] Write basic tests
    ├─ Test distance calculations (correctness)
    ├─ Test adjacency graph (connectivity)
    ├─ Test data validation (edge cases)
    └─ Verify: All tests pass before Phase 1
```

**Output:** Test suite ready, all utilities passing tests

---

## 🚀 PHASE 1: CONSTRUCTION PHASE (Tuần 2-3)

### Setup

```
[ ] Create: optimization/core/grasp_solver.js (main class)
[ ] Create: optimization/core/construction_phase.js
[ ] Create: optimization/core/solver_state.js (state management)
```

### Implementation Checklist

```
[ ] Method: GRASPState.initialize()
    └─ Load units, compute constants, setup initial state
    
[ ] Method: computeDispersion(unit, district)
    ├─ Formula: (1 / d_max) * Σ d_i(c_t)
    └─ Test: Verify normalization (result in [0,1])
    
[ ] Method: computeDeviation(unit, district, mu1)
    ├─ Formula: (1 / μ^(1)) * max{ |w1_new - μ^(1)|, 0 }
    └─ Test: Verify computation with known values
    
[ ] Method: computeCostBGRASP(unit, district, lambda)
    ├─ Formula: λ * fDisp + (1-λ) * fDev
    └─ Test: Different lambdas produce different costs
    
[ ] Method: buildRCL(candidates, costArray, alpha)
    ├─ Formula: RCL = {j : cost_j ≤ φ_min + α(φ_max - φ_min)}
    ├─ Test: RCL size varies with alpha
    └─ Edge case: Handle ties in costs
    
[ ] Method: selectSeed(units, adjacencyGraph, minDegree)
    ├─ Select high-degree, low-dispersion unit
    └─ Test: Different seeds selected on different runs
    
[ ] Method: constructionPhase()
    ├─ Main loop:
    │  1. For iter = 1 to maxIterations:
    │     a. Initialize p empty districts
    │     b. Select p seeds
    │     c. For each remaining unit:
    │        - Find target district (smallest w1)
    │        - Get candidates N(t*)
    │        - Compute costs
    │        - Build RCL
    │        - Select randomly from RCL
    │        - Assign unit to district
    │     d. Store solution
    │
    └─ Output: solutions[] with all 2020 solutions
    
[ ] Testing Phase 1
    ├─ Test on 10 units, 2 districts
    │  └─ Verify: all units assigned, costs make sense
    │
    ├─ Test on 50 units, 3 districts
    │  └─ Verify: solutions diverse (not all identical)
    │
    └─ Profile: time per iteration (should be < 1 second for small data)
```

**Success Criteria:**
- All 2020 solutions generated without error
- Every unit in exactly one district
- Cost values are positive and normalized
- No units left unassigned

---

## ⚖️ PHASE 2: FILTERING & EVALUATION (Tuần 3-4)

### Implementation Checklist

```
[ ] Method: computeZ1_Dispersion(solution)
    ├─ Formula: Σ_t Σ_j d_j(c_t)
    └─ Test: Value makes sense compared to d_max
    
[ ] Method: evaluateSolutionQuality(solution) returns ρ(S)
    ├─ Formula: (2 * fDisp) / ((|V| - p) * d_max) + (fTdev / p)
    └─ Test: Lower score = better solution
    
[ ] Method: filterTopSolutions(allSolutions, K=100)
    ├─ Evaluate all 2020 solutions
    ├─ Sort by ρ(S) ascending
    ├─ Return top 100
    └─ Test: Top solutions have lower ρ than bottom
    
[ ] Testing Phase 2
    ├─ After construction, verify:
    │  └─ ρ(S) values sorted correctly
    │
    ├─ Verify top 100 < bottom 1920
    │  └─ Check: ρ(100) < ρ(101)
    │
    └─ Profile: time to evaluate & sort (should be < 5 seconds)
```

**Success Criteria:**
- All solutions evaluated
- Top 100 solutions selected
- ρ(S) scores monotonically increasing from top to bottom

---

## 🔄 PHASE 3: LOCAL SEARCH (Tuần 4-5)

### Implementation Checklist

```
[ ] Method: computeZ2_BalanceCustomers(solution)
    ├─ Formula: (1/μ^1) * max_t |w1(V_t) - μ^1|
    └─ Test: Balanced solution has low z2
    
[ ] Method: computeZ3_FeasibilitySales(solution)
    ├─ Formula: (1/μ^2) * Σ_t [upper_excess + lower_excess]
    └─ Test: Feasible solution has z3 ≈ 0
    
[ ] Method: computeZ4_Connectivity(solution)
    ├─ Formula: Σ_t (components_t - 1)
    └─ Test: Connected solution has z4 = 0
    
[ ] Method: moveUnit(unit, fromDistrict, toDistrict)
    ├─ Remove unit from fromDistrict
    ├─ Add unit to toDistrict
    ├─ Update centroids & weights
    └─ Test: State consistency after move
    
[ ] Method: localSearchRelinked(solution)
    ├─ Cycle: z1 → z2 → z3 → z4 → z1 ...
    ├─ For each objective:
    │  └─ Try all possible moves
    │  └─ Accept first that improves objective
    │  └─ Stop after maxMoves
    │
    └─ Output: Improved solution
    
[ ] Testing Phase 3
    ├─ On filtered 100 solutions:
    │  └─ Apply local search
    │  └─ Verify at least some improve
    │
    ├─ Check objective values:
    │  ├─ z1: should decrease or stay same
    │  ├─ z2: should decrease or stay same
    │  ├─ z3: should decrease or stay same
    │  └─ z4: should decrease or stay same
    │
    └─ Profile: time per solution (< 10 seconds typical)
```

**Success Criteria:**
- Objectives compute without error
- Moves improve objectives
- Local search completes within time budget
- Solution quality improves after LS vs before LS

---

## 🔗 PHASE 4: INTEGRATION (Tuần 5-6)

### Implementation Checklist

```
[ ] Create main GRASPSolver class
    ├─ solve(units, numDistricts) method
    ├─ Orchestrate all phases
    └─ Return best solution
    
[ ] Add database integration
    ├─ optimization/utils/db_connector.js
    ├─ loadUnitsFromDB(pool, versionId)
    └─ saveSolutionToDB(pool, versionId, solution)
    
[ ] Create API endpoint
    ├─ optimization/routes/optimization_api.js
    ├─ POST /api/optimize with versionId, parameters
    ├─ GET /api/optimize/:jobId/status
    ├─ GET /api/optimize/:jobId/result
    └─ Integrate with server.js
    
[ ] Add monitoring
    ├─ Progress tracking (iterations, phase timing)
    ├─ Performance metrics (time, memory)
    └─ Logging (debug info)
    
[ ] Testing Phase 4
    ├─ End-to-end test
    ├─ API request → DB load → GRASP run → DB save
    └─ Verify result in DB matches returned result
```

**Success Criteria:**
- API endpoint callable
- Results saved & retrieved from DB
- No database errors
- Results persisted correctly

---

## 📊 PHASE 5: VALIDATION & OPTIMIZATION (Tuần 6-7)

### Implementation Checklist

```
[ ] Correctness validation
    ├─ All units assigned (count check)
    ├─ No duplicates (unit appears once)
    ├─ Total load = sum of unit loads
    └─ Create: validation/solution_validator.js
    
[ ] Feasibility validation
    ├─ If TGRASP: capacity constraints satisfied
    ├─ If Strategy I: connectivity verified
    └─ Report violations clearly
    
[ ] Performance tuning
    ├─ Profile each phase (which is slowest?)
    ├─ Optimize bottlenecks
    │  ├─ Cache distances
    │  ├─ Vectorize operations
    │  └─ Consider parallel processing
    └─ Benchmark vs target (should meet time goals)
    
[ ] Parameter sensitivity
    ├─ Try alpha: 0.01, 0.04, 0.10
    ├─ Try lambda: 0.3, 0.5, 0.7
    ├─ Try iterations: 1000, 2020, 5000
    └─ Generate tuning report
    
[ ] Scale testing
    ├─ 100 units: should be ~1-5 sec
    ├─ 500 units: should be ~5-15 sec
    ├─ 1000 units: should be ~15-60 sec
    └─ Document findings
```

**Success Criteria:**
- All solutions feasible
- No constraint violations
- Execution time within budget
- Consistent results across runs
- Scalable to 1000+ units

---

## 🎓 LEARNING RESOURCES

### Must Read (in order)

1. **This repository's docs:**
   - GRASP_IMPLEMENTATION_PLAN.md
   - DATA_STRUCTURES_CONFIG.md
   - FORMULAS_AND_UTILITIES.md
   - STRATEGIC_CHOICES.md

2. **Research papers:**
   - Resende & Ribeiro: "GRASP with Path-Relinking: Recent Advances and Applications" (2010)
   - Duarte et al.: "A hybrid approach for the Multiobjective Districting Problem" (or similar)
   - Your dissertation/paper source

3. **Code examples:**
   - Search "GRASP algorithm implementation" on GitHub
   - Look for Python implementations (easier to understand)
   - Translate logic to JavaScript

---

## ❓ FAQ - COMMON QUESTIONS

### Q1: Should I implement BGRASP or TGRASP first?

**A:** Start with **BGRASP**. It has 2 objectives instead of 3, simpler to debug.
Once BGRASP works, extending to TGRASP is straightforward (just add z3 calculation).

---

### Q2: Hard connectivity (Strategy I) or Soft (Strategy II)?

**A:** Start with **Strategy II** (soft, penalty-based).
- Easier to implement (no special RCL logic)
- Larger search space
- Can always switch later if needed

---

### Q3: How long should one iteration take?

**A:** Depends on dataset size:
- 50 units: ~50-100ms
- 100 units: ~100-300ms
- 500 units: ~1-2 seconds
- 1000 units: ~5-10 seconds

If slower, check:
1. Distance calculations (expensive)
2. RCL building (might be computing too many costs)
3. Centroid updates (can be cached)

---

### Q4: Solution quality is bad - what to do?

**A:** Try in order:
1. Increase alpha (0.04 → 0.10) for more diversity
2. Increase maxLocalSearchMoves (2000 → 5000)
3. Increase maxIterations (2020 → 5000)
4. Adjust lambda weights (if BGRASP, try different λ)
5. Check data - maybe units are poorly distributed?

---

### Q5: Solutions are disconnected (z4 > 0) - acceptable?

**A:** Depends on business requirement:
- If using Strategy II: expected, post-process to fix
- If using Strategy I: shouldn't happen (algorithm enforces connectivity)

To fix: Increase weight on z4 in local search, or increase distanceThreshold in adjacency graph.

---

### Q6: Can I parallelize this?

**A:** Yes, partially:
- Construction phase: Run multiple starting points in parallel
- Local search: Apply to multiple solutions in parallel
- Distance matrix: Pre-compute in parallel (large n)

But GRASP iterations are sequential by design.

---

## 📝 FINAL CHECKLIST BEFORE CODING

```
PREPARATION COMPLETE? Check all:

[ ] I've read all 4 documentation files
[ ] I've decided: BGRASP (vs TGRASP)
[ ] I've decided: Strategy II (vs I)
[ ] I've validated all data in database
[ ] I've built distance matrix and verified correctness
[ ] I've built adjacency graph and verified neighbors
[ ] I've computed d_max, mu1, mu2 correctly
[ ] I have sample test data (10, 50, 100 units)
[ ] I've created folder structure (optimization/*)
[ ] I've defined Unit, District, Solution classes
[ ] I've created config with default parameters
[ ] I've written and tested utility functions
[ ] I understand each formula in FORMULAS_AND_UTILITIES.md
[ ] I understand the overall algorithm flow in GRASP_IMPLEMENTATION_PLAN.md
[ ] I know what to do when something breaks (see STRATEGIC_CHOICES.md debugging)

IF ALL CHECKED: You're ready to code Phase 1! 🚀
```

---

## 📞 NEXT STEPS

1. **Review** the 4 documentation files in order
2. **Make decisions** on BGRASP vs TGRASP, Strategy I vs II
3. **Prepare data** - validation, distance matrix, adjacency graph
4. **Setup framework** - folders, classes, configs
5. **Implement Phase 1** - Construction phase
6. **Test thoroughly** on small data (10 units)
7. **Proceed to Phase 2+** only when Phase 1 working

---

**Good luck with your implementation! 🎯**

*Created: April 2026*
*For: Districting Problem using GRASP*

