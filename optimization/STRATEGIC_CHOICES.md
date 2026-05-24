# GRASP - Strategic Choices & Decision Tree

## 1. ALGORITHM VARIANT SELECTION

### A. BGRASP vs TGRASP

| Aspect | BGRASP (Bi-objective) | TGRASP (Tri-objective) |
|--------|----------------------|------------------------|
| **Objectives** | 2: Compactness (z1) + Balance (z2) | 3: Compactness + Balance + Feasibility (z3) |
| **Constraints** | Soft | Hard (capacity must be satisfied) |
| **Complexity** | Simpler, faster | More complex, slower |
| **Best for** | Exploratory, proof-of-concept | Production, real-world constraints |
| **Weights** | λ ∈ (0,1) | λ1 + λ2 + λ3 = 1 |
| **Parameter tuning** | 1 parameter | 3 parameters |
| **Recommended start** | ✓ For prototyping | After BGRASP validated |

**Decision:**
- **If** data is well-understood and balanced → Start with BGRASP
- **If** capacity constraints are critical → Start with TGRASP
- **Recommendation for your project:** Start BGRASP, then extend to TGRASP

---

### B. Connectivity Strategy: Hard vs Soft Constraints

#### **Strategy I (Hard Constraint)**

```
BGRASP-I / TGRASP-I: Enforce connectivity in construction phase

Characteristics:
├─ Constraint: Every district must be spatially connected
├─ Implementation: Only allow units adjacent to current district
├─ Advantage: Guarantees feasible solutions
├─ Disadvantage: Reduces search space, may miss good solutions
├─ RCL candidates: N(t*) = {j ∉ assigned, j adjacent to some unit in t*}
└─ If no neighbors available: Accept unit touching district?
                              or Mark as infeasible iteration?

When to use:
├─ If connectivity is CRITICAL business requirement
├─ Real-world delivery routes must be geographically contiguous
└─ Never acceptable to break delivery zones into separate patches
```

#### **Strategy II (Soft Constraint - Penalty)**

```
BGRASP-II / TGRASP-II: Allow broken connectivity, penalize in local search

Characteristics:
├─ Construction: Allow ANY unassigned unit (broken connectivity OK)
├─ Penalty: Include z4 (number of components) in objectives
├─ Advantage: Larger search space, may find better solutions
├─ Disadvantage: Solutions may have isolated units
├─ RCL candidates: N(t*) = all unassigned units
├─ Local search: z4 optimization tries to reconnect

When to use:
├─ If some disconnection is acceptable (merge patches later)
├─ Optimization quality more important than connectivity
├─ Can post-process to fix disconnected components
└─ Typical for geographic optimization problems
```

**Decision Matrix:**

| Scenario | Recommended | Reason |
|----------|-------------|--------|
| Vietnamese delivery districts (must be contiguous) | Strategy I | Real-world requirement |
| Initial prototyping | Strategy II | Faster, easier to debug |
| Government region redistricting | Strategy I | Legal requirement |
| Sales territory optimization | Strategy II | Flexibility more important |

**Recommendation for your project:**
- **Phase 1:** BGRASP-II (prototype, easier)
- **Phase 2:** TGRASP-II (production with quality focus)
- **Phase 3:** Consider TGRASP-I if connectivity becomes critical

---

## 2. PARAMETER TUNING GUIDELINES

### Research Paper Parameters

```
From the paper (for 500-1000 units datasets):
├─ maxIterations: 2020
├─ alphaRCL: 0.04-0.05
├─ minNodeDegree: 3
├─ maxLocalSearchMoves: 2000-3000
├─ lambdaDispersion (BGRASP): 0.5
├─ lambdaWeights (TGRASP): [0.33, 0.33, 0.34]
├─ toleranceSales: 0.05 (5%)
├─ filterTopSolutions: 100 (from 2020)
└─ distanceThreshold (neighbors): ~1-2 km
```

### Parameter Sensitivity Analysis

