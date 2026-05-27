# KẾ HOẠCH TRIỂN KHAI CHỨC NĂNG PHÂN CÔNG VÙNG CHO TÀI XẾ

Tài liệu này mô tả logic và các bước cần thực hiện để bổ sung tính năng quản lý vùng hoạt động và gán tài xế vào bản đồ.

## 1. Chức năng cập nhật thông tin và chọn vùng hoạt động (Màn hình Tài xế)
**Mục tiêu:** Tài xế có thể tự cập nhật thông tin cá nhân và chọn tỉnh/thành phố (vùng hoạt động) mà mình đang làm việc để Admin có căn cứ phân công.

**Logic triển khai:**
*   **Cơ sở dữ liệu:** Tận dụng cột `province_id` đã có sẵn trong bảng `users` (dành cho role `driver`).
*   **Backend (API):**
    *   Tạo API lấy danh sách các Tỉnh/Thành phố hiện có trong hệ thống (đã có sẵn ở `/api/hierarchy/provinces`).
    *   Tạo API `PUT /api/driver/profile` cho phép tài xế cập nhật `full_name`, `password`, và đặc biệt là `province_id`.
*   **Frontend (Giao diện Tài xế):**
    *   Thêm một nút "Hồ sơ cá nhân" hoặc "Cài đặt" trên giao diện tài xế.
    *   Khi click sẽ mở ra một Modal (Popup) chứa form thông tin.
    *   Phần "Vùng hoạt động" sẽ là một Dropdown (Select) lấy dữ liệu động từ API danh sách Tỉnh/Thành phố. (Thiết kế dạng động giúp tương lai có thêm vùng như Đà Nẵng, Cần Thơ thì tự động hiện ra mà không cần sửa giao diện).

## 2. Chức năng Admin phân công tài xế vào vùng cụ thể (Màn hình Admin)
**Mục tiêu:** Admin có thể chọn thủ công một tài xế (thuộc vùng hoạt động đó) và gán cho một "Vùng" (Zone) cụ thể trên bản đồ sau khi đã chốt phương án phân chia. Mỗi tài xế chỉ được gán 1 vùng.

**Logic triển khai:**
*   **Cơ sở dữ liệu:** 
    *   Do bảng `districts` đã bị xóa, phương án tối ưu là thêm cột `driver_id` vào bảng `basic_units` (các ô đa giác).
    *   Khi gán 1 tài xế cho 1 "Vùng" (Vùng này gồm nhiều ô đa giác cùng màu), hệ thống sẽ cập nhật `driver_id` cho tất cả các ô đa giác thuộc vùng đó.
*   **Backend (API):**
    *   Tạo API `GET /api/auth/drivers?province_id=X`: Lấy danh sách các tài xế đang chọn vùng hoạt động là `province_id` này VÀ chưa được gán vào bất kỳ ô đa giác nào trong phiên bản `applied` hiện tại.
    *   Tạo API `POST /api/units/assign-driver`: Nhận vào `driver_id` và danh sách các `unit_id` (các ô đa giác thuộc 1 vùng) để cập nhật gán quyền.
*   **Frontend (Giao diện Admin):**
    *   Trong bảng "Thống kê Khu vực" (Stats Panel) hiện tại đang liệt kê Vùng 1, Vùng 2, Vùng 3... Thêm một cột hoặc nút "Gán Tài xế" bên cạnh mỗi Vùng.
    *   Khi Admin bấm "Gán", mở Popup hiển thị danh sách tài xế hợp lệ (từ API trên).
    *   Admin chọn 1 tài xế -> Gọi API gán.
    *   Hiển thị tên tài xế ngay trên bảng thống kê để Admin biết vùng nào đã có chủ, vùng nào chưa.

## 3. Hiển thị vùng được phân công nổi bật (Màn hình Tài xế)
**Mục tiêu:** Giúp tài xế dễ dàng nhận diện ranh giới công việc của mình bằng cách làm đậm vùng được giao và làm mờ các vùng khác của tỉnh.

**Logic triển khai:**
*   **Backend (API):**
    *   API `GET /api/units?driverId=X` hiện tại đang trả về toàn bộ ô đa giác của tỉnh. 
    *   Cần bổ sung logic: Trong quá trình map dữ liệu GeoJSON trả về, kiểm tra xem `driver_id` của từng ô có khớp với `driverId` đang request hay không. Nếu khớp, thêm một cờ `is_my_zone: true` vào `properties` của ô đó.
*   **Frontend (Giao diện Tài xế):**
    *   Trong file `map.js`, tại phần khai báo `style` cho `L.geoJSON` của tài xế.
    *   Viết điều kiện: 
        *   `if (feature.properties.is_my_zone === true)`: Cài đặt màu sắc nổi bật, viền dày (`weight: 3`), độ đậm màu cao (`fillOpacity: 0.8`).
        *   `else`: Cài đặt màu xám nhạt hoặc giữ nguyên màu nhưng độ mờ rất thấp (`fillOpacity: 0.15`), viền mỏng đứt nét để tài xế biết đó là khu vực của người khác.
    *   Có thể kết hợp thêm hàm `map.fitBounds()` chỉ tập trung zoom vào các ô có `is_my_zone = true` để tài xế vừa vào đã thấy ngay trung tâm khu vực của mình.

---
**Lưu ý:**
Kế hoạch này đảm bảo tính toàn vẹn của cấu trúc hiện tại (BGRASP, quy trình Applied của Admin) và hoàn toàn khả thi với cấu trúc Database đang có (chỉ cần thêm cột `driver_id` vào `basic_units`).