function saveUnitToDB(info, geometry, layer) {
  if (!window.currentVersionId) {
    Swal.fire("Lỗi", "Chưa chọn Phiên bản!", "error");
    layer.remove();
    return;
  }
  fetch("/api/units", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: info.name,
      geometry: geometry, // Tọa độ đa giác
      customer_count: info.customers,
      order_count: info.orders,
      color: info.color,
      version_id: window.currentVersionId,
    }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        Swal.fire("Thành công!", "Ô mới đã được lưu vào hệ thống.", "success");
        // Sau khi lưu xong thì reload bản đồ hoặc gán ID cho layer
        location.reload();
      } else {
        Swal.fire("Lỗi!", data.message, "error");
        if (layer) layer.remove();
      }
    })
    .catch((err) => {
      console.error(err);
      layer.remove();
    });
}

function updateUnitGeometry(id, geometry) {
  document.getElementById("loading-screen").style.display = "flex";

  fetch(`/api/units/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ geometry: geometry }), // Chỉ gửi geometry mới
  })
    .then((res) => res.json())
    .then((data) => {
      document.getElementById("loading-screen").style.display = "none";
      if (data.success) {
        Swal.fire("Thành công!", "Đã cập nhật vị trí mới.", "success");
      } else {
        Swal.fire("Lỗi!", data.message, "error");
      }
    })
    .catch((err) => {
      document.getElementById("loading-screen").style.display = "none";
      console.error(err);
    });
}

window.changeUnitColor = function (id) {
  const colorInput = document.getElementById(`colorPicker-${id}`);
  if (!colorInput) return;
  const newColor = colorInput.value;

  document.getElementById("loading-screen").style.display = "flex";
  fetch(`/api/units/${id}/color`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ color: newColor }),
  })
    .then((res) => res.json())
    .then((data) => {
      document.getElementById("loading-screen").style.display = "none";
      if (data.success) {
        Swal.fire({
          toast: true,
          position: "top-end",
          showConfirmButton: false,
          timer: 2000,
          icon: "success",
          title: "Đã cập nhật màu",
        });
        setTimeout(() => location.reload(), 1000); // Tải lại trang để thấy màu mới
      } else {
        Swal.fire("Lỗi", data.message || "Không thể đổi màu", "error");
      }
    })
    .catch((err) => {
      document.getElementById("loading-screen").style.display = "none";
      console.error(err);
    });
};

window.saveAdminAttributes = function (id) {
  const name = document.getElementById("edit-name").value;
  const customers =
    Number(document.getElementById("edit-customers").value) || 0;
  const orders = Number(document.getElementById("edit-orders").value) || 0;
  const color = document.getElementById("edit-color").value;

  document.getElementById("loading-screen").style.display = "flex";
  fetch(`/api/units/${id}/attributes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      customer_count: customers,
      order_count: orders,
      color,
    }),
  })
    .then((res) => res.json())
    .then((data) => {
      document.getElementById("loading-screen").style.display = "none";
      if (data.success) {
        Swal.fire({
          toast: true,
          position: "top-end",
          showConfirmButton: false,
          timer: 2000,
          icon: "success",
          title: "Đã lưu thuộc tính",
        });

        // Tìm đa giác trên bản đồ để cập nhật trực tiếp không cần tải lại trang
        map.eachLayer((layer) => {
          if (layer.options && layer.options.id == id && layer.feature) {
            // 1. Cập nhật dữ liệu bên trong layer
            layer.feature.properties.name = name;
            layer.feature.properties.customers = customers;
            layer.feature.properties.orders = orders;
            layer.feature.properties.color = color;
            layer.feature.properties.customer_count = customers;
            layer.feature.properties.order_count = orders;

            // 2. Cập nhật màu trên bản đồ
            layer.setStyle({
              fillColor: color || "#ccc",
            });

            // 3. Cập nhật lại giao diện Thống kê khu vực bên trái
            updateSidebarStats(layer.feature.properties);
          }
        });

        // 4. Đồng bộ dữ liệu vào danh sách in-memory phía dưới để tránh dùng dữ liệu cũ
        if (window.originalUnitsList) {
          const uIdx = window.originalUnitsList.findIndex(u => u.id == id);
          if (uIdx > -1) {
            window.originalUnitsList[uIdx].name = name;
            window.originalUnitsList[uIdx].customer_count = customers;
            window.originalUnitsList[uIdx].order_count = orders;
            window.originalUnitsList[uIdx].color = color;
          }
        }
        if (window.renderDistrictManagementList) {
          window.renderDistrictManagementList(window.originalUnitsList, true);
        }
      } else {
        Swal.fire("Lỗi", data.message || "Lỗi lưu dữ liệu", "error");
      }
    })
    .catch((err) => {
      document.getElementById("loading-screen").style.display = "none";
      console.error(err);
    });
};

window.districtEvals = {};

// Chế độ chọn đa giác để gộp/xóa
window.toggleBulkMode = function () {
  window.isBulkSelectMode = true;
  window.selectedUnitsList = [];

  // Đổi hiển thị nút
  document.getElementById("toggle-bulk-mode-btn").classList.add("active");
  document.getElementById("bulk-action-panel").style.display = "flex";
  document.getElementById("bulk-count").innerText = "0";

  Swal.fire({
    toast: true,
    position: "top-end",
    icon: "info",
    title:
      'Chế độ chọn đa giác. Click vào các ô để chọn, sau đó bấm "Nối Mảnh"!',
    showConfirmButton: false,
    timer: 3000,
  });
};

window.cancelBulkMode = function () {
  window.isBulkSelectMode = false;
  window.selectedUnitsList = [];

  // Tắt hiển thị
  document.getElementById("toggle-bulk-mode-btn").classList.remove("active");
  document.getElementById("bulk-action-panel").style.display = "none";

  // Xóa class marching-ants-path trên tất cả layer
  if (typeof map !== "undefined") {
    map.eachLayer((layer) => {
      if (
        layer.getElement &&
        layer.getElement() &&
        layer.getElement().classList.contains("marching-ants-path")
      ) {
        layer.getElement().classList.remove("marching-ants-path");
      }
    });
  }
};

window.currentSortBy = "default";
window.currentSortDirection = "desc";
window.originalUnitsList = [];

