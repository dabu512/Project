const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth");
const hierarchyRoutes = require("./routes/hierarchy");
const unitRoutes = require("./routes/units");
const driverRoutes = require("./routes/driver");
const optimizationRoutes = require("./routes/optimization");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Kết nối các Route với tiền tố /api
app.use("/api", authRoutes);
app.use("/api/hierarchy", hierarchyRoutes);

// Guard: Ngăn chỉnh sửa khi version đang bị khoá tối ưu hóa
const checkVersionLock = optimizationRoutes.checkVersionLock || ((req, res, next) => next());
app.use("/api/units",    checkVersionLock, unitRoutes);
app.use("/api/driver", driverRoutes);
app.use("/api/optimization", optimizationRoutes);

const PORT = 3000;
app.listen(PORT, () =>
  console.log(` Hệ thống chạy tại: http://localhost:${PORT}`),
);
