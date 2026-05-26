# Đặc tả Use Case — Project_anti

**Định dạng:** theo mẫu đặc tả UC (bảng luồng chính / luồng thay thế).  
**Sơ đồ:** [`USE_CASE_OVERVIEW.puml`](./USE_CASE_OVERVIEW.puml) · [`USE_CASE_DECOMPOSED.puml`](./USE_CASE_DECOMPOSED.puml)

**Actor (UML):** chỉ **Admin** và **Driver** — không có actor Hệ thống.  
**Cột `Hệ thống`** trong bảng luồng = server/DB/UI tự xử lý bước đó (tương ứng các UC `<<include>>` trên sơ đồ).

---

## UC-00 — Xác thực

### UC-AUTH — Đăng nhập / Đăng ký / Đăng xuất

| | |
|---|---|
| **Mã Use case** | UC-AUTH |
| **Tên Use case** | Đăng nhập / Đăng ký / Đăng xuất |
| **Tác nhân** | Admin, Driver |
| **Tiền điều kiện** | Server chạy (`js/server.js`). Trình duyệt hỗ trợ `localStorage`. |

#### Luồng sự kiện chính (Thành công) — Đăng nhập

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1 | Admin / Driver | Nhập `username` và `password` → nhấn **Đăng nhập**. |
| 2 | Hệ thống | Gửi `POST /api/login` → truy vấn bảng `users` theo `username/password`. |
| 3 | Hệ thống | Trả về `{ id, username, role, full_name }` nếu khớp. |
| 4 | Admin / Driver | Lưu `user` vào `localStorage` → reload trang. |
| 5 | Hệ thống | Gọi `checkLogin()` → ẩn overlay, hiển thị UI theo `role` (`admin/driver`). |

#### Luồng sự kiện thay thế

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 2a | Hệ thống | Sai tài khoản/mật khẩu → `success:false`, hiện thông báo lỗi. |
| — | Admin / Driver | **Đăng ký:** chuyển form → chọn `role` (admin/driver) → `POST /api/register`. |
| — | Admin / Driver | **Đăng xuất:** nhấn **Thoát** → `localStorage.removeItem('user')` → reload. |

**Hậu điều kiện**

- `user` được lưu ở client; UI phân quyền theo `users.role`.

**Module:** `public/auth.js`, `routes/auth.js`, `public/map.js`

---

## UC-01 — Quản lý phiên bản bản đồ

### UC-SEL — Chọn ngữ cảnh (Vùng → Tỉnh → Version)

| | |
|---|---|
| **Mã Use case** | UC-SEL |
| **Tên Use case** | Chọn ngữ cảnh bản đồ (Vùng → Tỉnh → Version) |
| **Tác nhân** | Admin |
| **Tiền điều kiện** | Đã đăng nhập `role=admin`; có dữ liệu `regions/provinces/versions`. |

#### Luồng sự kiện chính (Thành công)

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1 | Admin | Mở sidebar **Chọn Vùng** → `loadRegions()`. |
| 2 | Hệ thống | `GET /api/hierarchy/regions` → đổ vào `#region-select`. |
| 3 | Admin | Chọn **Khu vực** → `loadProvinces()`. |
| 4 | Hệ thống | `GET /api/hierarchy/provinces?region_id=...` → đổ vào `#province-select`. |
| 5 | Admin | Chọn **Tỉnh** → `loadVersions()`. |
| 6 | Hệ thống | `GET /api/hierarchy/versions?province_id=...` → đổ `#version-select` kèm `status`. |
| 7 | Hệ thống | Nếu có `status='applied'` thì tự chọn applied; nếu không thì chọn option đầu. |
| 8 | Hệ thống | Gọi `onVersionChange()` khi chọn version. |
| 9 | Hệ thống | `onVersionChange()` set `window.currentVersionId` và set `window.currentVersionStatus='applied'`, đồng thời gọi ngầm `PUT /api/hierarchy/versions/:id/apply`. |
| 10 | Hệ thống | Luôn gọi `loadMapData(versionId)` để load polygons theo version đã chọn. |
| 11 | Hệ thống | Gọi `loadProvinceBoundary(provinceName)` từ Nominatim → render viền tỉnh dashed đỏ + `fitBounds`. |