window.renderDistrictManagementList = async function (units, isSortingAction = false) {
  const currentU = typeof currentUser !== 'undefined' ? currentUser : (typeof checkLogin === 'function' ? checkLogin() : null);
  if (!currentU || currentU.role !== 'admin') {
    const panel = document.getElementById("bottom-management-panel");
    if (panel) {
      panel.style.display = "none";
      panel.classList.remove("active");
    }
    return;
  }

  const listDiv = document.getElementById("district-management-list");
  if (!listDiv) return;

  // Lấy danh sách tất cả các tỉnh để hiển thị thanh chọn (Tabs)
  let provinces = [];
  try {
    const res = await fetch("/api/hierarchy/provinces");
    const data = await res.json();
    if (data.success) provinces = data.data;
  } catch (e) {
    console.error("Lỗi tải tỉnh cho sidebar", e);
  }

  if (provinces.length === 0) {
    listDiv.innerHTML =
      '<p class="empty-msg">Chưa có dữ liệu Tỉnh/Thành phố.</p>';
    return;
  }

  const currentProvinceId = document.getElementById("province-select")?.value;

  // 1. Render Actions & Dropdown vào header (Thay thế Tabs)
  const actionDiv = document.getElementById("bottom-panel-actions");
  if (actionDiv) {
    let optionsHtml = provinces
      .map(
        (p) => `
            <option value="${p.id}" data-region="${p.region_id}" ${p.id == currentProvinceId ? "selected" : ""}>${p.name}</option>
        `,
      )
      .join("");

    actionDiv.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 12px; width: 100%; padding: 5px 0;">
                <!-- 1. Dropdown chọn Tỉnh -->
                <div class="custom-dropdown-container" style="width: 100%;">
                    <select id="bottom-province-selector" onchange="const opt = this.options[this.selectedIndex]; window.switchToProvince(this.value, opt.getAttribute('data-region'))">
                        <option value="">-- Chọn Tỉnh --</option>
                        ${optionsHtml}
                    </select>
                </div>
                
                <!-- 2. Nhóm 4 nút bấm chia thành 2 hàng đều nhau -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <button onclick="window.startOptimization()" class="btn-bulk-action btn-optimize" title="Phân chia vùng (BGRASP)" style="background-color: #e67e22; color: white;">
                        <i class="fa-solid fa-chart-pie"></i> Phân chia vùng
                    </button>
                    <button onclick="window.bulkRandomDistribute()" class="btn-bulk-action btn-distribute" title="Phân bổ số khách/đơn ngẫu nhiên cho các ô đã chọn">
                        <i class="fa-solid fa-shuffle"></i> Phân bổ
                    </button>
                    <button onclick="window.bulkRandomColors()" class="btn-bulk-action btn-color-random" title="Tô màu ngẫu nhiên cho các ô đã chọn">
                        <i class="fa-solid fa-palette"></i> Màu ngẫu nhiên
                    </button>
                    <button onclick="window.bulkDeleteUnits()" class="btn-bulk-action btn-red" style="background-color: #e74c3c; color: white;">
                        <i class="fa-solid fa-trash-can"></i> Xóa đã chọn
                    </button>
                </div>

                <!-- 3. Nút Chọn hết nằm dưới cùng -->
                <div style="display: flex; align-items: center; margin-top: 4px; padding-left: 2px;">
                    <label style="font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 8px; color: #444; font-weight: 600;">
                        <input type="checkbox" id="checkAllUnits" onchange="window.toggleAllUnits(this)" style="width: 18px; height: 18px; margin: 0;"> Chọn tất cả ô đa giác
                    </label>
                </div>
            </div>
        `;
  }

  // 2. Render danh sách ô đa giác dạng CỘT (Vertical)
  const activeProvince = provinces.find((p) => p.id == currentProvinceId);
  if (!activeProvince) {
    listDiv.innerHTML =
      '<p class="empty-msg">Vui lòng chọn một Vùng trên thanh công cụ.</p>';
    const sortContainer = document.getElementById("polygon-sort-container");
    if (sortContainer) sortContainer.style.display = "flex";
    return;
  }

  // Lưu trữ danh sách gốc khi gọi lần đầu hoặc khi nhận danh sách mới
  if (!isSortingAction) {
    window.originalUnitsList = units ? [...units] : [];
  }

  let displayUnits = [...window.originalUnitsList];

  // Luôn luôn hiển thị phần sắp xếp các ô đa giác
  const sortContainer = document.getElementById("polygon-sort-container");
  if (sortContainer) {
    sortContainer.style.display = "flex";
  }

  // Thực hiện sắp xếp
  if (window.currentSortBy && window.currentSortBy !== "default") {
    displayUnits.sort((a, b) => {
      let valA, valB;
      if (window.currentSortBy === "name") {
        valA = a.name || "";
        valB = b.name || "";
        return window.currentSortDirection === "asc"
          ? valA.localeCompare(valB, "vi", { sensitivity: "base" })
          : valB.localeCompare(valA, "vi", { sensitivity: "base" });
      } else if (window.currentSortBy === "orders") {
        valA = a.order_count ?? a.orders ?? 0;
        valB = b.order_count ?? b.orders ?? 0;
      } else if (window.currentSortBy === "customers") {
        valA = a.customer_count ?? a.customers ?? 0;
        valB = b.customer_count ?? b.customers ?? 0;
      } else if (window.currentSortBy === "density") {
        const custA = a.customer_count ?? a.customers ?? 0;
        const custB = b.customer_count ?? b.customers ?? 0;
        const ordA = a.order_count ?? a.orders ?? 0;
        const ordB = b.order_count ?? b.orders ?? 0;
        valA = custA > 0 ? ordA / custA : 0;
        valB = custB > 0 ? ordB / custB : 0;
      } else if (window.currentSortBy === "color") {
        valA = (a.color || "#cccccc").toLowerCase();
        valB = (b.color || "#cccccc").toLowerCase();
        return window.currentSortDirection === "asc"
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      }

      if (valA < valB) return window.currentSortDirection === "asc" ? -1 : 1;
      if (valA > valB) return window.currentSortDirection === "asc" ? 1 : -1;
      return 0;
    });
  } else {
    // Với "default" (mặc định), nếu chọn tăng dần thì đảo ngược thứ tự danh sách gốc
    if (window.currentSortDirection === "asc") {
      displayUnits.reverse();
    }
  }

  let html = `
        <div class="province-active-content">
            <div class="units-column-container">
                ${
                  displayUnits && displayUnits.length > 0
                    ? displayUnits
                        .map((u) => {
                          const color = u.color || "#cccccc";
                          const customers =
                            u.customer_count ?? u.customers ?? 0;
                          const orders = u.order_count ?? u.orders ?? 0;
                          return `
                        <div class="district-list-item horizontal-card" data-unit-id="${u.id}" onclick="window.highlightPolygonOnMap(${u.id})">
                            <div class="district-info">
                                 <input type="checkbox" class="dist-checkbox" value="${u.id}" ${window.selectedUnitsList && window.selectedUnitsList.includes(u.id) ? 'checked' : ''} style="width: 18px; height: 18px; cursor:pointer;" onchange="window.updateCheckAllState()">
                                <div class="district-color-box" style="background-color: ${color}; width: 24px; height: 24px; border-radius: 4px; flex-shrink:0;"></div>
                                <div class="unit-text-info">
                                    <span class="district-name-text">${u.name}</span>
                                    <div class="unit-stats-row">
                                        <span class="unit-stat-badge customers-badge" title="Khách hàng">
                                            <i class="fa-solid fa-users"></i> ${customers}
                                        </span>
                                        <span class="unit-stat-badge orders-badge" title="Đơn hàng">
                                            <i class="fa-solid fa-box"></i> ${orders}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div class="district-actions" onclick="event.stopPropagation()">
                                <button class="btn-edit-district" onclick="window.editUnitAttributes(${u.id})" title="Chỉnh sửa đầy đủ">
                                    <i class="fa-solid fa-pen-to-square"></i> Sửa
                                </button>
                                <button class="btn-edit-district delete-btn" onclick="window.deleteUnit(${u.id}, '${u.name.replace(/'/g, "\\'")}'  )" title="Xóa">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    `;
                        })
                        .join("")
                    : '<p class="empty-msg" style="padding: 20px; width: 100%;">Tỉnh này chưa có ô đa giác nào được tạo.</p>'
                }
            </div>
        </div>
    `;

  listDiv.innerHTML = html;

  // Nếu đã có dữ liệu danh sách thì tự động mở panel quản lý để người dùng thấy sort/nút ngay.
  const panel = document.getElementById("bottom-management-panel");
  if (panel && !panel.classList.contains("active")) {
    window.toggleBottomPanel(true);
  }
};

/**
 * Highlight thẻ card trong danh sách khi click polygon trên bản đồ.
 * Xóa highlight cũ, thêm class mới và scroll đến thẻ đó.
 */
window.highlightUnitCard = function (unitId) {
  // 1. Kiểm tra panel có đang mở không
  const panel = document.getElementById("bottom-management-panel");
  if (!panel || !panel.classList.contains("active")) return;

  // 2. Xóa highlight của tất cả card trước
  document
    .querySelectorAll(".horizontal-card.unit-card-highlighted")
    .forEach((el) => {
      el.classList.remove("unit-card-highlighted");
    });

  // 3. Tìm card theo data-unit-id
  const card = document.querySelector(
    `.horizontal-card[data-unit-id="${unitId}"]`,
  );
  if (!card) return;

  // 4. Thêm class highlight
  card.classList.add("unit-card-highlighted");

  // 5. Scroll danh sách đến card đó (smooth)
  const listDiv = document.getElementById("district-management-list");
  if (listDiv) {
    const cardTop = card.offsetTop - listDiv.offsetTop;
    listDiv.scrollTo({ top: cardTop - 20, behavior: "smooth" });
  } else {
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
};

/**
 * Click từ card danh sách -> Highlight ngược lên bản đồ
 */
window.highlightPolygonOnMap = function (unitId) {
  if (typeof map === "undefined" || !window.geoJsonLayer) return;

  let targetLayer = null;
  window.geoJsonLayer.eachLayer((layer) => {
    if (layer.options && layer.options.id == unitId) {
      targetLayer = layer;
    }
  });

  if (targetLayer) {
    // 1. Zoom đến đa giác (nếu không đang trong tầm nhìn)
    map.fitBounds(targetLayer.getBounds(), { padding: [50, 50], maxZoom: 11 });

    // 2. Kích hoạt sự kiện click giả lập để hiện panel thông tin
    // Lưu ý: targetLayer.fire('click') sẽ chạy logic trong map.js
    targetLayer.fire("click");

    // 3. Highlight card chính nó (đã có hàm highlightUnitCard gọi từ click event trong map.js)
  }
};

// Hàm sửa nhanh thuộc tính Unit từ list
window.editUnitAttributes = function (id) {
  // Tìm layer tương ứng để lấy data hiện tại
  let unitData = null;
  map.eachLayer((layer) => {
    if (layer.options && layer.options.id == id && layer.feature) {
      unitData = layer.feature.properties;
    }
  });

  if (!unitData) return;

  Swal.fire({
    title: "Sửa thông tin ô",
    html: `
            <input type="text" id="swal-unit-name" class="swal2-input" value="${unitData.name}" placeholder="Tên ô...">
            <input type="number" id="swal-unit-customers" class="swal2-input" value="${unitData.customers || 0}" placeholder="Số khách...">
            <input type="number" id="swal-unit-orders" class="swal2-input" value="${unitData.orders || 0}" placeholder="Số đơn...">
            <div style="margin-top:10px;">
                <label>Màu sắc:</label>
                <input type="color" id="swal-unit-color" value="${unitData.color || "#cccccc"}" style="width:100%; height:40px;">
            </div>
        `,
    showCancelButton: true,
    confirmButtonText: "Lưu",
    preConfirm: () => {
      return {
        name: document.getElementById("swal-unit-name").value,
        customers: document.getElementById("swal-unit-customers").value,
        orders: document.getElementById("swal-unit-orders").value,
        color: document.getElementById("swal-unit-color").value,
      };
    },
  }).then((result) => {
    if (result.isConfirmed) {
      const { name, customers, orders, color } = result.value;
      // Gọi API update attributes (đã có sẵn trong map-api.js)
      // Mocking the inputs for saveAdminAttributes
      const oldName = document.getElementById("edit-name");
      const oldCust = document.getElementById("edit-customers");
      const oldOrd = document.getElementById("edit-orders");
      const oldCol = document.getElementById("edit-color");

      // Temporary set values to use existing saveAdminAttributes function or just fetch direct
      fetch(`/api/units/${id}/attributes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          customer_count: customers,
          order_count: orders,
          color,
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            Swal.fire("Thành công", "Đã cập nhật ô", "success").then(() =>
              location.reload(),
            );
          } else {
            Swal.fire("Lỗi", data.message, "error");
          }
        });
    }
  });
};

window.deleteUnit = function (id, name) {
  Swal.fire({
    title: `Xóa ô "${name}"?`,
    text: "Dữ liệu sẽ bị xóa vĩnh viễn khỏi bản đồ!",
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#d33",
    confirmButtonText: "Đồng ý xóa",
  }).then((result) => {
    if (result.isConfirmed) {
      fetch(`/api/units/${id}`, { method: "DELETE" })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            Swal.fire("Đã xóa!", "", "success").then(() => location.reload());
          } else {
            Swal.fire("Lỗi!", data.message, "error");
          }
        });
    }
  });
};

window.bulkDeleteUnits = function () {
  const selected = Array.from(
    document.querySelectorAll(".dist-checkbox:checked"),
  ).map((cb) => parseInt(cb.value));
  if (selected.length === 0)
    return Swal.fire("Thông báo", "Chọn ít nhất 1 ô để xóa", "info");

  Swal.fire({
    title: `Xóa ${selected.length} ô đã chọn?`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#d33",
    confirmButtonText: "Xóa tất cả",
  }).then((result) => {
    if (result.isConfirmed) {
      // Cần API bulk delete units hoặc gọi loop (tốt nhất là bulk)
      // Hiện tại chưa có API bulk delete units, tôi sẽ gọi loop hoặc báo người dùng
      Swal.fire("Đang xử lý...", "", "info");
      Promise.all(
        selected.map((id) =>
          fetch(`/api/units/${id}`, { method: "DELETE" }).then((r) => r.json()),
        ),
      ).then(() => {
        Swal.fire("Thành công", `Đã xóa ${selected.length} ô`, "success").then(
          () => location.reload(),
        );
      });
    }
  });
};

// Hàm bổ trợ để chuyển nhanh tỉnh từ sidebar
window.switchToProvince = function (provinceId, regionId) {
  const regionSelect = document.getElementById("region-select");
  const provinceSelect = document.getElementById("province-select");

  if (regionSelect && regionId) {
    regionSelect.value = regionId;
    // Kích hoạt loadProvinces và sau đó set provinceId
    window.loadProvinces().then(() => {
      provinceSelect.value = provinceId;
      window.loadVersions();
    });
  }
};

