# GRASP - Data Structures & Configuration

## 1. CONFIGURATION TEMPLATE

```javascript
// optimization/config/grasp_parameters.js

const GRASP_CONFIG = {
  // ========== BGRASP Configuration ==========
  BGRASP: {
    algorithm: 'BGRASP',
    maxIterations: 2020,
    alphaRCL: 0.04,                    // Thay đổi → 0.05 nếu dữ liệu 1999 units
    lambdaDispersion: 0.5,             // λ: weight for dispersion vs deviation
    filterTopSolutions: 100,           // Số solutions để áp dụng local search
    maxLocalSearchMoves: 2000,         // Số moves tối đa trong local search
    minNodeDegree: 3,                  // Degree tối thiểu để chọn seed
    toleranceSales: 0.05,              // τ^(2): 5% tolerance
    connectivityStrategy: 'HARD'       // 'HARD' = enforce in construction, 'SOFT' = penalty
  },
  
  // ========== TGRASP Configuration ==========
  TGRASP: {
    algorithm: 'TGRASP',
    maxIterations: 2020,
    alphaRCL: 0.04,
    lambdaWeights: [0.33, 0.33, 0.34],  // [λ1, λ2, λ3] - phải cộng = 1
    filterTopSolutions: 100,
    maxLocalSearchMoves: 2000,
    minNodeDegree: 3,
    toleranceSales: 0.05,
    connectivityStrategy: 'HARD'
  },
  
  // ========== Data Parameters ==========
  DATA: {
    distanceUnit: 'meters',            // or 'km' or 'degrees'
    coordinateSystem: 4326,            // PostGIS SRID: 4326 = WGS84
    defaultCRS: 3857,                  // Working CRS for area/distance calc
    batchSize: 100                     // Process units in batches
  },
  
  // ========== Output & Logging ==========
  OUTPUT: {
    logLevel: 'info',                  // 'debug' | 'info' | 'warn' | 'error'
    logProgress: true,                 // Log each iteration
    saveIntermediateSolutions: false,   // Save all 2020 solutions to file
    outputFormat: 'json'               // 'json' | 'geojson' | 'shapefile'
  }
};

module.exports = GRASP_CONFIG;
```

---

## 2. OBJECT MODELS DEFINITION