#### Luồng sự kiện thay thế

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 9a | Hệ thống | Nếu `versionId` rỗng → set `currentVersionId=null` và disable xóa phiên bản/chỉnh sửa. |

**Hậu điều kiện**

- Map đã sẵn sàng thao tác trên dataset của `version_id` đã chọn (Admin có thể vẽ/sửa/bulk/BGRASP).

**Module:** `public/hierarchy.js`, `routes/hierarchy.js`, `public/map.js`

---

### UC-NEW — Tạo phiên bản bản đồ (draft; có thể copy)

| | |
|---|---|
| **Mã Use case** | UC-NEW |
| **Tên Use case** | Tạo phiên bản bản đồ |
| **Tác nhân** | Admin |
| **Tiền điều kiện** | UC-SEL đã chọn được `provinceId`. |

#### Luồng sự kiện chính (Thành công)

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1 | Admin | Nhấn **Tạo Phiên bản Mới** → mở popup swal. |
| 2 | Admin | Nhập `swal-version-name`. Chọn `swal-source-version` (chọn version để copy) hoặc chọn “bắt đầu trống”. |
| 3 | Hệ thống | `POST /api/hierarchy/versions` với `{ province_id, name, source_version_id }`. |
| 4 | Hệ thống | DB transaction: insert vào `versions(status='draft')`. Nếu có `source_version_id` → copy toàn bộ `basic_units` sang `version_id` mới. |
| 5 | Hệ thống | `COMMIT` và autoDump theo middleware (debounce 15s). |
| 6 | Hệ thống | UI nhận `data.id` → set `localStorage.currentVersionId`, gọi `loadVersions()`. |
| 7 | Hệ thống | Set dropdown value = id mới → gọi `window.onVersionChange()` để load map & auto-apply. |
| 8 | Admin | Bắt đầu các thao tác trên version mới: vẽ/sửa/bulk/BGRASP. |

#### Luồng sự kiện thay thế

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 3a | Hệ thống | Lỗi SQL → rollback + hiển thị thông báo lỗi. |
| 2a | Admin | Cancel popup → kết thúc UC. |

**Hậu điều kiện**

- `versions` có record mới `status='draft'` (có thể đã copy `basic_units`).

**Module:** `public/hierarchy.js`, `routes/hierarchy.js`

---

### UC-APP — Áp dụng phiên bản (Applied)

| | |
|---|---|
| **Mã Use case** | UC-APP |
| **Tên Use case** | Áp dụng phiên bản bản đồ (chốt Applied) |
| **Tác nhân** | Admin |
| **Tiền điều kiện** | Có `window.currentVersionId` và Admin chọn thao tác “Áp dụng”. |

#### Luồng sự kiện chính (Thành công)

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1 | Admin | Bam **Áp dụng phiên bản** → confirm (text cảnh báo “áp dụng cho toàn bộ tài xế”). |
| 2 | Hệ thống | `PUT /api/hierarchy/versions/:id/apply`. |
| 3 | Hệ thống | Transaction: đổi `status='history'` với các version khác cùng `province_id` đang `applied`. |
| 4 | Hệ thống | Update version đang chọn → `status='applied'`. |
| 5 | Hệ thống | `COMMIT` → autoDump CSDL. |
| 6 | Hệ thống | UI `loadVersions()` → set dropdown = version id → gọi `onVersionChange()` → reload map & viền tỉnh. |

#### Luồng sự kiện thay thế

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 2a | Hệ thống | Lỗi/404 → thông báo lỗi, không áp dụng. |
| 1a | Admin | Hủy confirm → kết thúc UC. |