window.toggleAllUnits = function (source) {
  const checkboxes = document.querySelectorAll(".dist-checkbox");
  checkboxes.forEach((cb) => (cb.checked = source.checked));
};

window.updateCheckAllState = function () {
  const checkboxes = document.querySelectorAll(".dist-checkbox");
  const checkAll = document.getElementById("checkAllUnits");
  if (!checkAll) return;
  const allChecked = Array.from(checkboxes).every((cb) => cb.checked);
  const someChecked = Array.from(checkboxes).some((cb) => cb.checked);
  checkAll.checked = allChecked;
  checkAll.indeterminate = someChecked && !allChecked;
};

// ============================================================
// PHÂN BỔ NGẪU NHIÊN & TÔ MÀU NGẪU NHIÊN CHO NHIỀU Ô
// ============================================================

/**
 * Chia ngẫu nhiên `total` thành `n` phần nguyên không âm có tổng = total.
 * Dùng "stars and bars" với n-1 điểm cắt ngẫu nhiên.
 */
function randomSplit(total, n) {
  total = Math.max(0, parseInt(total) || 0);
  if (n <= 0) return [];
  if (n === 1) return [total];
  if (total === 0) return Array(n).fill(0);
  const cuts = [];
  for (let i = 0; i < n - 1; i++)
    cuts.push(Math.floor(Math.random() * (total + 1)));
  cuts.sort((a, b) => a - b);
  const result = [];
  let prev = 0;
  for (const c of cuts) {
    result.push(c - prev);
    prev = c;
  }
  result.push(total - prev);
  return result;
}

/**
 * Chia `total` thành `n` phần có tổng = total, dựa trên trọng số diện tích,
 * ràng buộc [minPct%, maxPct%] mỗi ô, với biến động ±variation%.
 * Dùng "largest remainder" để đảm bảo tổng nguyên chính xác.
 */
function constrainedWeightedSplit(
  total,
  n,
  areas,
  minPct,
  maxPct,
  variationPct,
) {
  total = Math.max(0, parseInt(total) || 0);
  if (n <= 0) return [];
  if (total === 0) return Array(n).fill(0);

  // TẠO TRỌNG SỐ THỰC TẾ: Sử dụng hàm lũy thừa (Power Law) để tạo ra sự chênh lệch cực lớn.
  // Một vài ô sẽ nhận trọng số rất cao (điểm nóng), trong khi đa số nhận trọng số thấp.
  const densityModifiers = Array(n)
    .fill(0)
    .map(() => Math.pow(Math.random(), 3) * 20 + 0.1);

  const rawWeights = areas.map((a, i) => (a || 1) * densityModifiers[i]);
  const totalRawWeight = rawWeights.reduce((s, w) => s + w, 0);
  const weights = rawWeights.map((w) => w / totalRawWeight);

  // Tính giá trị min/max tuyệt đối cho mỗi ô
  const minVal = Math.max(0, Math.floor((total * minPct) / 100));
  const maxVal = Math.floor((total * maxPct) / 100);

  // Đảm bảo min <= max và n * min <= total
  const effMin = Math.min(minVal, Math.floor(total / n));
  const effMax = Math.max(maxVal, Math.ceil(total / n));

  // Sinh phân phối dựa trên trọng số đã được làm lệch
  let floats = weights.map((w) => {
    const base = total * w;
    return Math.max(effMin, Math.min(effMax, base));
  });

  // Scale để tổng float = total, rồi floor
  const sumF = floats.reduce((s, v) => s + v, 0);
  floats = floats.map((v) => (v * total) / (sumF || 1));
  let ints = floats.map(Math.floor);
  let remainder = total - ints.reduce((s, v) => s + v, 0);

  // Phân bổ phần lẻ cho các ô có phần thập phân lớn nhất (largest remainder)
  // Không dùng k%n để tránh cộng trùng vào cùng 1 ô khi remainder > n
  const fracs = floats
    .map((v, i) => ({ i, f: v - ints[i] }))
    .sort((a, b) => b.f - a.f);
  for (let k = 0; k < remainder && k < n; k++) ints[fracs[k].i]++;

  // Áp ràng buộc [effMin, effMax] sau rounding
  ints = ints.map((v) => Math.max(effMin, Math.min(effMax, v)));

  // Bù chênh lệch (diff) cho đến khi tổng = total chính xác
  // Dùng while thay for để xử lý mọi mức diff, không giới hạn n lần
  let diff = total - ints.reduce((s, v) => s + v, 0);
  const sorted = [...Array(n).keys()].sort((a, b) => ints[b] - ints[a]);
  let safetyLimit = n * 2; // tránh vòng vô tận
  let k = 0;
  while (diff !== 0 && safetyLimit-- > 0) {
    const idx = sorted[k % n];
    if (diff > 0 && ints[idx] < effMax) {
      ints[idx]++;
      diff--;
    } else if (diff < 0 && ints[idx] > effMin) {
      ints[idx]--;
      diff++;
    }
    k++;
  }

  // Đảm bảo tổng cuối cùng bằng total, force vào ô lớn nhất nếu vẫn lệch
  const finalSum = ints.reduce((s, v) => s + v, 0);
  if (finalSum !== total) {
    ints[sorted[0]] += total - finalSum;
  }

  return ints;
}

/** Lấy diện tích (area_km2) của một danh sách unitId từ layer GeoJSON đang hiển thị */
function getUnitAreas(ids) {
  const areaMap = {};
  if (window.geoJsonLayer) {
    window.geoJsonLayer.eachLayer((layer) => {
      const f = layer.feature;
      if (!f) return;
      const uid = f.id || f.properties?.id;
      if (uid !== undefined && ids.includes(parseInt(uid))) {
        areaMap[parseInt(uid)] = parseFloat(f.properties?.area) || 0;
      }
    });
  }
  return ids.map((id) => areaMap[id] || 0);
}

