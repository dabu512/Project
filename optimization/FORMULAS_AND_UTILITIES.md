# GRASP - Utility Functions & Mathematical Formulas

## 1. UTILITY FUNCTIONS CHECKLIST

Các hàm cần implement trước khi code GRASP chính. Mỗi hàm nên:
- Có unit tests
- Xử lý edge cases
- Có logging debug mode

### A. DISTANCE & GEOMETRY FUNCTIONS

```
Function: computeDistanceMatrix(units, coordinateSystem)
├─ Input: Array of Unit objects
├─ Output: 2D array or sparse matrix
├─ Formula: d_ij = haversine_distance(unit_i.centroid, unit_j.centroid)
│           or Euclidean if working in projected coords
├─ Complexity: O(n²)
├─ Cache: Store in memory or disk (for large n > 10000)
└─ Test cases:
    - 10 units → 10x10 matrix
    - Symmetric: d_ij = d_ji
    - Diagonal: d_ii = 0

Function: computeMaxDistance(distanceMatrix)
├─ Input: Distance matrix
├─ Output: Scalar d_max
├─ Formula: d_max = max(d_ij) for all i,j
├─ Complexity: O(n²)
└─ Usage: Normalization in cost functions

Function: computeCentroid(unitList)
├─ Input: Array of Unit objects
├─ Output: {lat, lng} object
├─ Formula: centroid_lat = Σ unit.lat / |units|
│           centroid_lng = Σ unit.lng / |units|
│           or use PostGIS ST_Centroid for better accuracy
├─ Complexity: O(n)
└─ Test: Centroid of 2 units = midpoint

Function: computeDistanceToCentroid(unit, centroid, distanceMatrix)
├─ Input: Unit, District centroid
├─ Output: Scalar distance
├─ Usage: d_i(c_t) in cost functions
├─ Fallback: Euclidean if centroid not in matrix
```

### B. ADJACENCY & CONNECTIVITY FUNCTIONS

```
Function: buildAdjacencyGraph(units, distanceThreshold)
├─ Input: Unit array, threshold distance (e.g., 1 km)
├─ Output: Adjacency list {unitId → [neighborIds]}
├─ Formula: units i,j are neighbors if distance(i,j) ≤ threshold
├─ Complexity: O(n² log n) with optimizations
├─ Alternative: Use PostGIS spatial indexing (ST_DWithin)
├─ Storage: Map or adjacency matrix
└─ Test:
    - Grid 3x3: corner has 2 neighbors, center has 4

Function: getUnassignedNeighbors(district, unassignedUnits, adjacencyGraph)
├─ Input: Current district, set of unassigned units
├─ Output: Array of candidate units
├─ Formula: N(t*) = {j ∈ unassignedUnits : ∃ i ∈ district.units AND j adjacent to i}
├─ Complexity: O(|V_t| * max_degree)
└─ Strategy II (if broken connectivity allowed):
    If N(t*) is empty, return all unassignedUnits

Function: countConnectedComponents(unitList, adjacencyGraph)
├─ Input: List of units, adjacency graph
├─ Output: Integer (number of connected components)
├─ Algorithm: BFS/DFS on induced subgraph
├─ Formula: η(V_t) = number of components in subgraph
├─ Complexity: O(|V_t| + |E_t|)
├─ Usage: For z4 objective calculation
└─ Test:
    - Single component: return 1
    - Two separate units: return 2
    - Ring of 5 units: return 1
```

### C. AGGREGATE FUNCTIONS