**Hậu điều kiện**

- Tỉnh có đúng 1 version `applied` tại thời điểm này.

**Module:** `public/hierarchy.js`, `routes/hierarchy.js`

---

### UC-DEL_VER — Xóa phiên bản

| | |
|---|---|
| **Mã Use case** | UC-DEL_VER |
| **Tên Use case** | Xóa phiên bản bản đồ |
| **Tác nhân** | Admin |
| **Tiền điều kiện** | Đang chọn `version` trong dropdown. |

#### Luồng sự kiện chính (Thành công)

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1 | Admin | Nhấn **Xóa phiên bản** → confirm (cảnh báo xóa vĩnh viễn polygons + vùng). |
| 2 | Hệ thống | `DELETE /api/hierarchy/versions/:id`. |
| 3 | Hệ thống | Transaction: `DELETE basic_units WHERE version_id=:id` rồi `DELETE versions WHERE id=:id`. |
| 4 | Hệ thống | `COMMIT` → autoDump; UI xóa `localStorage.currentVersionId`. |
| 5 | Hệ thống | `loadVersions()` → reload UI và map/viền theo trạng thái mới. |

#### Luồng sự kiện thay thế

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 2a | Hệ thống | Version không tồn tại → 404. |
| 1a | Admin | Cancel confirm → kết thúc UC. |

**Hậu điều kiện**

- Version và các `basic_units` liên quan không còn trong DB.

**Module:** `public/hierarchy.js`, `routes/hierarchy.js`

---

## UC-04 — Xem bản đồ & thống kê

### UC-MAP — Xem bản đồ tổng thể

| | |
|---|---|
| **Mã Use case** | UC-MAP |
| **Tên Use case** | Xem bản đồ tổng thể |
| **Tác nhân** | Admin, Driver |
| **Tiền điều kiện** | Đã login và mở trang map. |

#### Luồng sự kiện chính (Thành công)

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1 | Admin / Driver | Vào map. |
| 2 | Hệ thống | `loadMapData(versionId)` xóa layer cũ `geoJsonLayer` nếu có. |
| 3 | Hệ thống | Tạo URL tải units: `GET /api/units?versionId=${versionId}` (nhánh Driver dùng legacy `driverId` trong UI). |
| 4 | Hệ thống | `GET /api/units` → nhận GeoJSON FeatureCollection từ `basic_units`. |
| 5 | Hệ thống | Render Leaflet polygons; tô màu theo `properties.color` và gán `id`. |
| 6 | Hệ thống | Gắn click event cho polygon: update sidebar thống kê (và admin tools nếu là admin). |
| 7 | Admin | Nếu `currentVersionId` tồn tại: thêm controls vẽ + custom edit mode pencil. |
| 8 | Admin / Driver | Xem polygon trên map. |

#### Luồng sự kiện thay thế

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 3a | Hệ thống | Không có versionId → FeatureCollection rỗng → map trống. |

**Hậu điều kiện**

- Polygon cho version được hiển thị theo đúng style màu trong DB (hoặc legacy driver style).

**Module:** `public/map.js`, `public/map-api.js`, `routes/units.js`

---

### UC-STAT — Xem thông tin/Thông số đa giác

| | |
|---|---|
| **Mã Use case** | UC-STAT |
| **Tên Use case** | Xem thông tin đa giác (diện tích/khách/đơn/màu + form sửa) |
| **Tác nhân** | Admin, Driver |
| **Tiền điều kiện** | Đã render polygon; có click event. |

#### Luồng sự kiện chính (Thành công)

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1 | Admin / Driver | Click polygon. |
| 2 | Hệ thống | `updateSidebarStats(props)` dựng sidebar-content: `Mã hệ thống`, `Diện tích thực`, `Tổng khách`, `Tổng đơn`, chấm màu theo `color`. |
| 3 | Hệ thống | (Admin) `updateSidebarAdmin(id, props)` dựng admin-tools form: |
|  |  | - `edit-name` |
|  |  | - `edit-customers` |
|  |  | - `edit-orders` |
|  |  | - `edit-color` |
| 4 | Hệ thống | Cập nhật `unit-info-panel` (bảng Diện tích/Khách/Đơn và colorRow + input color + nút “Đổi Màu” cho Admin). |
| 5 | Hệ thống | Highlight viền vàng polygon đã chọn và cập nhật `bulk` UI (nếu panel mở). |