/** Phân bổ tổng khách + tổng đơn có ràng buộc min/max cho các ô đã chọn */
window.bulkRandomDistribute = async function () {
  const selected = Array.from(
    document.querySelectorAll(".dist-checkbox:checked"),
  ).map((cb) => parseInt(cb.value));
  if (selected.length === 0) {
    return Swal.fire(
      "Thông báo",
      "Vui lòng chọn ít nhất 1 ô để phân bổ.",
      "info",
    );
  }

  const n = selected.length;
  // Giới hạn mặc định
  const defaultMin = n === 1 ? 0 : 5;
  const defaultMax = n === 1 ? 100 : 50;

  const { value: formValues, isConfirmed } = await Swal.fire({
    title: `<i class="fa-solid fa-shuffle" style="color:#3085d6"></i> Phân bổ thông minh`,
    width: 520,
    html: `
            <p style="font-size:13px;color:#666;margin-bottom:14px;">
                Phân bổ <b>mật độ không đồng nhất</b> (tạo điểm nóng ngẫu nhiên) cho <b>${n} ô</b>.
            </p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
                <div style="text-align:left;">
                    <label style="font-size:12px;font-weight:600;color:#444;"><i class="fa-solid fa-users"></i> Tổng Khách hàng</label>
                    <input id="bd-customers" type="number" class="swal2-input" placeholder="VD: 500" min="0" style="margin:4px 0;width:100%;font-size:13px;">
                </div>
                <div style="text-align:left;">
                    <label style="font-size:12px;font-weight:600;color:#444;"><i class="fa-solid fa-box"></i> Tổng Đơn hàng</label>
                    <input id="bd-orders" type="number" class="swal2-input" placeholder="VD: 300" min="0" style="margin:4px 0;width:100%;font-size:13px;">
                </div>
            </div>
            <div style="background:#f8f9fa;border-radius:8px;padding:10px;margin-top:4px;">
                <p style="font-size:12px;font-weight:700;color:#555;margin:0 0 8px 0;"><i class="fa-solid fa-sliders"></i> Ràng buộc mỗi ô</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div style="text-align:left;">
                        <label style="font-size:12px;color:#666;">Tối thiểu mỗi ô (%)</label>
                        <input id="bd-min-pct" type="number" class="swal2-input" value="${defaultMin}" min="0" max="50" style="margin:4px 0;width:100%;font-size:13px;" title="Mỗi ô nhận ít nhất n% tổng số">
                        <span style="font-size:11px;color:#999;">≥ n% tổng (tránh ô trống)</span>
                    </div>
                    <div style="text-align:left;">
                        <label style="font-size:12px;color:#666;">Tối đa mỗi ô (%)</label>
                        <input id="bd-max-pct" type="number" class="swal2-input" value="${defaultMax}" min="10" max="100" style="margin:4px 0;width:100%;font-size:13px;" title="Mỗi ô không vượt quá n% tổng">
                        <span style="font-size:11px;color:#999;">≤ n% tổng (tránh quá tải)</span>
                    </div>
                </div>
            </div>
        `,
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-shuffle"></i> Phân bổ ngay',
    cancelButtonText: "Hủy",
    confirmButtonColor: "#3085d6",
    focusConfirm: false,
    preConfirm: () => {
      const customers =
        parseInt(document.getElementById("bd-customers").value) || 0;
      const orders = parseInt(document.getElementById("bd-orders").value) || 0;
      const minPct =
        parseFloat(document.getElementById("bd-min-pct").value) || 0;
      const maxPct =
        parseFloat(document.getElementById("bd-max-pct").value) || 100;

      if (orders < customers) {
        Swal.showValidationMessage(
          "⚠️ Số đơn không được nhỏ hơn số khách (mỗi khách có ít nhất 1 đơn)",
        );
        return false;
      }
      if (minPct >= maxPct) {
        Swal.showValidationMessage("⚠️ % Tối thiểu phải nhỏ hơn % Tối đa");
        return false;
      }
      if (n * minPct > 100) {
        Swal.showValidationMessage(
          `⚠️ Với ${n} ô, % tối thiểu tối đa là ${Math.floor(100 / n)}%`,
        );
        return false;
      }
      return { customers, orders, minPct, maxPct };
    },
  });

  if (!isConfirmed) return;

  const {
    customers: totalCustomers,
    orders: totalOrders,
    minPct,
    maxPct,
  } = formValues;

  // Lấy diện tích từ layer GeoJSON đang tải trên bản đồ
  const areas = getUnitAreas(selected);
  const hasAreaData = areas.some((a) => a > 0);

  let customerSplit, orderSplit;

  if (hasAreaData) {
    // Phân bổ theo diện tích + ràng buộc min/max + biến động ±20%
    customerSplit = constrainedWeightedSplit(
      totalCustomers,
      n,
      areas,
      minPct,
      maxPct,
      20,
    );
  } else {
    // Fallback: không có data diện tích, dùng randomSplit với clamp
    customerSplit = constrainedWeightedSplit(
      totalCustomers,
      n,
      Array(n).fill(1),
      minPct,
      maxPct,
      30,
    );
  }

  // PHÂN BỔ ĐƠN HÀNG CÓ RÀNG BUỘC THỰC TẾ (Dựa trực tiếp trên lượng khách đã chia)
  // 1. Tính tỷ lệ đơn hàng trung bình trên mỗi khách hàng từ input
  const globalAvgRatio = totalOrders / (totalCustomers || 1);

  // 2. Xác định ngưỡng trần thực tế (không quá 3.5 lần trung bình và tối đa 15 đơn/khách)
  // Điều này ngăn chặn trường hợp có ô cực ít khách nhưng gánh cả ngàn đơn
  const localRatioCap = Math.max(globalAvgRatio * 3.5, 15);

  // 3. Tạo hệ số tiêu dùng ngẫu nhiên để tạo ra sự khác biệt giữa các vùng (0.6x đến 2.5x)
  const consumptionModifiers = Array(n)
    .fill(0)
    .map(() => Math.random() * 1.9 + 0.6);

  // Tính trọng số chia đơn hàng dựa trên SỐ KHÁCH HÀNG của ô đó nhân với hệ số tiêu dùng
  const rawOrderWeights = customerSplit.map(
    (c, i) => (c || 1) * consumptionModifiers[i],
  );
  const totalRawOrderWeight = rawOrderWeights.reduce((s, w) => s + w, 0);

  orderSplit = rawOrderWeights.map((w, i) => {
    let val = Math.round((w / totalRawOrderWeight) * totalOrders);
    const c = customerSplit[i] || 1;
    // Áp dụng ràng buộc: Mỗi khách có ít nhất 1 đơn, và tỷ lệ không vượt quá localRatioCap
    return Math.max(c, Math.min(val, Math.round(c * localRatioCap)));
  });

  // 4. Bù trừ sai số tổng đơn hàng (do làm tròn và áp dụng Cap)
  let currentTotalOrders = orderSplit.reduce((a, b) => a + b, 0);
  let diffOrders = totalOrders - currentTotalOrders;

  if (diffOrders > 0) {
    // Thiếu đơn: Ưu tiên cộng vào ô chưa chạm mốc Cap để tránh phi lý
    let safetyLimit = diffOrders * 3;
    while (diffOrders > 0 && safetyLimit-- > 0) {
      let bestIdx = -1;
      let minRatio = Infinity;
      for (let i = 0; i < n; i++) {
        let ratio = orderSplit[i] / (customerSplit[i] || 1);
        if (ratio < localRatioCap && ratio < minRatio) {
          minRatio = ratio;
          bestIdx = i;
        }
      }
      if (bestIdx === -1) bestIdx = Math.floor(Math.random() * n);
      orderSplit[bestIdx]++;
      diffOrders--;
    }
  } else if (diffOrders < 0) {
    // Thừa đơn: Ưu tiên trừ ở ô có tỷ lệ đơn/khách đang cao nhất
    let safetyLimit = Math.abs(diffOrders) * 3;
    while (diffOrders < 0 && safetyLimit-- > 0) {
      let maxIdx = -1;
      let maxRatio = -Infinity;
      for (let i = 0; i < n; i++) {
        let ratio = orderSplit[i] / (customerSplit[i] || 1);
        if (orderSplit[i] > customerSplit[i] && ratio > maxRatio) {
          maxRatio = ratio;
          maxIdx = i;
        }
      }
      if (maxIdx === -1) break;
      orderSplit[maxIdx]--;
      diffOrders++;
    }
  }

  const updates = selected.map((id, i) => ({
    id,
    customer_count: customerSplit[i],
    order_count: orderSplit[i],
  }));

  document.getElementById("loading-screen").style.display = "flex";
  fetch("/api/units/bulk-attributes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  })
    .then((r) => r.json())
    .then((data) => {
      document.getElementById("loading-screen").style.display = "none";
      if (data.success) {
        const strategyNote = hasAreaData
          ? " (theo diện tích)"
          : " (ngẫu nhiên đều)";
        Swal.fire({
          icon: "success",
          title: "Phân bổ thành công!",
          html: `Tổng <b>${totalCustomers}</b> khách và <b>${totalOrders}</b> đơn đã được chia${strategyNote} cho <b>${n}</b> ô.<br><small style="color:#999">Min: ${minPct}% · Max: ${maxPct}% · Biến động: ±20%</small>`,
          timer: 3000,
          showConfirmButton: false,
        }).then(() => location.reload());
      } else {
        Swal.fire("Lỗi", data.message, "error");
      }
    })
    .catch((err) => {
      document.getElementById("loading-screen").style.display = "none";
      Swal.fire("Lỗi", err.message, "error");
    });
};

window.startOptimization = async function () {
  if (!window.currentVersionId) {
    return Swal.fire("Lỗi", "Chưa chọn phiên bản!", "error");
  }

  const selected = Array.from(
    document.querySelectorAll(".dist-checkbox:checked"),
  ).map((cb) => parseInt(cb.value));
  if (selected.length < 2) {
    return Swal.fire(
      "Thông báo",
      "Vui lòng chọn ít nhất 2 ô đa giác trong danh sách để phân chia vùng.",
      "info",
    );
  }

  const { value: p } = await Swal.fire({
    title: "Cấu hình thuật toán BGRASP",
    html: `
            <div style="text-align:center; font-size:15px; margin-top: 10px;">
                <label style="font-weight: bold; display: block; margin-bottom: 10px;">Số vùng cần phân chia (p):</label>
                <input id="opt-p" type="number" class="swal2-input" value="2" min="2" max="${selected.length}" style="width: 150px; text-align: center; margin: 0 auto;">
                <p style="font-size: 13px; color: #666; margin-top: 15px;">Đang chọn <b>${selected.length}</b> đa giác để phân chia.</p>
            </div>
        `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonColor: "#8b5cf6", // Matching the purple from screenshot
    confirmButtonText: "Bắt đầu",
    cancelButtonText: "Cancel",
    preConfirm: () => {
      const val = parseInt(document.getElementById("opt-p").value);
      if (!val || val < 2 || val > selected.length) {
        Swal.showValidationMessage(`Số vùng phải từ 2 đến ${selected.length}`);
        return false;
      }
      return val;
    },
  });

  if (!p) return;

  // Số vòng lặp ngẫu nhiên từ 100 đến 150
  const maxIterations = Math.floor(Math.random() * (150 - 100 + 1)) + 100;

  document.getElementById("loading-screen").style.display = "flex";
  try {
    const res = await fetch("/api/optimization/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version_id: window.currentVersionId,
        config: {
          numRegions: p,
          maxIterations: maxIterations,
          lambda: 0.5,
          selectedIds: selected,
        },
      }),
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById("loading-screen").style.display = "none";
      Swal.fire({
        title: "Đang chạy thuật toán",
        html: 'Tiến độ: <b id="opt-progress">0%</b><br><span id="opt-msg">Đang khởi tạo...</span>',
        allowOutsideClick: false,
        showConfirmButton: false,
        didOpen: () => {
          Swal.showLoading();
          const progressInterval = setInterval(async () => {
            const sRes = await fetch(`/api/optimization/status/${data.jobId}`);
            const sData = await sRes.json();
            if (sData.success) {
              const job = sData.job;
              document.getElementById("opt-progress").innerText =
                job.percent + "%";
              document.getElementById("opt-msg").innerText = job.message;
              if (job.status === "done") {
                clearInterval(progressInterval);
                window._isComparingOptions = false;

                try {
                  const resultObj = JSON.parse(job.message);
                  window.currentOptimOptions = resultObj.options;
                  window.currentJobId = data.jobId;
                  window.showOptimizationOptions(0);
                } catch (err) {
                  console.error("Lỗi parse kết quả tối ưu:", err);
                  Swal.fire("Lỗi", "Không thể phân tích dữ liệu kết quả từ server.", "error");
                }
              } else if (job.status === "error") {
                clearInterval(progressInterval);
                Swal.fire("Lỗi", job.message, "error");
              }
            }
          }, 1000);
        },
      });
    } else {
      document.getElementById("loading-screen").style.display = "none";
      if (data.message && (data.message.includes("đang được tối ưu hóa") || data.message.includes("bị khoá"))) {
        Swal.fire({
          title: "Phiên bản đang bị khoá",
          text: "Tiến trình trước đó có thể đã bị gián đoạn (do mất kết nối hoặc đóng trang). Bạn có muốn bỏ khoá để tiếp tục không?",
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: "Bỏ khoá & Thử lại",
          cancelButtonText: "Đóng"
        }).then(async (result) => {
          if (result.isConfirmed) {
            try {
              const unlockRes = await fetch("/api/optimization/unlock", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ version_id: window.currentVersionId })
              });
              const unlockData = await unlockRes.json();
              if (unlockData.success) {
                Swal.fire("Thành công", "Đã bỏ khoá! Vui lòng bấm 'Phân chia vùng' lại.", "success");
              } else {
                Swal.fire("Lỗi", unlockData.message, "error");
              }
            } catch (e) {
              Swal.fire("Lỗi", "Không thể bỏ khoá: " + e.message, "error");
            }
          }
        });
      } else {
        Swal.fire("Lỗi", data.message, "error");
      }
    }
  } catch (e) {
    document.getElementById("loading-screen").style.display = "none";
    Swal.fire("Lỗi", e.message, "error");
  }
};

// --- BGRASP Multi-Option Preview & Apply Helpers ---
window.originalMapColors = {};

window.previewOption = function (assignments) {
  if (!window.geoJsonLayer) return;
  
  // Cache original colors if not cached yet
  if (!window.originalMapColors || Object.keys(window.originalMapColors).length === 0) {
    window.originalMapColors = {};
    window.geoJsonLayer.eachLayer(l => {
      const uid = String(l.options.id);
      window.originalMapColors[uid] = l.options.fillColor || '#ccc';
    });
  }

  window.geoJsonLayer.eachLayer(l => {
    const uid = String(l.options.id);
    if (assignments && assignments[uid]) {
      const color = assignments[uid];
      l.setStyle({
        fillColor: color,
        color: "#1e1b4b", // premium dark border
        weight: 2.5,      // slightly thicker for preview
        fillOpacity: 0.7  // higher contrast
      });
    }
  });
};