```javascript
// optimization/models/unit.js

class Unit {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.geom = data.geom;                    // PostGIS Polygon
    this.centroid = data.centroid;            // PostGIS Point
    this.customerCount = data.customer_count; // w^(1)
    this.salesVolume = data.order_count;      // w^(2) - or sales_volume
    this.area_km2 = data.area_km2;
    this.color = data.color || '#808080';
    this.district_id = data.district_id || null;  // Current assignment
  }
  
  // Utilities
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      customerCount: this.customerCount,
      salesVolume: this.salesVolume,
      area_km2: this.area_km2,
      color: this.color
    };
  }
}

// optimization/models/district.js

class District {
  constructor(id, name = null) {
    this.id = id;
    this.name = name || `District_${id}`;
    this.units = [];                   // Array of Unit objects
    this.w1 = 0;                       // Total customers (cumulative)
    this.w2 = 0;                       // Total sales (cumulative)
    this.centroid = { lat: 0, lng: 0 }; // Geographic center
    this.color = this.generateColor();
  }
  
  addUnit(unit) {
    this.units.push(unit);
    this.w1 += unit.customerCount;
    this.w2 += unit.salesVolume;
    unit.district_id = this.id;
  }
  
  removeUnit(unit) {
    const idx = this.units.findIndex(u => u.id === unit.id);
    if (idx > -1) {
      this.units.splice(idx, 1);
      this.w1 -= unit.customerCount;
      this.w2 -= unit.salesVolume;
      unit.district_id = null;
    }
  }
  
  updateCentroid(newCentroid) {
    this.centroid = newCentroid;
  }
  
  generateColor() {
    // Generate random color for visualization
    return '#' + Math.floor(Math.random()*16777215).toString(16);
  }
  
  getLoad1() { return this.w1; }
  getLoad2() { return this.w2; }
  getUnitCount() { return this.units.length; }
  
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      units: this.units.map(u => u.id),
      w1: this.w1,
      w2: this.w2,
      centroid: this.centroid,
      color: this.color
    };
  }
}

// optimization/models/solution.js

class Solution {
  constructor(districtsList) {
    this.districts = districtsList;     // Array of District objects
    this.objectives = {};               // Will hold z1, z2, z3, z4
    this.quality = Infinity;            // ρ(S) filter score
    this.feasible = false;              // Check all constraints
    this.createdAt = new Date();
  }
  
  computeObjectives(distanceMatrix, mu1, mu2, tau2, adjacencyGraph) {
    // Compute all objective functions
    this.objectives = {
      z1: this.computeZ1(distanceMatrix),
      z2: this.computeZ2(mu1),
      z3: this.computeZ3(mu2, tau2),
      z4: this.computeZ4(adjacencyGraph)
    };
  }
  
  computeZ1(distanceMatrix) {
    // Total dispersion
    let z1 = 0;
    for (let district of this.districts) {
      const centroid = district.centroid;
      for (let unit of district.units) {
        z1 += distanceMatrix[unit.id][centroid];
      }
    }
    return z1;
  }
  
  computeZ2(mu1) {
    // Max deviation in customers
    let maxDeviation = 0;
    for (let district of this.districts) {
      const deviation = Math.abs(district.w1 - mu1);
      maxDeviation = Math.max(maxDeviation, deviation);
    }
    return maxDeviation / mu1;
  }
  
  computeZ3(mu2, tau2) {
    // Sales feasibility penalty
    const upper = (1 + tau2) * mu2;
    const lower = (1 - tau2) * mu2;
    let z3 = 0;
    
    for (let district of this.districts) {
      const excessUpper = Math.max(district.w2 - upper, 0);
      const excessLower = Math.max(lower - district.w2, 0);
      z3 += excessUpper + excessLower;
    }
    
    return z3 / mu2;
  }
  
  computeZ4(adjacencyGraph) {
    // Connectivity penalty
    let z4 = 0;
    // Implementation depends on adjacencyGraph structure
    return z4;
  }
  
  isDominated(other) {
    // Check if this solution is dominated by other solution
    // In multi-objective: this is dominated if other is better in all objectives
    let allBetter = true;
    for (let obj of ['z1', 'z2', 'z3', 'z4']) {
      if (this.objectives[obj] <= other.objectives[obj]) {
        allBetter = false;
        break;
      }
    }
    return allBetter;
  }
  
  toJSON() {
    return {
      districts: this.districts.map(d => d.toJSON()),
      objectives: this.objectives,
      quality: this.quality,
      feasible: this.feasible,
      createdAt: this.createdAt
    };
  }
}
```

---

## 3. RUNTIME STATE MANAGEMENT

```javascript
// optimization/core/solver_state.js

class GRASPState {
  constructor(config) {
    this.config = config;
    
    // Static data (one-time setup)
    this.units = [];                   // All Unit objects
    this.adjacencyGraph = {};          // unit.id → [neighbor ids]
    this.distanceMatrix = [];          // 2D array or sparse representation
    this.d_max = Infinity;
    
    // Derived constants
    this.p = 0;                        // Number of districts
    this.mu1 = 0;                      // Average customers
    this.mu2 = 0;                      // Average sales
    this.capacityUpper2 = 0;           // (1 + τ^(2)) * μ^(2)
    this.capacityLower2 = 0;           // (1 - τ^(2)) * μ^(2)
    
    // Dynamic (per iteration)
    this.currentIteration = 0;
    this.currentDistricts = [];        // Current working districts
    this.unassignedUnits = new Set();
    
    // Results storage
    this.allSolutions = [];            // All solutions from construction phase
    this.filteredSolutions = [];       // Top K after filtering
    this.improvedSolutions = [];       // After local search
    this.bestSolution = null;
    
    // Metrics
    this.startTime = null;
    this.endTime = null;
    this.executionLog = [];
  }
  
  initialize(units, numDistricts) {
    this.units = units;
    this.p = numDistricts;
    this.unassignedUnits = new Set(units.map(u => u.id));
    
    // Pre-compute constants
    this.mu1 = units.reduce((sum, u) => sum + u.customerCount, 0) / this.p;
    this.mu2 = units.reduce((sum, u) => sum + u.salesVolume, 0) / this.p;
    this.capacityUpper2 = (1 + this.config.toleranceSales) * this.mu2;
    this.capacityLower2 = (1 - this.config.toleranceSales) * this.mu2;
  }
  
  buildNewDistricts() {
    this.currentDistricts = [];
    for (let i = 0; i < this.p; i++) {
      this.currentDistricts.push(new District(i));
    }
  }
  
  log(message, level = 'info') {
    const entry = {
      timestamp: new Date(),
      iteration: this.currentIteration,
      level: level,
      message: message
    };
    this.executionLog.push(entry);
    
    if (this.config.logProgress) {
      console.log(`[${level.toUpperCase()}] ${message}`);
    }
  }
  
  reset() {
    this.currentIteration = 0;
    this.currentDistricts = [];
    this.unassignedUnits = new Set(this.units.map(u => u.id));
    this.allSolutions = [];
  }
}
```