```
Function: computeAverageCost(unitList, attribute)
├─ Input: Unit array, attribute name ('customerCount' or 'salesVolume')
├─ Output: Scalar average
├─ Formula: μ = Σ unit.attribute / |units|
├─ Usage: μ^(1) or μ^(2)
└─ Test: 4 units with [10,20,30,40] → μ = 25

Function: sumDistancesInDistrict(district, distanceMatrix)
├─ Input: District object, distance matrix
├─ Output: Scalar (total dispersion)
├─ Formula: Σ_{j ∈ V_t} d_j(c_t)
├─ Complexity: O(|V_t|)
└─ Cached version: Update incrementally on unit add/remove

Function: computeMaxDeviation(solution, mu, weight)
├─ Input: Solution (districts), target average μ
├─ Output: Maximum deviation value
├─ Formula: max_t { |w(V_t) - μ| }
├─ Complexity: O(p)
└─ Used in z2 calculation
```

### D. ASSIGNMENT & MOVE FUNCTIONS

```
Function: assignUnitToDistrict(unit, district)
├─ Input: Unit, District
├─ Side effects:
│  ├─ district.units.push(unit)
│  ├─ district.w1 += unit.customerCount
│  ├─ district.w2 += unit.salesVolume
│  └─ district.centroid = updateCentroid(...)
├─ Complexity: O(|V_t|) for centroid update
└─ Invariant: unit.district_id === district.id

Function: removeUnitFromDistrict(unit, district)
├─ Input: Unit, District
├─ Side effects: Reverse of assignUnit
├─ Complexity: O(|V_t|)
└─ Safety: Check unit exists in district before removing

Function: moveUnit(unit, fromDistrict, toDistrict)
├─ Implementation: removeUnit + assignUnit
├─ Complexity: O(|V_from| + |V_to|)
├─ Validation: Ensure move is legal (e.g., not violate capacity)
└─ Rollback: Keep copy of old state for undo
```

### E. CONSTRAINT VALIDATION FUNCTIONS

```
Function: checkCapacityConstraint(district, mu2, tau2)
├─ Input: District, target avg μ^(2), tolerance τ^(2)
├─ Output: Boolean (within bounds?)
├─ Bounds: (1 - τ^(2)) * μ^(2) ≤ w^(2) ≤ (1 + τ^(2)) * μ^(2)
└─ Hard/Soft: Depends on BGRASP-I vs BGRASP-II

Function: checkConnectivityConstraint(district, adjacencyGraph)
├─ Input: District, adjacency graph
├─ Output: Boolean (connected?)
├─ Algorithm: BFS from any unit in district
└─ Hard/Soft: Depends on strategy choice
```

### F. RANDOMIZATION & RCL FUNCTIONS

```
Function: buildRCL(candidates, costArray, alpha)
├─ Input: 
│  ├─ candidates: Array of candidate units
│  ├─ costArray: Array of costs (same length as candidates)
│  └─ alpha: RCL quality parameter (0 < α < 1)
├─ Output: Array of units passing RCL threshold
├─ Formula: 
│  ├─ φ_min = min(costArray)
│  ├─ φ_max = max(costArray)
│  └─ RCL = {j : cost_j ∈ [φ_min, φ_min + α(φ_max - φ_min)]}
├─ Complexity: O(n)
├─ Edge cases:
│  ├─ If α = 0: RCL = {unit with min cost only}
│  ├─ If α = 1: RCL = all candidates
│  └─ If costArray has duplicates: handle ties gracefully
└─ Test:
    - costs = [10,20,30,40,50], α = 0.5
    - φ_min=10, φ_max=50
    - threshold = 10 + 0.5*(50-10) = 30
    - RCL = {costs 10,20,30} ✓

Function: selectRandomFromRCL(RCL)
├─ Input: Array of candidates
├─ Output: Randomly selected candidate
├─ Method: Uniform random from [0, |RCL|-1]
├─ Determinism: Use seeded RNG for reproducibility
└─ Weighting: Option to weight by inverse cost (better units more likely)
```

---

## 2. MATHEMATICAL FORMULAS - DETAILED BREAKDOWN

### PHASE 1: CONSTRUCTION - COST FUNCTIONS

#### **BGRASP Cost Function**