window.revertMapPreview = function () {
  if (!window.geoJsonLayer || !window.originalMapColors || Object.keys(window.originalMapColors).length === 0) return;
  window.geoJsonLayer.eachLayer(l => {
    const uid = String(l.options.id);
    const origColor = window.originalMapColors[uid] || '#ccc';
    l.setStyle({
      fillColor: origColor,
      color: "#333",
      weight: 2,
      fillOpacity: 0.5
    });
  });
};

window.applyOption = async function (jobId, optionIndex) {
  document.getElementById("loading-screen").style.display = "flex";
  try {
    const res = await fetch("/api/optimization/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, optionIndex })
    });
    const data = await res.json();
    document.getElementById("loading-screen").style.display = "none";
    if (data.success) {
      window.originalMapColors = {}; // Clear cache
      Swal.fire({
        icon: "success",
        title: "Đã áp dụng!",
        text: data.message,
        timer: 1500,
        showConfirmButton: false
      }).then(() => {
        location.reload();
      });
    } else {
      Swal.fire("Lỗi", data.message, "error");
    }
  } catch (err) {
    document.getElementById("loading-screen").style.display = "none";
    Swal.fire("Lỗi", err.message, "error");
  }
};

window.discardOptimization = async function (jobId) {
  window.revertMapPreview();
  window.originalMapColors = {}; // Clear cache
  
  try {
    await fetch("/api/optimization/discard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId })
    });
  } catch (err) {
    console.error("Lỗi khi hủy bỏ tối ưu:", err.message);
  }
};

window.showOptimizationOptions = function (idx) {
  const options = window.currentOptimOptions;
  const jobId = window.currentJobId;
  const opt = options[idx];
  
  // Trực quan hóa xem thử ngay lập tức trên bản đồ
  window.previewOption(opt.assignments);
  
  // Tạo thanh tab các phương án
  let tabsHtml = `
    <div style="display: flex; gap: 8px; justify-content: space-between; border-bottom: 2px solid #f1f5f9; margin-bottom: 18px; padding-bottom: 8px;">
  `;
  options.forEach((o, i) => {
    const isActive = i === idx;
    const activeStyle = isActive 
      ? 'background: linear-gradient(135deg, #8b5cf6, #6d28d9); color: white; box-shadow: 0 4px 10px rgba(139, 92, 246, 0.3); font-weight: bold;' 
      : 'background-color: #f8fafc; color: #64748b; border: 1px solid #e2e8f0; cursor: pointer;';
    const icons = ['fa-shapes', 'fa-scale-balanced', 'fa-users'];
    tabsHtml += `
      <button onclick="window.showOptimizationOptions(${i})" style="flex: 1; padding: 10px 8px; font-size: 13px; border-radius: 8px; transition: all 0.2s; border: none; outline: none; ${activeStyle}">
        <i class="fa-solid ${icons[i]}" style="margin-right: 5px;"></i> PA ${i+1}
      </button>
    `;
  });
  tabsHtml += `</div>`;
  
  // Bảng phân tích chi tiết vùng
  let zonesTableHtml = `
    <div style="max-height: 180px; overflow-y: auto; margin-top: 12px; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);">
      <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; font-family: inherit;">
        <thead style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; z-index: 1;">
          <tr>
            <th style="padding: 10px; font-weight: 600; color: #475569;">Vùng</th>
            <th style="padding: 10px; text-align: center; font-weight: 600; color: #475569;">Số ô đa giác</th>
            <th style="padding: 10px; text-align: center; font-weight: 600; color: #475569;">Khách hàng</th>
            <th style="padding: 10px; text-align: center; font-weight: 600; color: #475569;">Đơn hàng</th>
          </tr>
        </thead>
        <tbody>
  `;
  
  opt.summary.forEach((zone, zIdx) => {
    zonesTableHtml += `
      <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
        <td style="padding: 8px 10px; display: flex; align-items: center; font-weight: 500;">
          <span style="display: inline-block; width: 12px; height: 12px; background-color: ${zone.color}; border-radius: 50%; margin-right: 8px; border: 1px solid rgba(0,0,0,0.15);"></span>
          Vùng ${zIdx + 1}
        </td>
        <td style="padding: 8px 10px; text-align: center; color: #64748b;">${zone.polygonCount}</td>
        <td style="padding: 8px 10px; text-align: center; font-weight: 600; color: #1e293b;">${zone.customerCount}</td>
        <td style="padding: 8px 10px; text-align: center; color: #64748b;">${zone.orderCount}</td>
      </tr>
    `;
  });
  zonesTableHtml += `
        </tbody>
      </table>
    </div>
  `;
  
  // Định cấu hình chỉ số tải trọng và độ gọn
  const cvVal = opt.metrics.cv || 0;
  const maxDevVal = opt.metrics.maxDevPercent || 0;
  const cvColor = cvVal < 10 ? '#10b981' : (cvVal < 20 ? '#f59e0b' : '#ef4444');
  const compactnessRating = idx === 0 ? 'Tối đa (Hình gọn/tròn)' : (idx === 1 ? 'Cân bằng' : 'Thấp (Hơi kéo dài)');
  const compactnessColor = idx === 0 ? '#10b981' : (idx === 1 ? '#6366f1' : '#f59e0b');

  const contentHtml = `
    ${tabsHtml}
    <div style="text-align: left; font-family: 'Outfit', 'Inter', sans-serif;">
      <div style="background: #faf5ff; border-left: 4px solid #8b5cf6; padding: 10px 12px; border-radius: 0 8px 8px 0; margin-bottom: 15px;">
        <h4 style="font-size: 15px; font-weight: 700; color: #5b21b6; margin: 0 0 4px 0;">${opt.name}</h4>
        <p style="font-size: 12.5px; color: #6d28d9; margin: 0; line-height: 1.4;">${opt.description}</p>
      </div>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
        <div style="background-color: #f8fafc; padding: 10px; border-radius: 8px; border: 1px solid #f1f5f9; display: flex; flex-direction: column; justify-content: center;">
          <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Hình học vùng</div>
          <div style="font-size: 13.5px; font-weight: 700; color: ${compactnessColor}; margin-top: 4px;">
            <i class="fa-solid fa-compass-drafting" style="margin-right: 4px;"></i> ${compactnessRating}
          </div>
        </div>
        <div style="background-color: #f8fafc; padding: 10px; border-radius: 8px; border: 1px solid #f1f5f9; display: flex; flex-direction: column; justify-content: center;">
          <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Độ lệch tải trọng (CV)</div>
          <div style="font-size: 13.5px; font-weight: 700; color: ${cvColor}; margin-top: 4px;">
            <i class="fa-solid fa-chart-line" style="margin-right: 4px;"></i> ${cvVal.toFixed(1)}% (±${maxDevVal.toFixed(1)}%)
          </div>
        </div>
        <div style="background-color: #f8fafc; padding: 10px; border-radius: 8px; border: 1px solid #f1f5f9; display: flex; flex-direction: column; justify-content: center;">
          <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Phạm vi khách hàng</div>
          <div style="font-size: 13.5px; font-weight: 700; color: #334155; margin-top: 4px;">
            <i class="fa-solid fa-users" style="margin-right: 4px;"></i> ${opt.metrics.minZoneCust} - ${opt.metrics.maxZoneCust} khách
          </div>
        </div>
        <div style="background-color: #f8fafc; padding: 10px; border-radius: 8px; border: 1px solid #f1f5f9; display: flex; flex-direction: column; justify-content: center;">
          <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Tính liên thông</div>
          <div style="font-size: 13.5px; font-weight: 700; color: #10b981; margin-top: 4px;">
            <i class="fa-solid fa-circle-check" style="margin-right: 4px;"></i> 100% Liên thông
          </div>
        </div>
      </div>

      <div style="font-size: 13px; font-weight: 700; color: #334155; margin-top: 12px; margin-bottom: 4px; display: flex; align-items: center;">
        <i class="fa-solid fa-table-list" style="margin-right: 6px; color: #64748b;"></i> Bảng chỉ số chi tiết các vùng:
      </div>
      ${zonesTableHtml}
    </div>
  `;

  if (Swal.isVisible() && window._isComparingOptions) {
    const contentEl = Swal.getHtmlContainer();
    if (contentEl) {
      contentEl.innerHTML = contentHtml;
    }
    const confirmBtn = Swal.getConfirmButton();
    if (confirmBtn) {
      confirmBtn.onclick = () => window.applyOption(jobId, idx);
    }
  } else {
    Swal.fire({
      title: `<span style="font-size: 19px; font-weight: 800; color: #1e293b; font-family: 'Outfit', sans-serif;"><i class="fa-solid fa-map-location-dot" style="color:#8b5cf6; margin-right:8px;"></i>Các Phương án</span>`,
      html: contentHtml,
      width: '420px',
      showCancelButton: true,
      confirmButtonText: '<i class="fa-solid fa-circle-check" style="margin-right: 5px;"></i> Áp dụng',
      cancelButtonText: '<i class="fa-solid fa-circle-xmark" style="margin-right: 5px;"></i> Hủy bỏ',
      confirmButtonColor: '#10b981',
      cancelButtonColor: '#ef4444',
      allowOutsideClick: false,
      backdrop: false, // Allows user to interact with the map underneath
      position: 'center-end', // Places the popup on the right side of the screen
      customClass: {
        popup: 'floating-options-panel',
        container: 'options-container-no-pointer' // SweetAlert containers capture pointer events, we can fix it if needed
      },
      didOpen: () => {
        window._isComparingOptions = true;
        const confirmBtn = Swal.getConfirmButton();
        if (confirmBtn) {
          confirmBtn.onclick = () => window.applyOption(jobId, idx);
        }
        // Force map interaction (SweetAlert2 container blocks pointer-events by default when backdrop is false but it might block the map)
        const container = document.querySelector('.swal2-container');
        if (container) {
           container.style.pointerEvents = 'none';
        }
        const popup = document.querySelector('.swal2-popup');
        if (popup) {
           popup.style.pointerEvents = 'auto'; // allow clicking inside the popup
           // Also add some margin so it's not sticking strictly to the edge
           popup.style.marginRight = '20px';
           popup.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2)';
        }
      },
      willClose: () => {
        const container = document.querySelector('.swal2-container');
        if (container) {
           container.style.pointerEvents = '';
        }
        const popup = document.querySelector('.swal2-popup');
        if (popup) {
           popup.style.pointerEvents = '';
           popup.style.marginRight = '';
           popup.style.boxShadow = '';
        }
      }
    }).then((res) => {
      if (res.dismiss) {
        window.discardOptimization(jobId);
      }
    });
  }
};