---

## 4. PREPROCESSING & DATA VALIDATION

```javascript
// optimization/utils/data_converter.js

class DataConverter {
  
  static async loadFromDatabase(pool, version_id) {
    /**
     * Load units and related data from PostGIS database
     */
    try {
      // Fetch all units for this version
      const unitsResult = await pool.query(
        'SELECT * FROM basic_units WHERE version_id = $1',
        [version_id]
      );
      
      const units = unitsResult.rows.map(row => new Unit(row));
      
      // Fetch existing districts (if any)
      const districtsResult = await pool.query(
        'SELECT * FROM districts WHERE version_id = $1',
        [version_id]
      );
      
      return {
        units: units,
        districtsExisting: districtsResult.rows,
        versionId: version_id
      };
    } catch (error) {
      throw new Error(`Database query failed: ${error.message}`);
    }
  }
  
  static validateDataIntegrity(units, numDistricts) {
    /**
     * Check data consistency before running algorithm
     */
    const issues = [];
    
    // Check 1: Empty units
    if (units.length === 0) {
      issues.push('ERROR: No units loaded');
      return issues;
    }
    
    // Check 2: Number of units vs districts
    if (units.length < numDistricts) {
      issues.push(`WARNING: Fewer units (${units.length}) than districts (${numDistricts})`);
    }
    
    // Check 3: Missing attributes
    for (let unit of units) {
      if (!unit.customerCount || unit.customerCount < 0) {
        issues.push(`WARNING: Unit ${unit.id} has invalid customerCount`);
      }
      if (!unit.salesVolume || unit.salesVolume < 0) {
        issues.push(`WARNING: Unit ${unit.id} has invalid salesVolume`);
      }
      if (!unit.centroid) {
        issues.push(`ERROR: Unit ${unit.id} missing centroid`);
      }
    }
    
    // Check 4: Geometry validity
    for (let unit of units) {
      if (!unit.geom || !unit.centroid) {
        issues.push(`ERROR: Unit ${unit.id} has invalid geometry`);
      }
    }
    
    return issues;
  }
  
  static sanitizeUnits(units) {
    /**
     * Clean and normalize unit data
     */
    return units.map(unit => {
      return {
        ...unit,
        customerCount: Math.max(0, unit.customerCount || 0),
        salesVolume: Math.max(0, unit.salesVolume || 0),
        area_km2: Math.max(0.001, unit.area_km2 || 0.001)  // Min 0.001 km2
      };
    });
  }
}

// optimization/utils/solution_validator.js

class SolutionValidator {
  
  static checkFeasibility(solution, numUnits, numDistricts, toleranceSales, mu2) {
    /**
     * Verify solution satisfies all constraints
     */
    const violations = [];
    
    // Constraint 1: Every unit assigned exactly once
    let totalUnitsAssigned = 0;
    for (let district of solution.districts) {
      totalUnitsAssigned += district.units.length;
    }
    if (totalUnitsAssigned !== numUnits) {
      violations.push(`Constraint 1 VIOLATED: Only ${totalUnitsAssigned}/${numUnits} units assigned`);
    }
    
    // Constraint 2: Sales volume within bounds
    const upper = (1 + toleranceSales) * mu2;
    const lower = (1 - toleranceSales) * mu2;
    for (let i, district of solution.districts.entries()) {
      if (district.w2 > upper) {
        violations.push(`Constraint 2 VIOLATED: District ${i} exceeds upper bound (${district.w2} > ${upper})`);
      }
      if (district.w2 < lower) {
        violations.push(`Constraint 2 VIOLATED: District ${i} below lower bound (${district.w2} < ${lower})`);
      }
    }
    
    // Constraint 3: No empty districts
    for (let i, district of solution.districts.entries()) {
      if (district.units.length === 0) {
        violations.push(`Constraint 3 VIOLATED: District ${i} is empty`);
      }
    }
    
    return {
      feasible: violations.length === 0,
      violations: violations,
      violationCount: violations.length
    };
  }
}
```

