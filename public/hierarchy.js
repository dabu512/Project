// public/hierarchy.js
let currentRegionId = null;
let currentProvinceId = null;

window.loadRegions = async function () {
  try {
    const res = await fetch("/api/hierarchy/regions");
    const data = await res.json();
    if (data.success) {
      const select = document.getElementById("region-select");
      select.innerHTML = '<option value="">-- Chọn Khu vực --</option>';
      data.data.forEach((r) => {
        select.innerHTML += `<option value="${r.id}">${r.name}</option>`;
      });
      if (data.data.length > 0) {
        const savedRegionId = localStorage.getItem("currentRegionId");
        if (savedRegionId && data.data.some((r) => r.id == savedRegionId)) {
          select.value = savedRegionId;
        } else {
          select.value = data.data[0].id;
        }
        window.loadProvinces();
      }
    }
  } catch (e) {
    console.error("Lỗi tải Khu vực", e);
  }
};

window.loadProvinces = async function () {
  const regionId = document.getElementById("region-select").value;
  if (regionId) localStorage.setItem("currentRegionId", regionId);
  else localStorage.removeItem("currentRegionId");

  const select = document.getElementById("province-select");
  const versionSelect = document.getElementById("version-select");

  select.innerHTML = '<option value="">-- Chọn Tỉnh --</option>';
  select.disabled = true;
  versionSelect.innerHTML = '<option value="">-- Chọn Bản đồ --</option>';
  versionSelect.disabled = true;
  document.getElementById("btn-create-version").disabled = true;
  document.getElementById("btn-delete-version").disabled = true;

  clearMap();

  if (!regionId) return;

  try {
    const res = await fetch(`/api/hierarchy/provinces?region_id=${regionId}`);
    const data = await res.json();
    if (data.success) {
      data.data.forEach((p) => {
        select.innerHTML += `<option value="${p.id}">${p.name}</option>`;
      });
      select.disabled = false;
      if (data.data.length > 0) {
        const savedProvinceId = localStorage.getItem("currentProvinceId");
        if (savedProvinceId && data.data.some((p) => p.id == savedProvinceId)) {
          select.value = savedProvinceId;
        } else {
          select.value = data.data[0].id;
        }
        window.loadVersions();
      }
    }
  } catch (e) {
    console.error("Lỗi tải Tỉnh", e);
  }
};

window.loadVersions = async function () {
  const provinceId = document.getElementById("province-select").value;
  if (provinceId) localStorage.setItem("currentProvinceId", provinceId);
  else localStorage.removeItem("currentProvinceId");

  const versionSelect = document.getElementById("version-select");

  versionSelect.innerHTML = '<option value="">-- Chọn Bản đồ --</option>';
  versionSelect.disabled = true;
  document.getElementById("btn-create-version").disabled = true;

  if (!provinceId) return;

  try {
    const res = await fetch(
      `/api/hierarchy/versions?province_id=${provinceId}`,
    );
    const data = await res.json();
    if (data.success) {
      data.data.forEach((v) => {
        let text = v.name;
        versionSelect.innerHTML += `<option value="${v.id}" data-status="${v.status}">${text}</option>`;
      });
      versionSelect.disabled = false;
      document.getElementById("btn-create-version").disabled = false;
      document.getElementById("btn-delete-version").disabled = false;
      if (data.data.length > 0) {
        const savedVersionId = localStorage.getItem("currentVersionId");
        if (savedVersionId && data.data.some((v) => v.id == savedVersionId)) {
          versionSelect.value = savedVersionId;
        } else {
          // Tự chọn bản ghi applied nếu có, không thì chọn bản ghi đầu tiên
          const applied = data.data.find((v) => v.status === "applied");
          versionSelect.value = applied ? applied.id : data.data[0].id;
        }
      }
      // Luôn gọi onVersionChange dẫu có phiên bản nào hay không
      window.onVersionChange();
    }
  } catch (e) {
    console.error("Lỗi tải Version", e);
  }
};

window.onVersionChange = function () {
  const versionSelect = document.getElementById("version-select");
  const versionId = versionSelect.value;

  if (versionId) localStorage.setItem("currentVersionId", versionId);
  else localStorage.removeItem("currentVersionId");

  if (!versionId) {
    document.getElementById("btn-delete-version").disabled = true;
    window.currentVersionId = null;
    window.currentVersionStatus = null;
  } else {
    document.getElementById("btn-delete-version").disabled = false;
    window.currentVersionId = parseInt(versionId);
    window.currentVersionStatus = "applied"; // Auto-applied immediately

    // Gọi API chốt/áp dụng phiên bản này ngầm bên dưới cơ sở dữ liệu
    fetch(`/api/hierarchy/versions/${versionId}/apply`, {
      method: "PUT",
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          console.log(`Phiên bản ${versionId} đã được tự động áp dụng chính thức.`);
        }
      })
      .catch((err) => console.error("Lỗi tự động áp dụng phiên bản:", err));
  }

  // Luôn luôn gọi tải bản đồ (để load TẤT CẢ các tỉnh ra)
  if (window.loadMapData) {
    window.loadMapData(versionId);
  }

  // Fetch and render the province boundaries
  const provSelect = document.getElementById("province-select");
  const provName = provSelect.options[provSelect.selectedIndex].text;
  window.loadProvinceBoundary(provName);
};