/** Tô màu ngẫu nhiên cho các ô đã chọn */
window.bulkRandomColors = function () {
  const selected = Array.from(
    document.querySelectorAll(".dist-checkbox:checked"),
  ).map((cb) => parseInt(cb.value));
  if (selected.length === 0) {
    return Swal.fire(
      "Thông báo",
      "Vui lòng chọn ít nhất 1 ô để tô màu.",
      "info",
    );
  }

  Swal.fire({
    title: `<i class="fa-solid fa-palette" style="color:#8e44ad"></i> Tô màu ngẫu nhiên`,
    text: `Hệ thống sẽ gán màu ngẫu nhiên (tươi, dễ nhìn) cho ${selected.length} ô đã chọn.`,
    icon: "question",
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-palette"></i> Tô màu ngay',
    cancelButtonText: "Hủy",
    confirmButtonColor: "#8e44ad",
  }).then(async (result) => {
    if (!result.isConfirmed) return;

    document.getElementById("loading-screen").style.display = "flex";
    try {
      const total = selected.length;
      await Promise.all(
        selected.map((id, index) => {
          // Sử dụng Hue phân bổ đều để tránh các màu trùng nhau khi tô màu hàng loạt cho các ô đã chọn
          const hue = (index * 360) / total;
          const color = window.randomPolygonColor(hue);
          return fetch(`/api/units/${id}/color`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ color }),
          });
        }),
      );
      document.getElementById("loading-screen").style.display = "none";
      Swal.fire({
        icon: "success",
        title: "Hoàn thành!",
        text: `Đã tô màu ngẫu nhiên cho ${selected.length} ô.`,
        timer: 2000,
        showConfirmButton: false,
      }).then(() => location.reload());
    } catch (err) {
      document.getElementById("loading-screen").style.display = "none";
      Swal.fire("Lỗi", err.message, "error");
    }
  });
};

window.startBulkMerge = async function () {
  if (!window.selectedUnitsList || window.selectedUnitsList.length < 2) {
    Swal.fire(
      "Lỗi",
      "Cần chọn ít nhất 2 ô đa giác trở lên để nối chúng lại với nhau!",
      "error",
    );
    return;
  }

  // Yêu cầu tên cho đa giác mới
  const { value: unitName } = await Swal.fire({
    title: "Hợp nhất Đa giác",
    text: "Nhập tên cho ô mới sau khi nối:",
    input: "text",
    inputPlaceholder: "Ví dụ: Cụm Trung tâm",
    showCancelButton: true,
    confirmButtonText: "Hợp nhất",
  });

  if (!unitName) return;

  document.getElementById("loading-screen").style.display = "flex";
  try {
    const res = await fetch("/api/units/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: window.selectedUnitsList,
        name: unitName,
        version_id: window.currentVersionId,
      }),
    });

    const data = await res.json();
    document.getElementById("loading-screen").style.display = "none";

    if (data.success) {
      Swal.fire(
        "Thành công",
        "Đã nối các mảnh vỡ thành 1 đa giác hoàn chỉnh!",
        "success",
      );
      window.cancelBulkMode(); // Thoát chế độ chọn
      setTimeout(() => location.reload(), 1500);
    } else {
      Swal.fire("Lỗi", data.message, "error");
    }
  } catch (e) {
    document.getElementById("loading-screen").style.display = "none";
    Swal.fire("Lỗi", "Không thể kết nối đến máy chủ", "error");
  }
};

/** Chọn/Bỏ chọn tất cả các ô trong danh sách hiện tại */
window.toggleAllUnits = function (checkbox) {
  const isChecked = checkbox.checked;
  const checkboxes = document.querySelectorAll(".dist-checkbox");
  checkboxes.forEach((cb) => {
    cb.checked = isChecked;
    const unitId = parseInt(cb.value);
    const idx = window.selectedUnitsList.indexOf(unitId);
    if (isChecked && idx === -1) {
      window.selectedUnitsList.push(unitId);
      // Highlight trên bản đồ
      if (window.geoJsonLayer) {
        window.geoJsonLayer.eachLayer((l) => {
          if (l.options.id === unitId && l.getElement())
            l.getElement().classList.add("marching-ants-path");
        });
      }
    } else if (!isChecked && idx > -1) {
      window.selectedUnitsList.splice(idx, 1);
      // Bỏ highlight trên bản đồ
      if (window.geoJsonLayer) {
        window.geoJsonLayer.eachLayer((l) => {
          if (l.options.id === unitId && l.getElement())
            l.getElement().classList.remove("marching-ants-path");
        });
      }
    }
  });

  // Cập nhật số lượng trên panel
  const countSpan = document.getElementById("bulk-count");
  if (countSpan) countSpan.innerText = window.selectedUnitsList.length;

  // Hiện panel nếu có chọn
  const panel = document.getElementById("bulk-action-panel");
  if (panel) {
    panel.style.display = window.selectedUnitsList.length > 0 ? "flex" : "none";
    window.isBulkSelectMode = window.selectedUnitsList.length > 0;
  }
};

/** Cập nhật trạng thái nút "Chọn hết" dựa trên các checkbox con */
window.updateCheckAllState = function () {
  const checkboxes = document.querySelectorAll(".dist-checkbox");
  const checkAll = document.getElementById("checkAllUnits");
  if (checkAll && checkboxes.length > 0) {
    checkAll.checked = Array.from(checkboxes).every((cb) => cb.checked);
  }

  // Cập nhật selectedUnitsList và đồng bộ viền kiến bò lên bản đồ
  checkboxes.forEach((cb) => {
    const id = parseInt(cb.value);
    const idx = window.selectedUnitsList.indexOf(id);
    if (cb.checked) {
      if (idx === -1) window.selectedUnitsList.push(id);
      if (window.geoJsonLayer) {
        window.geoJsonLayer.eachLayer((l) => {
          if (l.options && l.options.id == id && l.getElement && l.getElement()) {
            l.getElement().classList.add("marching-ants-path");
          }
        });
      }
    } else {
      if (idx > -1) window.selectedUnitsList.splice(idx, 1);
      if (window.geoJsonLayer) {
        window.geoJsonLayer.eachLayer((l) => {
          if (l.options && l.options.id == id && l.getElement && l.getElement()) {
            l.getElement().classList.remove("marching-ants-path");
          }
        });
      }
    }
  });

  const countSpan = document.getElementById("bulk-count");
  if (countSpan) countSpan.innerText = window.selectedUnitsList.length;

  const panel = document.getElementById("bulk-action-panel");
  if (panel) {
    panel.style.display = window.selectedUnitsList.length > 0 ? "flex" : "none";
    window.isBulkSelectMode = window.selectedUnitsList.length > 0;
  }
};

/** Đồng bộ một chiều từ selectedUnitsList sang các checkbox DOM dưới chân trang */
window.syncSelectedCheckboxes = function () {
  const checkboxes = document.querySelectorAll(".dist-checkbox");
  checkboxes.forEach((cb) => {
    const id = parseInt(cb.value);
    if (window.selectedUnitsList && window.selectedUnitsList.includes(id)) {
      cb.checked = true;
    } else {
      cb.checked = false;
    }
  });

  // Cập nhật trạng thái nút Chọn tất cả
  const checkAll = document.getElementById("checkAllUnits");
  if (checkAll && checkboxes.length > 0) {
    checkAll.checked = Array.from(checkboxes).every((cb) => cb.checked);
  }

  // Cập nhật số lượng trên panel
  const countSpan = document.getElementById("bulk-count");
  if (countSpan) countSpan.innerText = window.selectedUnitsList.length;

  // Hiện panel bulk action nếu có đa giác được chọn
  const panel = document.getElementById("bulk-action-panel");
  if (panel) {
    panel.style.display = window.selectedUnitsList.length > 0 ? "flex" : "none";
    window.isBulkSelectMode = window.selectedUnitsList.length > 0;
  }
};

/** Chuyển nhanh sang Tỉnh khác và zoom bản đồ */
window.switchToProvince = function (provinceId, regionId) {
  if (!provinceId) return;

  // Đồng bộ với sidebar hierarchy
  const regionSelect = document.getElementById("region-select");
  const provinceSelect = document.getElementById("province-select");

  if (regionId && regionSelect.value != regionId) {
    regionSelect.value = regionId;
    window.loadProvinces().then(() => {
      provinceSelect.value = provinceId;
      window.loadVersions();
    });
  } else {
    provinceSelect.value = provinceId;
    window.loadVersions();
  }
};

/**
 * Bật/Tắt bảng thông số vùng (Floating Panel)
 */
window.toggleStatsPanel = function () {
  const panel = document.getElementById("stats-summary-panel");
  if (!panel) return;

  if (panel.style.display === "flex") {
    panel.style.display = "none";
  } else {
    panel.style.display = "flex";
    window.updateStatsPanel();
    if (!window.statsPanelInitialized) {
      window.initStatsPanelEvents();
      window.statsPanelInitialized = true;
    }
  }
};

// Toggle mở rộng / thu gọn bảng Thông số vùng
window._statsExpandedState = null; // lưu vị trí & kích thước trước khi expand
window.toggleStatsExpand = function () {
  const panel = document.getElementById("stats-summary-panel");
  const btn = document.getElementById("stats-expand-btn");
  if (!panel) return;

  const isExpanded = panel.classList.contains("stats-expanded");

  if (!isExpanded) {
    // LƯU vị trí và kích thước hiện tại trước khi expand
    window._statsExpandedState = {
      width: panel.style.width,
      height: panel.style.height,
      left: panel.style.left,
      top: panel.style.top,
      right: panel.style.right,
    };
    // Xóa inline position để CSS class .stats-expanded hoạt động
    panel.style.left = "";
    panel.style.top = "";
    panel.style.right = "";
    panel.style.width = "";
    panel.style.height = "";
    panel.classList.add("stats-expanded");
    if (btn) {
      btn.title = "Thu gọn";
      btn.innerHTML = '<i class="fa-solid fa-compress"></i>';
    }
  } else {
    // KHÔI PHỤC vị trí cũ
    panel.classList.remove("stats-expanded");
    if (window._statsExpandedState) {
      const s = window._statsExpandedState;
      panel.style.width = s.width || "";
      panel.style.height = s.height || "";
      panel.style.left = s.left || "";
      panel.style.top = s.top || "";
      panel.style.right = s.right || "";
      window._statsExpandedState = null;
    }
    if (btn) {
      btn.title = "Mở rộng";
      btn.innerHTML = '<i class="fa-solid fa-expand"></i>';
    }
  }
};

/**
 * Khởi tạo sự kiện Kéo (Drag) và Co giãn (Resize) cho bảng thông số
 */