```
φ(j, t*) = λ · f_disp(j, t*) + (1 - λ) · f_dev(j, t*)

Where:
├─ λ ∈ (0, 1): Weighting parameter
│   └─ λ = 0.5: Equal weight to dispersion and deviation
│   └─ λ = 0.7: Emphasize dispersion (compact districts)
│   └─ λ = 0.3: Emphasize balance (balanced load)
├─ f_disp(j, t*): Dispersion cost component
└─ f_dev(j, t*): Deviation cost component
```

**Dispersion Cost:**
```
f_disp(j, t*) = (1 / d_max) · Σ_{i ∈ V_{t*} ∪ {j}} d_i(c_{t*})

Where:
├─ V_{t*} ∪ {j}: Set of units in district t* if we add unit j
├─ c_{t*}: Centroid of district t*
├─ d_i(c_{t*}): Euclidean/geodesic distance from unit i to centroid
├─ d_max: Normalization factor (max distance in problem)
├─ Division by d_max: Normalize to range [0, 1]
└─ EXAMPLE:
    V_{t*} = {u1, u2}, j = u3
    d_u1(c) = 2 km
    d_u2(c) = 3 km
    d_u3(c) = 2.5 km
    d_max = 100 km
    f_disp = (2 + 3 + 2.5) / 100 = 0.075
```

**Deviation Cost:**
```
f_dev(j, t*) = (1 / μ^(1)) · max { |w^(1)(V_{t*} ∪ {j}) - μ^(1)|, 0 }

Where:
├─ w^(1)(V_{t*} ∪ {j}): Total customer count if we add unit j
├─ μ^(1) = Σ_{all u} w^(1)(u) / p: Target average
├─ |...|: Absolute deviation from target
├─ 1 / μ^(1): Normalization
└─ EXAMPLE:
    Current: w^(1)(V_t*) = 450 customers
    j has: w^(1)(j) = 50 customers
    New total: 500 customers
    μ^(1) = 480 (target avg)
    Deviation = |500 - 480| = 20
    f_dev = 20 / 480 ≈ 0.042
```

#### **TGRASP Cost Function**

```
γ(j, t) = λ1 · f_disp(j, t) + λ2 · f_dev(j, t) + λ3 · f_infeas(j, t)

Where:
├─ λ1 + λ2 + λ3 = 1 (convex combination)
├─ Example: λ1=0.33, λ2=0.33, λ3=0.34 (equal weights)
├─ Or tuned: λ1=0.4, λ2=0.4, λ3=0.2 (less emphasis on feasibility)
├─ f_disp, f_dev: Same as BGRASP
└─ f_infeas: NEW - penalty for violating sales capacity
```

**Infeasibility Cost:**
```
f_infeas(j, t) = (1 / μ^(2)) · max { w^(2)(V_t ∪ {j}) - (1 + τ^(2)) · μ^(2), 0 }

Where:
├─ w^(2)(V_t ∪ {j}): Total sales volume if we add unit j
├─ τ^(2) ∈ [0, 1]: Tolerance parameter (e.g., 0.05 = 5%)
├─ (1 + τ^(2)) · μ^(2): Upper capacity bound
├─ max(..., 0): Only penalize if exceeds bound (soft constraint)
├─ 1 / μ^(2): Normalization
└─ EXAMPLE (τ^(2) = 0.05):
    μ^(2) = 1000 (target avg sales)
    Upper = 1.05 * 1000 = 1050
    Current: w^(2)(V_t) = 1020
    j has: w^(2)(j) = 40
    New: 1060 (exceeds upper by 10)
    f_infeas = 10 / 1000 = 0.01
    
    If new = 1040 (within bound):
    f_infeas = max(1040 - 1050, 0) / 1000 = 0
```

---

### PHASE 1: RCL THRESHOLD FORMULA