window.loadProvinceBoundary = async function (provinceName) {
  if (!provinceName) return;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?state=${encodeURIComponent(provinceName)}&country=Vietnam&polygon_geojson=1&format=json`,
    );
    const data = await res.json();

    if (data && data.length > 0) {
      // Pick the first valid administrative boundary
      const boundary = data.find(
        (item) =>
          item.geojson &&
          (item.geojson.type === "Polygon" ||
            item.geojson.type === "MultiPolygon"),
      );

      if (boundary && typeof map !== "undefined") {
        if (window.provinceBoundaryLayer) {
          map.removeLayer(window.provinceBoundaryLayer);
        }
        window.provinceBoundaryLayer = L.geoJSON(boundary.geojson, {
          style: {
            color: "#ff0000",
            weight: 3,
            fillOpacity: 0.05,
            dashArray: "5, 5", // Nét đứt
          },
          interactive: false, // Xuyên qua layer này để vẽ được
        }).addTo(map);

        // Luôn di chuyển camera (zoom) đê bao quát ranh giới Tỉnh mới chọn
        map.fitBounds(window.provinceBoundaryLayer.getBounds(), {
          padding: [20, 20],
        });
      }
    }
  } catch (e) {
    console.error("Lỗi khi load viền tỉnh:", e);
  }
};

window.createNewVersion = async function () {
  const provinceId = document.getElementById("province-select").value;
  if (!provinceId) return;

  // Lấy danh sách version hiện có để người dùng chọn sao chép
  let existingVersions = [];
  try {
    const res = await fetch(`/api/hierarchy/versions?province_id=${provinceId}`);
    const data = await res.json();
    if (data.success) existingVersions = data.data;
  } catch (e) { /* bỏ qua lỗi tải */ }

  // Xây dựng options cho dropdown chọn version nguồn
  const currentVersionId = document.getElementById("version-select").value;
  let versionOptionsHtml = `<option value="">🆕 Bắt đầu trống (không sao chép)</option>`;
  existingVersions.forEach((v) => {
    const selected = v.id == currentVersionId ? "selected" : "";
    versionOptionsHtml += `<option value="${v.id}" ${selected}>${v.name}</option>`;
  });

  const { value: formValues, isConfirmed } = await Swal.fire({
    title: '<i class="fa-solid fa-code-branch" style="color:#3085d6"></i> Tạo Phiên Bản Mới',
    html: `
      <div style="text-align:left; margin-bottom: 12px;">
        <label style="font-size:13px; font-weight:600; color:#444; display:block; margin-bottom:5px;">
          <i class="fa-solid fa-tag"></i> Tên phiên bản mới <span style="color:red">*</span>
        </label>
        <input id="swal-version-name" class="swal2-input" placeholder="VD: Phương án tháng 5 - lần 2" style="margin:0; width:100%; font-size:14px; height:40px;">
      </div>
      <div style="text-align:left;">
        <label style="font-size:13px; font-weight:600; color:#444; display:block; margin-bottom:5px;">
          <i class="fa-solid fa-copy"></i> Sao chép từ phiên bản
        </label>
        <select id="swal-source-version" class="swal2-input" style="margin:0; width:100%; height:40px; font-size:13px; padding: 0 10px;">
          ${versionOptionsHtml}
        </select>
        <p style="font-size:11px; color:#888; margin:6px 0 0 2px;">
          Chọn một phiên bản để sao chép toàn bộ đa giác và vùng sang phiên bản mới.
        </p>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-plus"></i> Tạo mới',
    cancelButtonText: "Hủy",
    confirmButtonColor: "#3085d6",
    focusConfirm: false,
    preConfirm: () => {
      const name = document.getElementById("swal-version-name").value.trim();
      const sourceId = document.getElementById("swal-source-version").value;
      if (!name) {
        Swal.showValidationMessage("Vui lòng nhập tên phiên bản!");
        return false;
      }
      return { name, sourceId: sourceId || null };
    },
  });

  if (!isConfirmed || !formValues) return;

  const { name: versionName, sourceId: sourceVersionId } = formValues;

  document.getElementById("loading-screen").style.display = "flex";
  try {
    const res = await fetch("/api/hierarchy/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        province_id: provinceId,
        name: versionName,
        source_version_id: sourceVersionId,
      }),
    });
    const data = await res.json();
    document.getElementById("loading-screen").style.display = "none";

    if (data.success) {
      const copyMsg = sourceVersionId
        ? `Đã sao chép dữ liệu từ phiên bản nguồn thành công!`
        : `Phiên bản trống đã được tạo.`;
      Swal.fire({
        icon: "success",
        title: "Tạo thành công!",
        text: copyMsg,
        timer: 2500,
        showConfirmButton: false,
      });
      localStorage.setItem("currentVersionId", data.id);
      await window.loadVersions();
      document.getElementById("version-select").value = data.id;
      window.onVersionChange();
    } else {
      Swal.fire("Lỗi", data.error || data.message, "error");
    }
  } catch (e) {
    document.getElementById("loading-screen").style.display = "none";
    console.error(e);
    Swal.fire("Lỗi", "Không thể kết nối đến server.", "error");
  }
};