window.initStatsPanelEvents = function () {
  const panel = document.getElementById("stats-summary-panel");
  const header = document.getElementById("stats-panel-drag-handle");
  if (!panel || !header) return;

  // --- KÉO BẢNG (DRAG) ---
  let isDragging = false;
  let startX, startY, startLeft, startTop;

  header.onmousedown = (e) => {
    // Không cho kéo nếu click vào nút đóng
    if (e.target.closest("button")) return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = panel.offsetLeft;
    startTop = panel.offsetTop;

    const onMouseMove = (e) => {
      if (!isDragging) return;
      panel.style.left = startLeft + (e.clientX - startX) + "px";
      panel.style.top = startTop + (e.clientY - startY) + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    };

    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  // --- CO GIÃN CÁC CẠNH (RESIZE) ---
  const resizers = panel.querySelectorAll(".resizer");
  resizers.forEach((resizer) => {
    resizer.onmousedown = (e) => {
      e.preventDefault();
      const type = resizer.classList[1]; // resizer-r, resizer-b, etc.
      const startW = panel.offsetWidth;
      const startH = panel.offsetHeight;
      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const startL = panel.offsetLeft;
      const startT = panel.offsetTop;

      const onMouseMove = (e) => {
        if (type.includes("r"))
          panel.style.width = startW + (e.clientX - startMouseX) + "px";
        if (type.includes("b"))
          panel.style.height = startH + (e.clientY - startMouseY) + "px";
        if (type.includes("l")) {
          const newWidth = startW - (e.clientX - startMouseX);
          if (newWidth > 200) {
            panel.style.width = newWidth + "px";
            panel.style.left = startL + (e.clientX - startMouseX) + "px";
          }
        }
        if (type.includes("t")) {
          const newHeight = startH - (e.clientY - startMouseY);
          if (newHeight > 100) {
            panel.style.height = newHeight + "px";
            panel.style.top = startT + (e.clientY - startMouseY) + "px";
          }
        }
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };
  });
};

/**
 * Cập nhật nội dung bảng thông số vùng (Nhóm theo màu)
 */
window.updateStatsPanel = async function () {
  const contentDiv = document.getElementById("stats-summary-content");
  if (!contentDiv) return;

  if (!window.currentVersionId) {
    contentDiv.innerHTML = '<p class="empty-msg">Chưa chọn bản đồ.</p>';
    return;
  }

  contentDiv.innerHTML = '<p class="empty-msg">Đang tải...</p>';

  try {
    const res = await fetch(`/api/units?versionId=${window.currentVersionId}`);
    const data = await res.json();

    if (!data.features || data.features.length === 0) {
      contentDiv.innerHTML =
        '<p class="empty-msg">Phiên bản này chưa có ô đa giác nào.</p>';
      return;
    }

    // Xác định các đa giác được chọn để phân chia (phân vùng)
    let activeIds = null;
    if (window.currentOptimOptions) {
      const firstOpt = window.currentOptimOptions[0];
      if (firstOpt && firstOpt.assignments) {
        activeIds = Object.keys(firstOpt.assignments).map(Number);
      }
    }

    const hasAnyPartitioned = data.features.some(f => f.properties && (f.properties.is_partitioned === true || f.properties.is_partitioned === 'true'));

    let displayFeatures = data.features;
    if (activeIds) {
      displayFeatures = displayFeatures.filter(f => {
        const uid = parseInt(f.id || f.properties.id);
        return activeIds.includes(uid);
      });
    } else if (hasAnyPartitioned) {
      // Chỉ hiện các đa giác đã được phân vùng
      displayFeatures = displayFeatures.filter(f => {
        return f.properties && (f.properties.is_partitioned === true || f.properties.is_partitioned === 'true');
      });
    }

    if (displayFeatures.length === 0) {
      contentDiv.innerHTML =
        '<p class="empty-msg">Không có ô đa giác nào được chọn để thống kê.</p>';
      return;
    }

    // Nhóm các ô đa giác theo màu sắc (mỗi màu đại diện cho 1 vùng)
    const statsMap = {};
    displayFeatures.forEach((f) => {
      const color = f.properties.color || "#3388ff";
      if (!statsMap[color]) {
        statsMap[color] = {
          color: color,
          polygonCount: 0,
          customerCount: 0,
          orderCount: 0,
          driverId: null,
          driverName: null,
          unitIds: []
        };
      }
      statsMap[color].polygonCount++;
      statsMap[color].customerCount += parseInt(f.properties.customers) || 0;
      statsMap[color].orderCount += parseInt(f.properties.orders) || 0;
      statsMap[color].unitIds.push(f.id || f.properties.id);
      if (f.properties.driverId) {
        statsMap[color].driverId = f.properties.driverId;
        statsMap[color].driverName = f.properties.driverName;
      }
    });

    const summary = Object.values(statsMap);

    // Tính toán tổng số
    let totalPolygons = 0;
    let totalCustomers = 0;
    let totalOrders = 0;

    const rows = summary
      .map((s, idx) => {
        totalPolygons += s.polygonCount;
        totalCustomers += s.customerCount;
        totalOrders += s.orderCount;
        
        const driverText = s.driverName 
          ? `<span style="color: #2ecc71; font-weight: bold;"><i class="fa-solid fa-user-check"></i> ${s.driverName}</span>` 
          : `<span style="color: #e74c3c; font-style: italic;"><i class="fa-solid fa-user-slash"></i> Chưa gán</span>`;
        
        const assignBtn = `
          <button class="btn-blue" 
                  style="padding: 4px 8px; font-size: 11px; font-weight: bold; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px; cursor: pointer; margin: 0; height: auto;" 
                  onclick="window.showAssignDriverModal('${s.color}', ${JSON.stringify(s.unitIds)})">
            <i class="fa-solid fa-user-pen"></i> Gán
          </button>
        `;
        
        return `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #ddd;"><span class="color-indicator" style="background-color: ${s.color}"></span> Vùng ${idx + 1}</td>
          <td class="stat-value" style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${s.polygonCount}</td>
          <td class="stat-value" style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${s.orderCount}</td>
          <td class="stat-value" style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${s.customerCount}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; font-size: 12px; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${driverText}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: center;">${assignBtn}</td>
        </tr>
      `;
      })
      .join("");

    contentDiv.innerHTML = `
      <div style="padding: 10px 10px 0 10px; display: flex; gap: 8px;">
        <button class="btn-blue" style="width: 100%; height: 36px; font-weight: bold; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; margin: 0; background-color: #27ae60;" onclick="window.showRandomAssignDriversModal()">
          <i class="fa-solid fa-shuffle"></i> Gán ngẫu nhiên tài xế
        </button>
      </div>
      <div class="opt-summary-totals" style="margin: 10px; background: white;">
        <div class="opt-total-item">
          <span class="opt-total-label">Vùng</span>
          <span class="opt-total-value">${summary.length}</span>
        </div>
        <div class="opt-total-item">
          <span class="opt-total-label">Ô</span>
          <span class="opt-total-value">${totalPolygons}</span>
        </div>
        <div class="opt-total-item">
          <span class="opt-total-label">Khách</span>
          <span class="opt-total-value" style="font-size:12px;">${totalCustomers.toLocaleString()}</span>
        </div>
      </div>
      <table class="opt-results-table" style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th style="position: sticky; top: 0; background: #f8f9fa; z-index: 15; padding: 8px; border-bottom: 2px solid #ddd; text-align: left; color: #555; font-size: 12px;">Vùng</th>
            <th style="position: sticky; top: 0; background: #f8f9fa; z-index: 15; padding: 8px; border-bottom: 2px solid #ddd; text-align: right; color: #555; font-size: 12px;">Ô</th>
            <th style="position: sticky; top: 0; background: #f8f9fa; z-index: 15; padding: 8px; border-bottom: 2px solid #ddd; text-align: right; color: #555; font-size: 12px;">Đơn</th>
            <th style="position: sticky; top: 0; background: #f8f9fa; z-index: 15; padding: 8px; border-bottom: 2px solid #ddd; text-align: right; color: #555; font-size: 12px;">Khách</th>
            <th style="position: sticky; top: 0; background: #f8f9fa; z-index: 15; padding: 8px; border-bottom: 2px solid #ddd; text-align: left; color: #555; font-size: 12px;">Tài xế</th>
            <th style="position: sticky; top: 0; background: #f8f9fa; z-index: 15; padding: 8px; border-bottom: 2px solid #ddd; text-align: center; color: #555; font-size: 12px;">Hành động</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  } catch (e) {
    console.error("Lỗi updateStatsPanel:", e);
    contentDiv.innerHTML = `<p class="empty-msg">Lỗi tải dữ liệu.</p>`;
  }
};

// ============================================================
// HÀM XỬ LÝ SẮP XẾP ĐA GIÁC (CLIENT-SIDE)
// ============================================================
window.toggleSortOptions = function (event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById("sort-options-list");
  if (dropdown) {
    dropdown.classList.toggle("show");
  }
};

window.toggleSortDirection = function (event) {
  if (event) event.stopPropagation();
  window.currentSortDirection = window.currentSortDirection === "desc" ? "asc" : "desc";

  const dirBtn = document.getElementById("btn-sort-direction");
  if (dirBtn) {
    if (window.currentSortDirection === "asc") {
      dirBtn.setAttribute("title", "Tăng dần");
      dirBtn.innerHTML = `<i class="fa-solid fa-arrow-up-short-wide direction-icon"></i>`;
    } else {
      dirBtn.setAttribute("title", "Giảm dần");
      dirBtn.innerHTML = `<i class="fa-solid fa-arrow-down-wide-short direction-icon"></i>`;
    }
  }

  // Re-render the list with the sorted units
  if (window.originalUnitsList) {
    window.renderDistrictManagementList(window.originalUnitsList, true);
  }
};

window.applySort = function (sortBy, element, event) {
  if (event) event.stopPropagation();
  window.currentSortBy = sortBy;

  // Cập nhật trạng thái active của dropdown
  const options = document.querySelectorAll(".sort-option-btn");
  options.forEach((opt) => opt.classList.remove("active"));
  if (element) {
    element.classList.add("active");
  }

  // Cập nhật nhãn của dropdown chính
  const labelSpan = document.getElementById("current-sort-label");
  if (labelSpan && element) {
    labelSpan.innerHTML = element.innerHTML;
  }

  // Ẩn dropdown
  const dropdown = document.getElementById("sort-options-list");
  if (dropdown) {
    dropdown.classList.remove("show");
  }

  // Re-render
  if (window.originalUnitsList) {
    window.renderDistrictManagementList(window.originalUnitsList, true);
  }
};

// Đóng dropdown khi click ra ngoài
document.addEventListener("click", () => {
  const dropdown = document.getElementById("sort-options-list");
  if (dropdown && dropdown.classList.contains("show")) {
    dropdown.classList.remove("show");
  }
});

// ============================================================
// HÀM HIỂN THỊ MODAL GÁN TÀI XẾ CHO VÙNG
// ============================================================
window.showAssignDriverModal = async function(color, unitIds) {
  const provinceSelect = document.getElementById("province-select");
  if (!provinceSelect) {
    Swal.fire("Lỗi", "Không tìm thấy selector tỉnh thành!", "error");
    return;
  }
  const provinceId = provinceSelect.value;
  if (!provinceId) {
    Swal.fire("Lỗi", "Vui lòng chọn Tỉnh/Thành phố trước!", "error");
    return;
  }
  
  try {
    // Gọi API lấy các driver thuộc tỉnh này và chưa được gán cho vùng nào khác trong version hiện tại
    const res = await fetch(`/api/drivers?province_id=${provinceId}&version_id=${window.currentVersionId}`);
    const result = await res.json();
    
    if (!result.success) {
      throw new Error(result.message || "Không thể tải danh sách tài xế");
    }
    
    const drivers = result.data || [];
    let optionsHtml = `<option value="">-- Hủy phân công / Chưa gán --</option>`;
    drivers.forEach(d => {
      optionsHtml += `<option value="${d.id}">${d.full_name} (${d.username})</option>`;
    });
    
    const { value: driverId } = await Swal.fire({
      title: 'Phân công tài xế cho vùng',
      html: `
        <div style="text-align: left; margin-bottom: 10px;">
          <p>Chọn tài xế quản lý vùng này:</p>
          <select id="swal-assign-driver" class="swal2-input" style="margin: 0; width: 100%; box-sizing: border-box; height: 45px;">
            ${optionsHtml}
          </select>
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      cancelButtonText: 'Hủy',
      confirmButtonText: 'Xác nhận gán',
      preConfirm: () => {
        return document.getElementById('swal-assign-driver').value;
      }
    });
    
    if (driverId !== undefined) {
      const assignRes = await fetch('/api/units/assign-driver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver_id: driverId ? parseInt(driverId) : null,
          unit_ids: unitIds,
          version_id: window.currentVersionId
        })
      });
      
      const assignResult = await assignRes.json();
      if (assignResult.success) {
        Swal.fire({
          icon: 'success',
          title: 'Thành công',
          text: assignResult.message,
          timer: 1500,
          showConfirmButton: false
        }).then(() => {
          // Tải lại bản đồ và cập nhật stats panel
          window.loadMapData();
          window.updateStatsPanel();
        });
      } else {
        Swal.fire('Lỗi', assignResult.message, 'error');
      }
    }
  } catch (err) {
    console.error("Lỗi showAssignDriverModal:", err);
    Swal.fire('Lỗi', err.message, 'error');
  }
};

