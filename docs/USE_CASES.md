# Tài liệu Use Case — Project_anti



Bộ tài liệu **3 tầng** — **Actor:** chỉ **Admin** và **Driver** (không dùng actor Hệ thống; xử lý tự động thể hiện bằng `<<include>>`).



---



## 1. Sơ đồ Use Case



| Tầng | File | Nội dung |

|------|------|----------|

| **Tổng quan** | [`USE_CASE_OVERVIEW.puml`](./USE_CASE_OVERVIEW.puml) | 6 UC cha: UC-00 … UC-05 |

| **Phân rã** | [`USE_CASE_DECOMPOSED.puml`](./USE_CASE_DECOMPOSED.puml) | UC con + include/extend (UC xám = include) |

| **Sơ đồ gộp** | [`USE_CASE_DIAGRAM.puml`](./USE_CASE_DIAGRAM.puml) | Bản layout đầy đủ (Admin, Driver) |



**Render PlantUML:** [plantuml.com](https://www.plantuml.com/plantuml) hoặc extension VS Code/Cursor.



---



## 2. Đặc tả Use Case



| Tài liệu | File |

|----------|------|

| **Đặc tả** (bảng STT \| Thực hiện bởi \| Hành động) | [`USE_CASE_SPECIFICATIONS.md`](./USE_CASE_SPECIFICATIONS.md) |



Trong đặc tả, cột **「Hệ thống」** = phần mềm/server thực hiện bước đó (**không** phải Actor UML).



---



## 3. Tóm tắt nhanh



### Actor



| Actor | Vai trò |

|--------|---------|

| **Admin** | Quản lý version, vùng, BGRASP, xem bản đồ |

| **Driver** | Đăng nhập, xem bản đồ & thống kê |



### UC tổng quan (6)



| ID | Tên | Actor |

|----|-----|-------|

| UC-00 | Xác thực | Admin, Driver |

| UC-01 | Quản lý phiên bản bản đồ | Admin |

| UC-02 | Quản lý vùng lãnh thổ | Admin |

| UC-03 | Tối ưu phân vùng (BGRASP) | Admin |

| UC-04 | Xem bản đồ & thống kê | Admin, Driver |

| UC-05 | Xem lãnh thổ (Driver) | Driver *(legacy)* |



### UC phân rã



- **UC-00:** UC-AUTH (+ include: Xác thực SQL)

- **UC-01:** UC-SEL, UC-NEW, UC-APP, UC-DEL_VER (+ include: Sao lưu, 1 Applied/tỉnh)

- **UC-02:** UC-DRAW, UC-EDIT, UC-ATTR, UC-CUT, UC-DEL, UC-BULK (+ include: Chồng lấn, Diện tích, PostGIS…)

- **UC-03:** UC-RUN, UC-APPLY (+ include: Khóa 423, Worker BGRASP)

- **UC-04:** UC-MAP, UC-STAT

- **UC-05:** UC-DRV_ZONE



Chi tiết → **USE_CASE_SPECIFICATIONS.md**.



---



## 4. Kiến trúc tham chiếu



| Thành phần | Đường dẫn |

|------------|-----------|

| Server | `js/server.js` |

| API | `routes/auth.js`, `hierarchy.js`, `units.js`, `optimization.js`, `driver.js` |

| UI | `public/auth.js`, `hierarchy.js`, `map.js`, `map-api.js`, `map-ui.js` |

| Thuật toán | `optimization/grasp_worker.js` |