window.applyCurrentVersion = async function () {
  if (!window.currentVersionId) return;

  Swal.fire({
    title: "Bạn có chắc chắn?",
    text: "Phiên bản này sẽ được áp dụng (Applied) cho toàn bộ tài xế (Driver view)! Tất cả Draft khác của Tỉnh này sẽ không còn tác dụng hiển thị cho Tài xế.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Đồng ý",
    cancelButtonText: "Hủy",
  }).then(async (result) => {
    if (result.isConfirmed) {
      document.getElementById("loading-screen").style.display = "flex";
      try {
        const res = await fetch(
          `/api/hierarchy/versions/${window.currentVersionId}/apply`,
          {
            method: "PUT",
          },
        );
        const data = await res.json();
        document.getElementById("loading-screen").style.display = "none";

        if (data.success) {
          Swal.fire("Thành công", "Đã lưu và áp dụng Phiên bản", "success");
          await window.loadVersions();
          document.getElementById("version-select").value =
            window.currentVersionId;
          window.onVersionChange();
        } else {
          Swal.fire("Lỗi", data.message, "error");
        }
      } catch (e) {
        document.getElementById("loading-screen").style.display = "none";
        Swal.fire("Lỗi", "Lỗi kết nối", "error");
      }
    }
  });
};

window.deleteCurrentVersion = async function () {
  if (!window.currentVersionId) return;

  const versionSelect = document.getElementById("version-select");
  const selectedOption = versionSelect.options[versionSelect.selectedIndex];
  const versionName = selectedOption
    ? selectedOption.text
    : `ID ${window.currentVersionId}`;

  const result = await Swal.fire({
    title: `Xóa "${versionName}"?`,
    html: `Toàn bộ <b>đa giác</b> và <b>vùng</b> trong phiên bản này sẽ bị xóa vĩnh viễn.<br><br>Hành động này <b>không thể hoàn tác</b>!`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#e74c3c",
    cancelButtonColor: "#95a5a6",
    confirmButtonText: '<i class="fa-solid fa-trash"></i> Xác nhận Xóa',
    cancelButtonText: "Hủy",
  });

  if (!result.isConfirmed) return;

  document.getElementById("loading-screen").style.display = "flex";
  try {
    const res = await fetch(
      `/api/hierarchy/versions/${window.currentVersionId}`,
      {
        method: "DELETE",
      },
    );
    const data = await res.json();
    document.getElementById("loading-screen").style.display = "none";

    if (data.success) {
      localStorage.removeItem("currentVersionId");
      window.currentVersionId = null;
      window.currentVersionStatus = null;
      Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: "Đã xóa phiên bản!",
        timer: 2000,
        showConfirmButton: false,
      });
      await window.loadVersions();
    } else {
      Swal.fire("Lỗi", data.message, "error");
    }
  } catch (e) {
    document.getElementById("loading-screen").style.display = "none";
    Swal.fire("Lỗi", "Không thể kết nối đến server.", "error");
  }
};

function clearMap() {
  if (window.geoJsonLayer && typeof map !== "undefined") {
    map.removeLayer(window.geoJsonLayer);
    window.geoJsonLayer = null;
  }
  if (window.provinceBoundaryLayer && typeof map !== "undefined") {
    map.removeLayer(window.provinceBoundaryLayer);
    window.provinceBoundaryLayer = null;
  }
  if (window.renderDistrictManagementList) {
    window.renderDistrictManagementList([]);
  }
  document.getElementById("admin-tools-content").innerHTML =
    '<p class="empty-msg">Chọn Phiên bản (Version) để bắt đầu chỉnh sửa bản đồ.</p>';
}