#### Luồng sự kiện thay thế

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1a | Hệ thống | Click khi đang bulk: toggle selection (`window.selectedUnitsList`). |

**Hậu điều kiện**

- Người dùng thấy đủ “thông số polygon” trên sidebar/panel; Admin có thể sửa trực tiếp.

**Module:** `public/map.js`, `public/map-ui.js`

---

## UC-02 — Quản lý vùng (Admin)

### UC-DRAW — Vẽ vùng mới

| | |
|---|---|
| **Mã Use case** | UC-DRAW |
| **Tên Use case** | Vẽ vùng mới (tạo polygon basic unit) |
| **Tác nhân** | Admin |
| **Tiền điều kiện** | Admin đã chọn `currentVersionId`. |

#### Luồng sự kiện chính (Thành công)

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1 | Admin | Vẽ polygon bằng Geoman (`pm:create`). |
| 2 | Hệ thống | Nếu `e.shape==='Cut'` → bỏ/return; nếu `e.shape==='Line'` → chuyển luồng Split (UC-CUT) và return. |
| 3 | Hệ thống | Hiện loading → gọi `POST /api/units/check-overlap` `{geometry, version_id}`. |
| 4 | Hệ thống | Nếu `overlap=true` → Swal “Đè Ranh Giới!” và reload để hủy hình vừa vẽ. |
| 5 | Hệ thống | Nếu không overlap → gọi `showSaveForm(geometry, layer)`. |
| 6 | Hệ thống | `showSaveForm` tạo `defaultColor = randomPolygonColor()` và hiển thị Swal nhập: `swal-name`, `swal-customers`, `swal-orders`, `swal-color`. |
| 7 | Admin | Nhập thông số (name/customers/orders/color) và xác nhận tạo mới. |
| 8 | Hệ thống | `saveUnitToDB` gửi `POST /api/units` với `{ name, geometry, customer_count, order_count, color, version_id }`. |
| 9 | Hệ thống | DB trigger: makevalid + tính `centroid/area_km2` + kiểm tra overlap. |
| 10 | Hệ thống | Thành công: Swal success → `location.reload()` (refetch polygon). |

#### Luồng sự kiện thay thế

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 8a | Hệ thống | `currentVersionId` null → Swal “Chưa chọn Phiên bản!”, remove layer tạm. |
| 4a | Hệ thống | Trigger/logic overlap → trả lỗi → Swal error và remove layer. |
| — | Admin | Nhấn cancel popup hoặc bỏ trống `name` → `layer.remove()` (không tạo polygon). |

**Hậu điều kiện**

- Polygon mới nằm trong `basic_units` với `version_id` hiện tại và có thông số area/centroid được tính tự động.

**Module:** `public/map.js`, `public/map-ui.js`, `routes/units.js`

---

### UC-EDIT — Chỉnh sửa ranh giới (geom)

| | |
|---|---|
| **Mã Use case** | UC-EDIT |
| **Tên Use case** | Chỉnh sửa ranh giới polygon |
| **Tác nhân** | Admin |
| **Tiền điều kiện** | Đang trong custom edit mode hoặc polygon có thể được edit; `is_optimizing=false`. |