// ============================================================
// HÀM HIỂN THỊ MODAL GÁN NGẪU NHIÊN TÀI XẾ CHO CÁC VÙNG
// ============================================================
window.showRandomAssignDriversModal = async function() {
  const provinceSelect = document.getElementById("province-select");
  if (!provinceSelect) {
    Swal.fire("Lỗi", "Không tìm thấy selector tỉnh thành!", "error");
    return;
  }
  const provinceId = provinceSelect.value;
  if (!provinceId) {
    Swal.fire("Lỗi", "Vui lòng chọn Tỉnh/Thành phố trước!", "error");
    return;
  }

  // Lấy các vùng hiện tại trên bản đồ (nhóm theo màu sắc)
  if (!window.geoJsonLayer) {
    Swal.fire("Lỗi", "Bản đồ chưa được tải xong!", "error");
    return;
  }

  // Xác định các đa giác được chọn để phân chia (phân vùng)
  let activeIds = null;
  if (window.currentOptimOptions) {
    const firstOpt = window.currentOptimOptions[0];
    if (firstOpt && firstOpt.assignments) {
      activeIds = Object.keys(firstOpt.assignments).map(Number);
    }
  }

  let hasAnyPartitioned = false;
  window.geoJsonLayer.eachLayer((layer) => {
    if (layer.feature && layer.feature.properties) {
      if (layer.feature.properties.is_partitioned === true || layer.feature.properties.is_partitioned === 'true') {
        hasAnyPartitioned = true;
      }
    }
  });

  const statsMap = {};
  window.geoJsonLayer.eachLayer((layer) => {
    if (layer.feature && layer.feature.properties) {
      const isPartitioned = layer.feature.properties.is_partitioned === true || layer.feature.properties.is_partitioned === 'true';
      const unitId = layer.options.id || layer.feature.properties.id;
      if (unitId) {
        // Nếu đang trong chế độ preview: lọc theo activeIds. Nếu xem bình thường: lọc theo is_partitioned
        if (activeIds) {
          if (!activeIds.includes(parseInt(unitId))) return;
        } else if (hasAnyPartitioned) {
          if (!isPartitioned) return;
        }
        
        const color = layer.feature.properties.color || "#3388ff";
        if (!statsMap[color]) {
          statsMap[color] = {
            color: color,
            unitIds: []
          };
        }
        statsMap[color].unitIds.push(unitId);
      }
    }
  });

  const zones = Object.values(statsMap);
  if (zones.length === 0) {
    Swal.fire("Thông báo", "Không tìm thấy vùng nào đã được phân chia trên bản đồ!", "warning");
    return;
  }

  try {
    // 1. Tải danh sách tài xế
    Swal.fire({
      title: 'Đang tải...',
      text: 'Vui lòng chờ giây lát',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    const res = await fetch(`/api/drivers?province_id=${provinceId}&version_id=${window.currentVersionId}`);
    const result = await res.json();
    Swal.close();

    if (!result.success) {
      throw new Error(result.message || "Không thể tải danh sách tài xế");
    }

    const drivers = result.data || [];
    if (drivers.length === 0) {
      Swal.fire("Thông báo", "Không tìm thấy tài xế nào thuộc tỉnh này trong hệ thống!", "warning");
      return;
    }

    // 2. Tạo giao diện danh sách checkbox tài xế
    let driversHtml = '';
    drivers.forEach(d => {
      driversHtml += `
        <div class="swal-driver-item" style="display: flex; align-items: center; padding: 8px; border-bottom: 1px solid #f1f1f1; gap: 10px;">
          <input type="checkbox" class="swal-driver-checkbox" value="${d.id}" id="driver-chk-${d.id}" checked style="width: 18px; height: 18px; cursor: pointer;">
          <label for="driver-chk-${d.id}" style="cursor: pointer; font-size: 13px; font-weight: 500; color: #333; margin: 0; text-align: left; flex: 1;">
            ${d.full_name} (${d.username})
          </label>
        </div>
      `;
    });

    const { value: selectedDriverIds } = await Swal.fire({
      title: 'Gán ngẫu nhiên tài xế',
      width: '450px',
      html: `
        <div style="text-align: left; font-size: 13px; color: #666; margin-bottom: 12px; line-height: 1.4;">
          Chọn các tài xế tham gia chạy ngẫu nhiên. Hệ thống sẽ phân bố ngẫu nhiên và công bằng các vùng đã chia cho các tài xế được chọn.
        </div>
        <div style="border: 1px solid #ddd; border-radius: 6px; overflow: hidden; background: #fff;">
          <div style="display: flex; align-items: center; padding: 10px; border-bottom: 1px solid #ddd; background: #f9f9f9; gap: 10px;">
            <input type="checkbox" id="swal-select-all-drivers" checked style="width: 18px; height: 18px; cursor: pointer;">
            <label for="swal-select-all-drivers" style="cursor: pointer; font-size: 13px; font-weight: bold; color: #2c3e50; margin: 0; text-align: left; flex: 1;">
              Chọn tất cả tài xế (${drivers.length})
            </label>
          </div>
          <div id="swal-drivers-container" style="max-height: 250px; overflow-y: auto;">
            ${driversHtml}
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Xác nhận gán ngẫu nhiên',
      cancelButtonText: 'Hủy',
      confirmButtonColor: '#27ae60',
      focusConfirm: false,
      didOpen: () => {
        const selectAllChk = document.getElementById('swal-select-all-drivers');
        const driverChks = document.querySelectorAll('.swal-driver-checkbox');

        selectAllChk.addEventListener('change', (e) => {
          driverChks.forEach(cb => {
            cb.checked = e.target.checked;
          });
        });

        driverChks.forEach(cb => {
          cb.addEventListener('change', () => {
            const allChecked = Array.from(driverChks).every(c => c.checked);
            selectAllChk.checked = allChecked;
          });
        });
      },
      preConfirm: () => {
        const checkedChks = document.querySelectorAll('.swal-driver-checkbox:checked');
        const ids = Array.from(checkedChks).map(cb => parseInt(cb.value));
        if (ids.length === 0) {
          Swal.showValidationMessage('Vui lòng chọn ít nhất một tài xế!');
          return false;
        }
        return ids;
      }
    });

    if (!selectedDriverIds) return; // User cancel

    // 3. Thực hiện gán ngẫu nhiên công bằng (shuffled round-robin)
    Swal.fire({
      title: 'Đang gán ngẫu nhiên...',
      text: 'Đang phân phối các vùng cho tài xế',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    // Shuffle danh sách tài xế
    const shuffledDrivers = [...selectedDriverIds].sort(() => Math.random() - 0.5);

    // Chuẩn bị các Promise gọi API gán
    const promises = zones.map((zone, index) => {
      const assignedDriverId = shuffledDrivers[index % shuffledDrivers.length];
      return fetch('/api/units/assign-driver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver_id: assignedDriverId,
          unit_ids: zone.unitIds,
          version_id: window.currentVersionId
        })
      }).then(r => r.json());
    });

    const results = await Promise.all(promises);
    const hasError = results.some(r => !r.success);

    Swal.close();

    if (hasError) {
      const errorMsg = results.find(r => !r.success)?.message || "Có lỗi xảy ra khi phân công tài xế";
      Swal.fire('Thất bại', errorMsg, 'error');
    } else {
      Swal.fire({
        icon: 'success',
        title: 'Thành công',
        text: `Đã phân bổ ngẫu nhiên ${zones.length} vùng cho ${selectedDriverIds.length} tài xế thành công!`,
        timer: 2000,
        showConfirmButton: false
      }).then(() => {
        window.loadMapData();
        window.updateStatsPanel();
      });
    }

  } catch (err) {
    console.error("Lỗi showRandomAssignDriversModal:", err);
    Swal.fire('Lỗi', err.message, 'error');
  }
};