---

## 5. INITIALIZATION CHECKLIST

```markdown
# GRASP Initialization Checklist

## Pre-Execution Setup

- [ ] Load configuration (parameters)
- [ ] Create GRASPState instance
- [ ] Load units from database
- [ ] Validate data integrity
- [ ] Sanitize data (fill defaults, normalize)
- [ ] Build adjacency graph (spatial neighbors)
- [ ] Compute distance matrix (O(n²) operation!)
- [ ] Pre-compute constants: d_max, μ^(1), μ^(2), capacity bounds
- [ ] Create logger/monitoring setup
- [ ] Allocate memory for solution archive (2020 solutions)
- [ ] Start execution timer

## Per-Iteration Setup

- [ ] Increment iteration counter
- [ ] Reset districts (empty all)
- [ ] Reset unassigned units set
- [ ] Clear solution objective values

## Post-Execution Cleanup

- [ ] Stop execution timer
- [ ] Compile execution log
- [ ] Save best solution to database
- [ ] Cleanup memory (if necessary)
- [ ] Generate performance report
```

---

## 6. SAMPLE DATA FOR TESTING

```javascript
// optimization/tests/sample_data.js

const SAMPLE_DATA_SMALL = {
  description: '10 units, 2 districts',
  units: [
    { id: 1, name: 'U1', customerCount: 50, salesVolume: 1500, 
      centroid: { lat: 21.0285, lng: 105.8542 }, geom: null },
    { id: 2, name: 'U2', customerCount: 45, salesVolume: 1400,
      centroid: { lat: 21.0286, lng: 105.8543 }, geom: null },
    // ... 8 more units
  ],
  numDistricts: 2,
  expectedObjectives: {
    z1Range: [100, 500],    // Dispersion
    z2Range: [0.05, 0.15],  // Balance
    z3: 0,                  // Feasible
    z4: 0                   // Connected
  }
};

const SAMPLE_DATA_MEDIUM = {
  description: '100 units, 5 districts',
  units: [ /* 100 unit records */ ],
  numDistricts: 5
};

const SAMPLE_DATA_LARGE = {
  description: '1000 units, 50 districts',
  units: [ /* 1000 unit records */ ],
  numDistricts: 50
};
```

---

## 7. PERFORMANCE METRICS TEMPLATE

```javascript
// optimization/utils/performance_metrics.js

class PerformanceMetrics {
  constructor() {
    this.startTime = null;
    this.endTime = null;
    this.phases = {};  // phase → {startTime, endTime, duration}
  }
  
  startPhase(phaseName) {
    this.phases[phaseName] = { startTime: Date.now() };
  }
  
  endPhase(phaseName) {
    const phase = this.phases[phaseName];
    phase.endTime = Date.now();
    phase.duration = (phase.endTime - phase.startTime) / 1000;  // seconds
  }
  
  getReport() {
    const totalDuration = (this.endTime - this.startTime) / 1000;
    
    return {
      totalTime: totalDuration,
      phases: this.phases,
      summary: {
        constructionTime: this.phases['construction']?.duration || 0,
        filteringTime: this.phases['filtering']?.duration || 0,
        localSearchTime: this.phases['localSearch']?.duration || 0
      }
    };
  }
}
```

---