#### Luồng sự kiện chính (Thành công)

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1 | Admin | Bật custom edit mode (pencil) → `window.isCustomEditMode=true`. |
| 2 | Admin | Click polygon → bật Geoman edit cho polygon đó. |
| 3 | Admin | Kéo các marker/đỉnh → cập nhật hình học trên map. |
| 4 | Admin | Tắt edit mode hoặc disable drag mode → gọi `sendUpdatesToServer()` (nếu có thay đổi). |
| 5 | Hệ thống | `sendUpdatesToServer`: xây `updates[]` từ `window.modifiedUnits` (id + `toGeoJSON().geometry`). |
| 6 | Hệ thống | `POST /api/units/bulk-update` `{ updates, version_id }`. |
| 7 | Hệ thống | Server kiểm tra overlap + DB trigger cập nhật `centroid/area_km2`. |
| 8 | Hệ thống | Thành công: clear modifiedUnits và `loadMapData(currentVersionId)` để cập nhật area/màu. |

#### Luồng thay thế

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 7a | Hệ thống | Lỗi ranh giới/chồng lấn → Swal error và `location.reload()` để reset. |
| 6a | Hệ thống | Version bị khóa → 423. |

**Hậu điều kiện**

- `basic_units.geom` thay đổi; diện tích/tâm được tính lại.

**Module:** `public/map.js`, `public/map-api.js`, `routes/units.js`

---

### UC-ATTR — Sửa thuộc tính polygon

| | |
|---|---|
| **Mã Use case** | UC-ATTR |
| **Tên Use case** | Sửa thuộc tính polygon (name/customers/orders/color) |
| **Tác nhân** | Admin |
| **Tiền điều kiện** | Đã chọn polygon (UC-STAT). |

#### Luồng sự kiện chính (Thành công)

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1 | Admin | Dùng form admin tools (edit-name/edit-customers/edit-orders/edit-color). |
| 2 | Admin | Nhấn **Lưu Thay Đổi** → gọi `saveAdminAttributes(id)`. |
| 3 | Hệ thống | `PUT /api/units/:id/attributes` { name, customer_count, order_count, color }. |
| 4 | Hệ thống | Thành công: update trực tiếp `layer.feature.properties` + `layer.setStyle(fillColor)`. |
| 5 | Hệ thống | Gọi `updateSidebarStats(layer.feature.properties)` để refresh số liệu. |
| 6 | Hệ thống | Toast “Đã lưu thuộc tính”. |

#### Luồng thay thế

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 3a | Hệ thống | Lỗi lưu → Swal “Lỗi lưu dữ liệu”. |
| — | Admin | Đổi màu nhanh trong `unit-info-panel`: input color + nút “Đổi Màu” → `changeUnitColor(id)` → `PUT /api/units/:id/color` → toast success → `location.reload()`. |

**Hậu điều kiện**

- Thông số polygon cập nhật ngay trên UI; `geom` không đổi.

**Module:** `public/map-ui.js`, `public/map-api.js`, `routes/units.js`

---

### UC-CUT — Cat (Split) / Hop nhat (Merge)

#### Luồng chính — Split (Cat bang duong ke)

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1 | Admin | Vẽ đường (Geoman) khi tạo `pm:create` với `e.shape==='Line'`. |
| 2 | Hệ thống | Hiện loading → `POST /api/units/split` `{ geometry: lineGeometry, version_id }`. |
| 3 | Hệ thống | Server thực thi `ST_Split`, tạo polygon mới và phân bổ `customer_count/order_count` theo tỉ lệ diện tích. |
| 4 | Hệ thống | Thành công: Swal toast + `location.reload()` sau 1500ms. |
| 5 | Hệ thống | Thất bại: Swal error + `layer.remove()` (xóa đường cắt). |

#### Luồng chính — Merge (gộp) qua Bulk merge

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1b | Admin | Bật bulk, chọn ≥2 ô, nhập `unitName` popup “Hợp nhất Đa giác”. |
| 2b | Hệ thống | Gửi `POST /api/units/merge` `{ ids: selectedUnitsList, name: unitName, version_id }`. |
| 3b | Hệ thống | Thành công: Swal “Đã nối…” → `cancelBulkMode()` → reload. |