```
ALPHA (RCL quality parameter):
├─ α = 0.01: Very strict RCL
│  ├─ Pro: Forces good solutions, less variance
│  ├─ Con: May miss creative solutions
│  └─ Use when: Data is simple, few local optima
│
├─ α = 0.04: Standard (from paper)
│  ├─ Pro: Balance between quality and diversity
│  ├─ Con: None
│  └─ Use when: Most cases
│
├─ α = 0.10: Loose RCL
│  ├─ Pro: More exploration, better diversity
│  ├─ Con: May include poor solutions
│  └─ Use when: Complex data, many local optima
│
└─ Recommendation: Start with 0.04, adjust based on results

LAMBDA (Weight for dispersion in BGRASP):
├─ λ = 0.3: Emphasize balance (even load)
│  └─ Use when: Balance is critical
├─ λ = 0.5: Equal weight (typical)
│  └─ Use when: Both objectives equally important
├─ λ = 0.7: Emphasize compactness (tight clusters)
│  └─ Use when: Geographic proximity critical
└─ Recommendation: Start with 0.5, run sensitivity analysis

LOCAL SEARCH MOVES:
├─ 500 moves: Fast, may miss improvements
├─ 2000 moves: Standard (from paper)
├─ 5000 moves: Slow, diminishing returns
└─ Recommendation: Start with 2000, reduce if too slow
```

---

## 3. IMPLEMENTATION CHECKLIST - PHASED APPROACH

### Phase 0: Pre-implementation (Foundation)

```javascript
□ Set up folder structure
  └─ optimization/ with subfolders: config, core, utils, models, routes, tests

□ Create base configuration
  └─ optimization/config/grasp_parameters.js with all params

□ Define data models
  □ Unit class (optimization/models/unit.js)
  □ District class (optimization/models/district.js)
  □ Solution class (optimization/models/solution.js)

□ Implement utility functions
  □ Distance calculations (distance_calculator.js)
  □ Geometry operations (geometry_utils.js)
  □ Data validation (data_converter.js)

□ Set up testing infrastructure
  □ Sample test data
  □ Basic unit tests
```

### Phase 1: Construction Phase Implementation

```javascript
□ Build adjacency graph
  └─ buildAdjacencyGraph(units, threshold)

□ Implement seed selection
  └─ selectSeed(units, adjacencyGraph, minDegree)

□ Implement BGRASP cost functions
  □ computeDispersion(unit, district)
  □ computeDeviation(unit, district)
  □ computeCostBGRASP(unit, district, lambda)

□ Implement RCL logic
  □ buildRCL(candidates, costs, alpha)
  □ selectRandomFromRCL(RCL)

□ Main construction loop
  └─ constructionPhase() with full loop

□ Run on small test data (10 units)
  └─ Verify: all units assigned, costs computed correctly
```

### Phase 2: Filtering & Evaluation

```javascript
□ Implement solution quality metric
  □ computeZ1(solution) - dispersion
  □ evaluateSolutionQuality(solution) - ρ(S)

□ Implement filtering
  □ filterTopSolutions(solutions, K)
  
□ Test:
  □ Run construction, generate 2020 solutions
  □ Verify top 100 selected correctly
  □ Check ρ(S) scores are monotonically sorted
```

### Phase 3: Local Search Implementation

```javascript
□ Implement all objective functions
  □ computeZ2(solution) - balance
  □ computeZ3(solution) - feasibility
  □ computeZ4(solution) - connectivity

□ Implement move operations
  □ moveUnit(unit, from, to) with validation
  □ Revert mechanism (undo moves)

□ Implement relinked local search
  □ Cycle through z1 → z2 → z3 → z4 → repeat
  □ First-improvement strategy

□ Test on filtered solutions
  □ Verify moves improve/maintain objectives
  □ Check time per solution is reasonable
```

### Phase 4: Integration & Optimization