```
RCL = { j ∈ N(t*) : φ(j,t*) ∈ [ φ_min , φ_min + α(φ_max − φ_min) ] }

Step-by-step:
1. For each candidate j in N(t*):
   └─ Compute φ(j, t*) using cost function above

2. Find bounds:
   ├─ φ_min = min{φ(j,t*) : j ∈ N(t*)}
   └─ φ_max = max{φ(j,t*) : j ∈ N(t*)}

3. Compute threshold:
   └─ threshold = φ_min + α * (φ_max - φ_min)

4. Include in RCL:
   └─ If φ(j,t*) ≤ threshold: add j to RCL

EFFECT OF ALPHA:
├─ α = 0.00: Very restrictive (RCL = {best unit only})
├─ α = 0.05: Restrictive (top 5%)
├─ α = 0.25: Moderate (top 25%)
├─ α = 0.50: Balanced (top 50%)
├─ α = 1.00: Permissive (all candidates)
```

---

### PHASE 2: SOLUTION FILTERING

**Filter Score Formula:**
```
ρ(S) = (2 · f_disp(S)) / ((|V| − p) · d_max) + (f_Tdev^(1) / p)

Where:
├─ First term: Normalized total dispersion
│  ├─ f_disp(S) = Σ_{t ∈ T} Σ_{j ∈ V_t} d_j(c_t)
│  │                = Sum of all unit-to-centroid distances
│  ├─ (|V| − p) · d_max: Normalization denominator
│  │  ├─ |V| = total units
│  │  └─ p = number of districts
│  ├─ Factor 2: Scale adjustment
│  └─ Lower is BETTER
│
├─ Second term: Total customer balance deviation
│  ├─ f_Tdev^(1) = Σ_{t ∈ T} { (1/μ^(1)) · max |w^(1)(V_t) − μ^(1)| }
│  │              = Sum of all district deviations
│  ├─ Division by p: Average deviation
│  └─ Lower is BETTER
│
└─ COMBINED: Balanced metric favoring compact AND balanced solutions

ALGORITHM:
1. Compute ρ(S) for all 2020 solutions from construction
2. Sort by ρ (ascending)
3. Select top K=100 solutions (best ρ scores)
4. Apply local search only on these 100

BENEFIT: Avoids spending time on obviously poor solutions
```

**Dispersion Total:**
```
f_disp(S) = Σ_{t ∈ T} Σ_{j ∈ V_t} d_j(c_t)

Pseudo-code:
  f_disp = 0
  FOR each district t in solution:
    c_t = centroid of district t
    FOR each unit j in district t:
      f_disp += distance(j.centroid, c_t)
  RETURN f_disp
```

**Total Deviation:**
```
f_Tdev^(1) = Σ_{t ∈ T} { (1/μ^(1)) · |w^(1)(V_t) − μ^(1)| }

Pseudo-code:
  f_Tdev = 0
  μ^(1) = Σ all customers / p
  FOR each district t in solution:
    deviation = |sum of customers in t - μ^(1)|
    f_Tdev += deviation / μ^(1)
  RETURN f_Tdev
```

---

### PHASE 3: LOCAL SEARCH OBJECTIVES

**Z1 - Total Dispersion:**
```
z1 = Σ_{t ∈ T} Σ_{j ∈ V_t} d_j(c_t)

= f_disp(S) from filtering phase
(Same calculation)

Target: MINIMIZE z1 (compact districts)
```

**Z2 - Customer Balance:**
```
z2 = (1/μ^(1)) · max_{t ∈ T} { |w^(1)(V_t) − μ^(1)| }

= Maximum deviation / Average load

Pseudo-code:
  z2_max = 0
  μ^(1) = Σ all customers / p
  FOR each district t in solution:
    deviation = |customers in t - μ^(1)|
    z2_max = max(z2_max, deviation)
  z2 = z2_max / μ^(1)
  RETURN z2

Range: [0, ∞), ideally close to 0
```