#### Luồng thay thế

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 3a | Hệ thống | Lỗi server/split không hợp lệ → Swal “Thất bại”. |

**Hậu điều kiện**

- Dataset `basic_units` thay đổi theo split/merge.

**Module:** `public/map.js`, `public/map-api.js`, `routes/units.js`

---

### UC-DEL — Xóa polygon

#### Luồng chính — Xóa 1 polygon

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1 | Admin | Trên polygon nhấn/remove (`pm:remove`) → confirm Swal. |
| 2 | Hệ thống | `DELETE /api/units/:id`. |
| 3 | Hệ thống | Thành công: Swal “Đã xóa”, polygon không còn. |
| 4 | Hệ thống | Nếu lỗi: Swal “Không thể xóa…” và `location.reload()`. |

#### Luồng chính — Xóa nhiều polygon (bulk)

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1b | Admin | Bật bulk, chọn nhiều ô. |
| 2b | Admin | Nhấn action **Xóa**. |
| 3b | Hệ thống | UI thực thi DELETE cho từng `id` được chọn (theo danh sách selectedUnitsList). |
| 4b | Hệ thống | Thành công: reload map. |

#### Luồng thay thế

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 2a | Hệ thống | Version đang khóa → trả 423. |

**Hậu điều kiện**

- Polygon không còn trong `basic_units`.

**Module:** `public/map.js`, `routes/units.js`

---

### UC-BULK — Bulk thao tác hàng loạt

| | |
|---|---|
| **Mã Use case** | UC-BULK |
| **Tên Use case** | Bulk thao tác hàng loạt |
| **Tác nhân** | Admin |
| **Tiền điều kiện** | Admin bật `toggleBulkMode()`; có polygon được chọn. |

#### Luồng sự kiện chính (Thành công)

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1 | Admin | Nhấn **Bulk** → `toggleBulkMode()` bật chế độ chọn nhiều và hiển thị panel bulk. |
| 2 | Admin | Chọn nhiều ô bằng click/checkbox (cập nhật `window.selectedUnitsList`, `bulk-count`). |
| 3 | Admin | Chọn action bulk trong panel: |
|  |  | - **Phân bổ thông minh** (customers/orders) |
|  |  | - **Tô màu ngẫu nhiên** |
|  |  | - **Gộp** (merge) |
|  |  | - **Xóa** |
|  |  | - Các thao tác bulk khác (nếu UI có). |
| 4 | Hệ thống | Gọi API tương ứng và xử lý kết quả (reload map hoặc cập nhật trực tiếp theo UI). |
| 5 | Admin | Tắt bulk (`cancelBulkMode`). |

#### Nhánh quan trọng — Bulk Random Distribute (customers/orders)

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1b | Admin | Nhấn “Phân bổ thông minh” → `bulkRandomDistribute()`. |
| 2b | Admin | Nhập `totalCustomers`, `totalOrders`, `minPct`, `maxPct`. |
| 3b | Hệ thống | Validate: `orders >= customers`, `minPct < maxPct`, `n*minPct <= 100`. |
| 4b | Hệ thống | Lấy `areas` từ polygons đang hiển thị (`getUnitAreas`). |
| 5b | Hệ thống | Chia khách theo min/max + variation; chia đơn theo tỉ lệ khách + hệ số tiêu dùng ngẫu nhiên + cap `localRatioCap`. |
| 6b | Hệ thống | Gửi `POST /api/units/bulk-attributes` với `updates[{id, customer_count, order_count}]`. |
| 7b | Hệ thống | Thành công: Swal “Phân bổ thành công!” và `location.reload()`. |

#### Nhánh quan trọng — Bulk Random Colors (đổi màu)

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1c | Admin | Nhấn “Tô màu ngẫu nhiên” → confirm. |
| 2c | Hệ thống | Với mỗi ô: chọn hue phân đều theo index, `color = randomPolygonColor(hue)`. |
| 3c | Hệ thống | Gọi `PUT /api/units/:id/color` cho từng id (Promise.all). |
| 4c | Hệ thống | Hoàn tất: Swal “Hoàn thành!” + reload. |