```javascript
□ Create main solver class
  └─ GRASPSolver class with solve() method

□ Add database integration
  □ Load units from PostGIS
  □ Save results back to DB

□ Add API endpoint
  □ POST /api/optimize with version_id
  □ GET /api/optimize/:jobId status
  
□ Performance optimization
  □ Cache distance matrix
  □ Parallelize if possible
  □ Profile bottlenecks

□ Add monitoring/logging
  □ Progress tracking
  □ Timing per phase
  □ Convergence metrics
```

### Phase 5: Testing & Validation

```javascript
□ Unit tests
  □ Distance calculations
  □ Objective functions
  □ Move operations

□ Integration tests
  □ Small dataset (10 units, 2 districts)
  □ Medium dataset (100 units, 5 districts)
  □ Large dataset (1000 units, 50 districts)

□ Validation checks
  □ All units assigned
  □ No duplicates
  □ Constraints satisfied
  □ Objectives make sense

□ Performance benchmarks
  □ Execution time vs dataset size
  □ Memory usage
  □ Scaling analysis
```

---

## 4. DECISION TREE - WHAT TO DO FIRST

```
START: You want to implement GRASP
  │
  ├─→ Do you understand the math? NO
  │   └─→ Read: FORMULAS_AND_UTILITIES.md (this repo)
  │       Then: Papers on GRASP and districting
  │
  ├─→ Have you decided: BGRASP or TGRASP? NO
  │   └─→ Recommendation: Start with BGRASP-II
  │       │ (Simpler, flexible)
  │       └─→ Read: Section 1.A and 1.B above
  │
  ├─→ Have you decided: Hard or Soft connectivity? NO
  │   └─→ Recommendation: Start with Strategy II (Soft)
  │       │ (Larger search space, easier to tune)
  │       └─→ Read: Section 1.B above
  │
  ├─→ Do you have clean data? NO
  │   └─→ Run data validation (DATA_STRUCTURES_CONFIG.md)
  │       └─→ Fix issues: missing centroids, invalid geoms, etc.
  │
  ├─→ Do you have utility functions? NO
  │   └─→ Implement Phase 0 (Section 3 above)
  │       └─→ Test each function individually
  │
  ├─→ Ready to code? YES
  │   └─→ IMPLEMENT: Phase 1 (Construction) first
  │       Reason: Core of algorithm, other phases depend on it
  │       └─→ Test: Run on 10-20 units
  │           Verify: All units assigned, costs reasonable
  │
  ├─→ Construction working? YES
  │   └─→ IMPLEMENT: Phase 2 (Filtering)
  │       Test: 2020 solutions generated, top 100 selected
  │
  ├─→ Filtering working? YES
  │   └─→ IMPLEMENT: Phase 3 (Local Search)
  │       Test: Each objective improved individually
  │
  ├─→ Local search working? YES
  │   └─→ IMPLEMENT: Phase 4 (Integration)
  │       Add API, database save, monitoring
  │
  ├─→ Running on real data? YES
  │   ├─→ Too slow? YES
  │   │   └─→ Reduce alpha (fewer candidates)
  │   │       or reduce max iterations
  │   │
  │   ├─→ Poor solution quality? YES
  │   │   └─→ Increase alpha (more diversity)
  │   │       or increase max local search moves
  │   │
  │   └─→ Solutions disconnected? (if using Strategy II) YES
  │       └─→ Increase λ3 weight in TGRASP
  │           or switch to Strategy I
  │
  └─→ SUCCESS: GRASP is working!
      Next: Extend to TGRASP or optimize further
```

---

## 5. DEBUGGING CHECKLIST

When something goes wrong, check these in order:

