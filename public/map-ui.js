// Sinh màu ngẫu nhiên dạng HEX (HSL có kiểm soát để màu tươi, dễ nhìn trên bản đồ)
window.randomPolygonColor = function randomPolygonColor() {
  const hue = Math.floor(Math.random() * 360);
  const saturation = 55 + Math.floor(Math.random() * 25); // 55–80%
  const lightness = 45 + Math.floor(Math.random() * 15);  // 45–60%
  // Chuyển HSL -> HEX
  const s = saturation / 100, l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + hue / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

// Hàm 1: Hiện cái bảng (Popup) để nhập tên ô, số khách...
async function showSaveForm(geometry, layer) {
  const defaultColor = randomPolygonColor();
  const { value: formValues } = await Swal.fire({
    title: "Nhập thông tin ô mới",
    html:
      '<input id="swal-name" class="swal2-input" placeholder="Tên ô (VD: Ô 101)">' +
      '<input id="swal-customers" type="number" class="swal2-input" placeholder="Số lượng khách">' +
      '<input id="swal-orders" type="number" class="swal2-input" placeholder="Số lượng đơn">' +
      `<div style="margin-top: 10px;text-align:left;"><label style="margin-right:10px; padding-left:20px;">Màu đa giác:</label><input id="swal-color" type="color" value="${defaultColor}" style="height: 30px; vertical-align: middle; cursor:pointer;"></div>`,
    showCancelButton: true,
    confirmButtonText: "Tạo mới",
    cancelButtonText: "Hủy bỏ",
    preConfirm: () => {
      return {
        name: document.getElementById("swal-name").value,
        customers: document.getElementById("swal-customers").value || 0,
        orders: document.getElementById("swal-orders").value || 0,
        color: document.getElementById("swal-color").value,
      };
    },
  });

  if (formValues && formValues.name) {
    // Nếu nhập tên rồi thì gọi hàm gửi lên Server
    saveUnitToDB(formValues, geometry, layer);
  } else {
    layer.remove(); // Nếu bấm Hủy hoặc không nhập tên thì xóa hình vừa vẽ
  }
}

function updateSidebarStats(props) {
  const area = props.area ? props.area.toFixed(2) : "0.00";
  const color = props.color || props.zoneColor || "#ccc";
  let districtHtml = "";

  document.getElementById("sidebar-content").innerHTML = `
        <input type="hidden" id="active-unit-id" value="${props.id}">
        <div style="margin-bottom: 10px;">
            <b style="font-size: 16px; color: ${color};">
              <span style="display:inline-block;width:15px;height:15px;background-color:${color};border-radius:50%;vertical-align:middle;margin-right:5px;"></span>
              ${props.name}
            </b>
        <div style="font-size: 12px; color: gray;">Mã hệ thống: #${props.id || "N/A"}</div>
        </div>
        <hr style="margin: 10px 0; border: 0; border-top: 1px solid #eee;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
            <span style="color: #666;"><i class="fa-solid fa-ruler-combined"></i> Diện tích thực:</span>
            <b>${area} km²</b>
        </div>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin-top: 15px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <span style="font-size: 15px; font-weight: bold; color: #444;">Tổng khách hàng:</span>
                <span style="font-size: 24px; font-weight: bold; color: #ff6b6b;">${props.customers || 0}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 15px; font-weight: bold; color: #444;">Tổng đơn hàng:</span>
                <span style="font-size: 24px; font-weight: bold; color: #7d33ff;">${props.orders || 0}</span>
            </div>
        </div>
        ${districtHtml}
    `;
}

function updateSidebarAdmin(id, props) {
  const color = props.color || props.zoneColor || "#ccc";

  document.getElementById("admin-tools-content").innerHTML = `
        <div class="admin-edit-form" style="display: flex; flex-direction: column; gap: 10px;">
            <div>
                <label style="font-size: 12px; font-weight: bold; display: block; margin-bottom: 3px;">Tên ô đa giác:</label>
                <input type="text" id="edit-name" value="${props.name}" class="swal2-input" style="height: 35px; width: 100%; font-size: 14px; margin: 0;">
            </div>
            
            <div style="display: flex; gap: 10px;">
                <div style="flex: 1;">
                    <label style="font-size: 12px; font-weight: bold; display: block; margin-bottom: 3px;">Tổng Khách:</label>
                    <input type="number" id="edit-customers" value="${props.customers || 0}" class="swal2-input" style="height: 35px; width: 100%; font-size: 14px; margin: 0;">
                </div>
                <div style="flex: 1;">
                    <label style="font-size: 12px; font-weight: bold; display: block; margin-bottom: 3px;">Tổng Đơn:</label>
                    <input type="number" id="edit-orders" value="${props.orders || 0}" class="swal2-input" style="height: 35px; width: 100%; font-size: 14px; margin: 0;">
                </div>
            </div>

            <div>
                <label style="font-size: 12px; font-weight: bold; display: block; margin-bottom: 3px;">Màu sắc ô (Color Picker):</label>
                <input type="color" id="edit-color" value="${color}" style="height: 35px; width: 100%; cursor: pointer; border: 1px solid #ccc; border-radius: 4px; padding: 2px;">
            </div>
            
            <button onclick="saveAdminAttributes(${id})" class="btn-blue" style="margin-top: 10px; width: 100%;"><i class="fa-solid fa-save"></i> Lưu Thay Đổi</button>
        </div>
    `;
}

window.toggleBottomPanel = function (forceState) {
  const panel = document.getElementById("bottom-management-panel");
  if (!panel) return;

  if (forceState === true) panel.classList.add("active");
  else if (forceState === false) panel.classList.remove("active");
  else panel.classList.toggle("active");

  const isActive = panel.classList.contains("active");
  const closeBtnIcon = panel.querySelector(".panel-close-btn i");

  if (isActive) {
    document.body.classList.add("management-panel-open");
    const w = panel.style.width || "500px";
    document.body.style.setProperty("--management-panel-width", w);
    if (closeBtnIcon) closeBtnIcon.classList.replace("fa-chevron-left", "fa-chevron-right");
  } else {
    document.body.classList.remove("management-panel-open");
    if (closeBtnIcon) closeBtnIcon.classList.replace("fa-chevron-right", "fa-chevron-left");
  }
};

window.toggleSidebar = function () {
  const sidebar = document.getElementById("sidebar");
  const toggleBtn = document.getElementById("sidebar-toggle");
  if (!sidebar) return;

  const isOpening = !sidebar.classList.contains("active");
  sidebar.classList.toggle("active");

  const icon = toggleBtn ? toggleBtn.querySelector("i") : null;

  if (isOpening) {
    document.body.classList.add("sidebar-open");
    if (icon) {
      icon.className = "fa-solid fa-chevron-left";
    }
  } else {
    document.body.classList.remove("sidebar-open");
    if (icon) {
      icon.className = "fa-solid fa-chevron-right";
    }
  }
};

window.toggleSection = function (header) {
  const section = header.parentElement;
  const content = section.querySelector(".section-content");
  const icon = header.querySelector(".toggle-icon");

  if (content.style.display === "none") {
    content.style.display = "flex";
    if (icon) icon.classList.replace("fa-chevron-right", "fa-chevron-down");
  } else {
    content.style.display = "none";
    if (icon) icon.classList.replace("fa-chevron-down", "fa-chevron-right");
  }
};

// Hàm khởi tạo kéo giãn bảng quản lý
function initResizablePanel() {
  const panel = document.getElementById("bottom-management-panel");
  const handleV = document.getElementById("panel-resize-handle-v");
  const handleH = document.getElementById("panel-resize-handle-h");

  if (!panel || !handleV || !handleH) return;

  let isResizingV = false;
  let isResizingH = false;

  handleH.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingH = true;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  });

  window.addEventListener("mousemove", (e) => {
    if (isResizingH) {
      e.preventDefault();
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth > 320 && newWidth < window.innerWidth * 0.8) {
        panel.style.width = `${newWidth}px`;
        document.body.style.setProperty("--management-panel-width", `${newWidth}px`);
      }
    }
  });

  window.addEventListener("mouseup", () => {
    if (isResizingH) {
      isResizingH = false;
      document.body.style.cursor = "default";
      document.body.style.userSelect = "auto";
    }
  });
}

// Chạy khởi tạo khi trang load xong
document.addEventListener("DOMContentLoaded", () => {
    initResizablePanel();

    // ====================================================
    // NGĂN SỰ KIỆN CLICK/DBLCLICK TỪ CÁC PANEL LAN RA
    // LEAFLET MAP (tránh phóng to bản đồ khi bấm UI)
    // ====================================================
    const PANEL_IDS = [
        'bottom-management-panel',
        'unit-info-panel',
        'sidebar',
        'top-toolbar',
        'hierarchy-section',
        'bulk-action-panel'
    ];

    // Danh sách sự kiện cần chặn
    const BLOCKED_EVENTS = ['click', 'dblclick', 'mousedown', 'wheel'];

    PANEL_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        BLOCKED_EVENTS.forEach(evtName => {
            el.addEventListener(evtName, e => {
                // Chỉ stopPropagation, không preventDefault
                // để input, button, select vẫn hoạt động bình thường
                e.stopPropagation();
            }, { capture: false });
        });
    });
});