#### Nhánh quan trọng — Bulk Merge (gộp)

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1d | Admin | Chọn ≥2 ô → “Hợp nhất” → nhập `unitName`. |
| 2d | Hệ thống | `POST /api/units/merge` với ids + version_id. |
| 3d | Hệ thống | Reload và thoát bulk. |

**Hậu điều kiện**

- Dữ liệu cho nhiều polygons (khách/đơn/màu/geom…) được cập nhật theo action bulk.

**Module:** `public/map.js`, `public/map-api.js`, `routes/units.js`

---

## UC-03 — Tối ưu phân vùng (BGRASP)

### UC-RUN — Chạy thuật toán phân vùng (BGRASP)

| | |
|---|---|
| **Mã Use case** | UC-RUN |
| **Tên Use case** | Chạy thuật toán phân vùng (BGRASP) |
| **Tác nhân** | Admin |
| **Tiền điều kiện** | Đã chọn ít nhất 2 ô bằng checkbox `.dist-checkbox` trong danh sách dưới; có `currentVersionId`. |

#### Luồng sự kiện chính (Thành công)

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1 | Admin | Chọn các ô trong danh sách dưới (checkbox `.dist-checkbox`). |
| 2 | Admin | Nhấn **Phân chia vùng** → Swal nhập `p` (2..selected.length). |
| 3 | Hệ thống | Sinh `maxIterations = random(100..150)`. |
| 4 | Hệ thống | `POST /api/optimization/start` với payload `{ version_id, config:{ numRegions:p, maxIterations, lambda:0.5, selectedIds } }`. |
| 5 | Hệ thống | Route start: lock `versions.is_optimizing=TRUE`, rebuild adjacency, tạo `optimization_jobs`, spawn worker `grasp_worker.js`. |
| 6 | Hệ thống | UI nhận `jobId` → hiển thị loading → poll `GET /api/optimization/status/:jobId` mỗi 1s. |
| 7 | Hệ thống | Poll cập nhật `opt-progress` (`job.percent`) và `opt-msg` (`job.message`). |
| 8 | Hệ thống | Khi `status=done`: parse `job.message` (JSON) → `window.currentOptimOptions=resultObj.options` và set `window.currentJobId`. |
| 9 | Hệ thống | Gọi `showOptimizationOptions(0)` để preview option 0 bằng `previewOption(assignments)` (setStyle fillColor). |

#### Luồng sự kiện thay thế

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 2a | Admin | Chọn <2 ô → Swal “Vui lòng chọn ít nhất 2 ô”. |
| 4a | Hệ thống | Nếu response/message có dấu hiệu version đang khóa → Swal hỏi “Bỏ khóa & Thử lại” → gọi `POST /api/optimization/unlock`. |
| 7a | Hệ thống | job `error` → Swal hiển thị lỗi. |

**Hậu điều kiện**

- Có phương án tối ưu (options) cho Admin duyệt và áp dụng.
- Version bị khóa trong thời gian UC-RUN cho đến UC-APPLY/Discard/Unlock.

**Module:** `public/map-api.js`, `routes/optimization.js`, `optimization/grasp_worker.js`

---

### UC-APPLY — Áp dụng phương án tối ưu

| | |
|---|---|
| **Mã Use case** | UC-APPLY |
| **Tên Use case** | Áp dụng hoặc Hủy (Discard) phương án tối ưu |
| **Tác nhân** | Admin |
| **Tiền điều kiện** | UC-RUN xong và UI hiển thị preview option; `currentJobId` tồn tại. |