```
CONSTRUCTION PHASE ISSUES:

□ "Some units not assigned"
  └─→ Check: N(t*) always has candidates
     Fix: Increase distanceThreshold in adjacency graph
          or allow strategy II (no connectivity requirement)

□ "Cost values don't make sense (too large/small)"
  └─→ Check: Normalization factors (d_max, mu1, mu2)
     Fix: Verify they're computed correctly
          Print debug info: d_max, mu1, mu2 values

□ "RCL is always same unit"
  └─→ Check: alpha value (try increasing to 0.1)
     Fix: Verify costArray has variance
          Check for cost ties

□ "Solutions are identical across iterations"
  └─→ Check: Random seed (should be different per iteration)
     Fix: Verify Math.random() called in RCL selection

FILTERING ISSUES:

□ "ρ(S) not decreasing after sorting"
  └─→ Check: Sorting logic (should be ascending)
     Fix: Verify evaluateSolutionQuality returns lower = better

LOCAL SEARCH ISSUES:

□ "Objectives not improving"
  └─→ Check: Move acceptance criteria
     Fix: Verify we're checking ALL candidate moves

□ "Takes forever (too slow)"
  └─→ Check: MAX_MOVES value (reduce it)
     Fix: Profile where time is spent
          Optimize distance lookups (cache, precompute)

OBJECTIVE FUNCTION ISSUES:

□ "z1 values extremely large"
  └─→ Issue: Distance normalization wrong
     Fix: Check d_max computation

□ "z2 always zero"
  └─→ Issue: Districts perfectly balanced (unlikely)
     Fix: Verify mu1 computation

□ "z3 always > 0"
  └─→ Issue: Tolerance too strict (capacity never satisfied)
     Fix: Increase tau2 (e.g., 0.05 → 0.10)

CONNECTIVITY ISSUES (z4):

□ "z4 always > 0 even after local search"
  └─→ Issue: Cannot reconnect due to distance
     Fix: Either reduce distanceThreshold
          or accept disconnected solution
          or increase weight in objective
```

---

## 6. SUCCESS CRITERIA

When is implementation successful?

```
✓ CORRECTNESS:
  ├─ All units assigned to exactly one district
  ├─ No unit appears in multiple districts
  └─ Total load = sum of unit loads

✓ FEASIBILITY:
  ├─ If using TGRASP: All capacity constraints satisfied
  ├─ If using Strategy I: All districts connected
  └─ No capacity violations in final solution

✓ OPTIMALITY (relative):
  ├─ Objectives improving across iterations
  ├─ Solutions diverse (not all identical)
  └─ Filtering selects best ρ scores

✓ PERFORMANCE:
  ├─ Execution time reasonable
  │  └─ 10 units: <100ms
  │  └─ 100 units: 1-5 seconds
  │  └─ 1000 units: 10-60 seconds
  ├─ No memory leaks
  └─ Can handle 1000+ units

✓ USABILITY:
  ├─ API endpoint working
  ├─ Results saved to database
  ├─ Results visualizable on map
  └─ Can run multiple times with different parameters
```

---

## 7. PARAMETER TUNING CHECKLIST

After basic implementation, fine-tune with this:

```
1. DATASET SIZE ANALYSIS
   └─ Run on small (10), medium (100), large (1000) unit sets
      Track: execution time, solution quality, memory

2. ALPHA SENSITIVITY
   ├─ Test: 0.01, 0.02, 0.04, 0.05, 0.10, 0.20
   └─ Track: solution quality, diversity, time per iteration

3. LAMBDA SENSITIVITY (BGRASP)
   ├─ Test: 0.2, 0.3, 0.5, 0.7, 0.8
   └─ Track: compactness vs balance in results

4. TOLERANCE SENSITIVITY (tau2)
   ├─ Test: 0.02, 0.05, 0.10, 0.15
   └─ Track: constraint violations vs solution quality

5. ITERATION COUNT
   ├─ Test: 500, 1000, 2020, 5000
   └─ Track: improvement curve (diminishing returns?)

6. LOCAL SEARCH MOVES
   ├─ Test: 500, 1000, 2000, 5000
   └─ Track: improvement per move (cost vs benefit)

OUTPUT: Generate tuning report with recommendations for your dataset
```

---