**Z3 - Sales Volume Feasibility:**
```
z3 = (1/μ^(2)) · Σ_{t ∈ T} [ max(w^(2)(V_t) − (1+τ^(2)) · μ^(2), 0)
                            + max((1−τ^(2)) · μ^(2) − w^(2)(V_t), 0) ]

= Penalty for exceeding sales capacity bounds

Bounds:
├─ Lower = (1 − τ^(2)) · μ^(2)  [e.g., 0.95 * 1000 = 950]
└─ Upper = (1 + τ^(2)) · μ^(2)  [e.g., 1.05 * 1000 = 1050]

Pseudo-code:
  z3 = 0
  μ^(2) = Σ all sales / p
  lower_bound = (1 - τ) * μ^(2)
  upper_bound = (1 + τ) * μ^(2)
  
  FOR each district t in solution:
    w2 = sales volume in t
    IF w2 > upper_bound:
      z3 += (w2 - upper_bound)
    IF w2 < lower_bound:
      z3 += (lower_bound - w2)
  
  z3 = z3 / μ^(2)
  RETURN z3

Range: [0, ∞), ideally = 0 (feasible)
```

**Z4 - Connectivity (Number of Broken Components):**
```
z4 = Σ_{t ∈ T} |η(V_t)|

Where η(V_t) = number of connected components in district t minus 1
              (0 if fully connected, 1 if 2 components, etc.)

Pseudo-code:
  z4 = 0
  FOR each district t:
    components = countConnectedComponents(t.units, adjacencyGraph)
    z4 += (components - 1)  // -1 because 1 component = 0 penalty
  RETURN z4

Range: [0, ∞), ideally = 0 (all connected)
```

---

### PHASE 3: RELINKED LOCAL SEARCH LOGIC

```
Relinked Strategy: Cycle through objectives sequentially

Iteration sequence:
┌─ Move attempt cycle (repeat until MAX_MOVES or no improvement)
├─ Phase 1: Optimize z1 (dispersion)
│   └─ Try all moves that reduce z1
│   └─ Accept first improving move, restart
├─ Phase 2: Optimize z2 (balance), using current solution from Phase 1
│   └─ Try all moves that reduce z2
│   └─ Accept first improving move, restart
├─ Phase 3: Optimize z3 (feasibility), using solution from Phase 2
│   └─ Try all moves that reduce z3
│   └─ Accept first improving move, restart
├─ Phase 4: Optimize z4 (connectivity), using solution from Phase 3
│   └─ Try all moves that reduce z4
│   └─ Accept first improving move, restart
└─ Repeat cycle → back to Phase 1

Benefit: Avoids oscillating between objectives
         Each phase builds on previous improvement
```

---

## 3. COMPLEXITY ANALYSIS

```
CONSTRUCTION PHASE:
┌─ Per iteration:
│  ├─ Seed selection: O(n log n)
│  ├─ Main loop (assign n-p units):
│  │  └─ For each assignment:
│  │     ├─ Get neighbors: O(degree)
│  │     ├─ Compute costs: O(degree) × O(|V_t|) = O(degree × p_size)
│  │     ├─ Build RCL: O(degree)
│  │     └─ Random select: O(1)
│  │  Total per unit: O(p_size × degree)
│  └─ Total per iteration: O(n × p_size × avg_degree)
│
└─ Total (2020 iterations): O(2020 × n × p_size × avg_degree)

FILTERING:
├─ Evaluate all 2020 solutions: O(2020 × n)
├─ Sort: O(2020 log 2020)
└─ Select top 100: O(100)
Total: O(2020 × n)

LOCAL SEARCH:
├─ Per solution: O(MAX_MOVES × n × p × cost_function)
│  └─ For each move: O(n × p) candidate tries
│  └─ Each try: O(p_size) to compute new objective
│
└─ Total (100 solutions): O(100 × MAX_MOVES × n × p × p_size)

OVERALL COMPLEXITY:
O(2020 × n × p_size × avg_degree + 100 × MAX_MOVES × n × p × p_size)

For typical n=1000, p=50:
≈ O(2020 × 1000 × 20 × 3 + 100 × 2000 × 1000 × 50 × 20)
= O(121M + 20B) operations
≈ seconds to minutes runtime
```

---