#### Luồng sự kiện chính (Thành công) — Apply

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1 | Admin | Chọn option preview (index) → nhấn **Áp dụng**. |
| 2 | Hệ thống | Hiện loading; gọi `POST /api/optimization/apply` với `{ jobId, optionIndex }`. |
| 3 | Hệ thống | Route apply: parse `optimization_jobs.message` → `assignments` (unitId → color). |
| 4 | Hệ thống | Bulk update `basic_units.color` theo assignments (bypass trigger overlap bằng `session_replication_role=replica`). |
| 5 | Hệ thống | Mở khóa version: `versions.is_optimizing=FALSE`. |
| 6 | Hệ thống | Commit + trigger autoDump; UI Swal success và `location.reload()`. |

#### Luồng sự kiện thay thế — Discard

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1b | Admin | Nhấn **Discard** (hoặc Hủy). |
| 2b | Hệ thống | `revertMapPreview()` khôi phục màu cũ; UI gọi `POST /api/optimization/discard`. |
| 3b | Hệ thống | Discard: set `is_optimizing=FALSE`, không ghi màu vào DB. |

#### Luồng sự kiện thay thế — Lỗi

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 2a | Hệ thống | Job không done/optionIndex sai → 500, Swal error. |

**Hậu điều kiện**

- Apply: DB phản ánh màu theo phân vùng BGRASP.
- Discard: DB không đổi, version mở khóa.

**Module:** `public/map-api.js`, `routes/optimization.js`, `js/autoDump.js`

---

## UC-05 — Driver

### UC-DRV_ZONE — Driver xem lãnh thổ được phân công (legacy)

| | |
|---|---|
| **Mã Use case** | UC-DRV_ZONE |
| **Tên Use case** | Driver xem lãnh thổ được phân công |
| **Tác nhân** | Driver |
| **Tiền điều kiện** | Đăng nhập `role=driver`. |

#### Luồng sự kiện chính (Hiện trạng trong code)

| STT | Thực hiện bởi | Hành động |
|:---:|---|---|
| 1 | Driver | Vào trang map. |
| 2 | Hệ thống | `public/map.js`: nếu `role !== 'admin'` thì gọi `window.loadMapData()` (không truyền `versionId`). |
| 3 | Hệ thống | `loadMapData`: URL tải units theo legacy `/api/units?driverId=...` (Backend hiện tập trung theo `versionId`, nên có thể sai/rỗng). |
| 4 | Hệ thống | Style driver dùng `driverId/districtColor` (legacy), nhưng dữ liệu `districts` đã bị xóa → có thể không khớp. |
| 5 | Driver | Có thể click polygon để xem thông tin theo UC-STAT. |

**Hậu điều kiện**

- Luồng Driver hiện là legacy (chưa đồng bộ với model “màu cụm” sau optimization).

**Module:** `public/map.js`, `routes/driver.js`, `routes/units.js`

---

## Phụ lục — UC `<<include>>` (không có actor riêng)

| Mã | Tên | Gọi từ UC | Hành động chính |
|----|-----|-----------|-----------------|
| UCS1 | Kiểm tra chồng lấn | UC-DRAW, UC-EDIT, UC-CUT | Chồng lấn >1% → từ chối |
| UCS2 | Tính diện tích & tâm | UC-DRAW, UC-EDIT, UC-CUT | Cập nhật `area_km2`, `centroid` |
| UCS3 | Sao lưu dữ liệu | UC-NEW/UC-APP/UC-DEL_VER/UC-DEL/UC-APPLY | `autoDump/pg_dump` → `database_dump.sql` |
| UCS4 | Khóa chỉnh sửa khi tối ưu | UC-RUN, UC-APPLY | `is_optimizing=true` → 423 |
| UCS5 | Worker BGRASP | UC-RUN | `grasp_worker.js` + cập nhật job |
| UCS10 | Split/Union PostGIS | UC-CUT | `ST_Split`, `ST_Union` |
| UCS11 | Đảm bảo 1 Applied/tỉnh | UC-APP | Transaction đổi `versions.status` |
| UCS13 | Xác thực SQL | UC-AUTH | `SELECT` bảng `users` |

