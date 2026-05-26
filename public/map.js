// public/map.js
const currentUser = checkLogin();

window.modifiedUnits = new Map();
window.selectedUnitsList = []; // Array to store multiple selections
window.isBulkSelectMode = false;
window.currentVersionId = null;
window.currentVersionStatus = 'draft';
window.geoJsonLayer = null;
window.currentSelectedLayer = null; // Track polygon đang được highlight viền vàng
window.tempPastedLayers = []; // Lưu các ô đa giác dán tạm thời chưa lưu vào DB
window.isTempDragging = false;
window.tempDragLastLatLng = null;
window.tempDragInitialPositions = new Map();
window.tempDragTotalDeltaLat = 0;
window.tempDragTotalDeltaLng = 0;

/** Xóa highlight viền vàng khỏi polygon đang chọn */
window.clearSelectedPolygon = function() {
    if (window.currentSelectedLayer) {
        const el = window.currentSelectedLayer.getElement();
        if (el) el.classList.remove('polygon-selected');
        window.currentSelectedLayer = null;
    }
};

if (currentUser && currentUser.role === 'admin') {
    // Reveal the toggle button only for admin
    const tbBtn = document.getElementById('toggle-bulk-mode-btn');
    if (tbBtn) tbBtn.style.display = 'flex';

    const panelBtn = document.getElementById('bottom-panel-trigger');
    if (panelBtn) panelBtn.style.display = 'flex';

    // Hiện cursor-mode toolbar cho admin
    const cursorToolbar = document.getElementById('cursor-mode-toolbar');
    if (cursorToolbar) cursorToolbar.style.display = 'flex';

    const hierarchySection = document.getElementById('hierarchy-section');
    if (hierarchySection) hierarchySection.style.display = 'block';

    // Fetch initial region layout
    setTimeout(() => {
        if (window.loadRegions) window.loadRegions();
    }, 500);
}

// ================================================================
//  CURSOR MODE: Pan (mặc định) vs Drag-Select
// ================================================================
window._cursorMode = 'pan'; // 'pan' | 'select'

window.setCursorMode = function (mode) {
    window._cursorMode = mode;
    document.getElementById('btn-mode-pan').classList.toggle('active', mode === 'pan');
    document.getElementById('btn-mode-select').classList.toggle('active', mode === 'select');

    const bulkPanel = document.getElementById('bulk-action-panel');

    if (typeof map !== 'undefined') {
        if (mode === 'select') {
            map.dragging.disable();
            map.getContainer().style.cursor = 'crosshair';
            // Hiện panel quản lý chọn khi vào chế độ chọn
            if (bulkPanel) {
                bulkPanel.style.display = 'flex';
                if (!window.bulkPanelInitialized) {
                    window.initGenericPanel('bulk-action-panel', 'bulk-panel-drag-handle');
                    window.bulkPanelInitialized = true;
                }
            }
        } else {
            map.dragging.enable();
            map.getContainer().style.cursor = '';
            // Ẩn panel nếu không có gì được chọn
            if (bulkPanel && (!window.selectedUnitsList || window.selectedUnitsList.length === 0)) {
                bulkPanel.style.display = 'none';
            }
        }
    }
};

// ================================================================
//  PHÍM TẮT & PASTE LOGIC
// ================================================================
//  PHÍM TẮT & PASTE LOGIC
// ================================================================
window.addEventListener('keydown', function(e) {
    // Nếu đang gõ trong input/textarea/select, bỏ qua phím tắt bản đồ
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        let hasActiveSelection = (window.selectedUnitsList && window.selectedUnitsList.length > 0) || window.currentSelectedLayer;
        if (hasActiveSelection) {
            window.copySelectedUnits();
            e.preventDefault();
        }
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        window.pasteUnits();
        e.preventDefault();
    }
});

// Helper dịch chuyển toạ độ đa giác tránh đè lấn
function shiftGeometry(geom, dLon, dLat) {
    if (!geom) return null;
    const cloned = JSON.parse(JSON.stringify(geom));
    if (cloned.type === 'Polygon') {
        cloned.coordinates = cloned.coordinates.map(ring => 
            ring.map(coord => [coord[0] + dLon, coord[1] + dLat])
        );
    } else if (cloned.type === 'MultiPolygon') {
        cloned.coordinates = cloned.coordinates.map(polygon => 
            polygon.map(ring => 
                ring.map(coord => [coord[0] + dLon, coord[1] + dLat])
            )
        );
    }
    return cloned;
}

window.pasteUnits = async function() {
    if (!window.currentVersionId) {
        return Swal.fire("Thông báo", "Vui lòng chọn Tỉnh và Phiên bản trước khi dán đa giác!", "warning");
    }

    let polygonsToPaste = null;

    try {
        // Thử đọc từ Clipboard hệ thống trước
        const text = await navigator.clipboard.readText().catch(() => null);
        if (text) {
            try {
                const parsed = JSON.parse(text);
                if (parsed && parsed.type === 'gis-polygons' && Array.isArray(parsed.polygons)) {
                    polygonsToPaste = parsed.polygons;
                }
            } catch (_) {
                // Clipboard không phải JSON
            }
        }
    } catch (e) {
        console.warn("Không thể đọc clipboard hệ thống, dùng bộ nhớ đệm RAM", e);
    }

    // Fallback sang bộ nhớ RAM của tab hiện tại
    if (!polygonsToPaste && window.copiedPolygonsData && window.copiedPolygonsData.length > 0) {
        polygonsToPaste = window.copiedPolygonsData;
    }

    if (!polygonsToPaste || polygonsToPaste.length === 0) {
        return Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'Không tìm thấy dữ liệu đa giác hợp lệ đã copy!', timer: 2500, showConfirmButton: false });
    }

    const { isConfirmed } = await Swal.fire({
        title: 'Dán ô đa giác tạm thời?',
        html: `Bạn có muốn dán <b>${polygonsToPaste.length}</b> ô đa giác đã copy làm ô tạm thời không?<br>
               <span style="font-size:12px; color:gray;">(Hệ thống tự động tịnh tiến lệch 80m về Đông Bắc. Bạn có thể kéo di chuyển các ô này đến vị trí mong muốn rồi bấm "Xác nhận chốt dán ô")</span>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Đồng ý dán',
        cancelButtonText: 'Hủy'
    });

    if (!isConfirmed) return;

    // Xóa các ô tạm cũ nếu có
    if (window.tempPastedLayers && window.tempPastedLayers.length > 0) {
        window.tempPastedLayers.forEach(l => {
            if (typeof map !== 'undefined') map.removeLayer(l);
        });
        window.tempPastedLayers = [];
        _cleanupTempGroupDrag();
    }

    // Tịnh tiến dịch chuyển toạ độ 0.0008 (~80-100 mét)
    const shiftedPolygons = polygonsToPaste.map(poly => ({
        ...poly,
        geometry: shiftGeometry(poly.geometry, 0.0008, 0.0008)
    }));

    // Clear selected units to avoid conflicts
    if (window.geoJsonLayer) {
        window.geoJsonLayer.eachLayer(function (layer) {
            const el = layer.getElement();
            if (el) el.classList.remove('marching-ants-path');
        });
    }
    window.selectedUnitsList = [];
    window.isBulkSelectMode = true;

    // Vẽ các ô tạm lên bản đồ (KHÔNG dùng Geoman - dùng group-drag thay thế)
    shiftedPolygons.forEach(poly => {
        const geojsonGroup = L.geoJSON(poly.geometry, {
            style: {
                color: '#2ecc71',
                weight: 3,
                dashArray: '5, 8',
                fillOpacity: 0.35,
                fillColor: '#2ecc71'
            }
        });

        geojsonGroup.eachLayer(layer => {
            // Lưu trữ thông tin nguyên bản
            layer.options.polyData = {
                name: poly.name,
                color: poly.color || '#3388ff',
                customer_count: poly.customer_count || poly.customers || 0,
                order_count: poly.order_count || poly.orders || 0
            };

            layer.addTo(map);

            // Gắn sự kiện mousedown lên từng temp layer để bắt đầu group-drag
            layer.on('mousedown', function(e) {
                L.DomEvent.stopPropagation(e);
                window.isTempDragging = true;
                window.tempDragLastLatLng = e.latlng;
                map.dragging.disable(); // Tắt kéo bản đồ trong khi kéo nhóm
                map.getContainer().style.cursor = 'grabbing';
            });

            window.tempPastedLayers.push(layer);
        });
    });

    // Gắn sự kiện mousemove & mouseup trên map cho group-drag
    // Chỉ gắn 1 lần, kiểm tra bằng flag
    if (!window._tempGroupDragBound) {
        window._tempGroupDragBound = true;

        map.on('mousemove', function(e) {
            if (!window.isTempDragging || !window.tempDragLastLatLng) return;
            if (!window.tempPastedLayers || window.tempPastedLayers.length === 0) return;

            const deltaLat = e.latlng.lat - window.tempDragLastLatLng.lat;
            const deltaLng = e.latlng.lng - window.tempDragLastLatLng.lng;

            // Di chuyển tất cả các layer tạm thời cùng lúc
            window.tempPastedLayers.forEach(layer => {
                const latlngs = layer.getLatLngs();
                const shifted = _shiftLatLngs(latlngs, deltaLat, deltaLng);
                layer.setLatLngs(shifted);
            });

            window.tempDragLastLatLng = e.latlng;
        });

        map.on('mouseup', function(e) {
            if (window.isTempDragging) {
                window.isTempDragging = false;
                window.tempDragLastLatLng = null;
                map.dragging.enable(); // Bật lại kéo bản đồ
                map.getContainer().style.cursor = '';
            }
        });
    }

    // Mở panel quản lý chọn và hiển thị các nút thao tác dán
    const bulkPanel = document.getElementById('bulk-action-panel');
    if (bulkPanel) {
        bulkPanel.style.display = 'flex';
        if (!window.bulkPanelInitialized) {
            window.initGenericPanel('bulk-action-panel', 'bulk-panel-drag-handle');
            window.bulkPanelInitialized = true;
        }
    }

    const tempPasteActions = document.getElementById('temp-paste-actions');
    if (tempPasteActions) {
        tempPasteActions.style.display = 'flex';
    }

    const countSpan = document.getElementById('bulk-count');
    if (countSpan) {
        countSpan.innerText = window.tempPastedLayers.length;
    }

    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `Đã dán ${window.tempPastedLayers.length} ô đa giác tạm thời! Kéo bất kỳ ô nào để di chuyển cả nhóm.`, timer: 4000, showConfirmButton: false });
};

// Hàm trợ giúp: dịch chuyển tọa độ LatLngs (hỗ trợ nested arrays cho Polygon/MultiPolygon)
function _shiftLatLngs(latlngs, deltaLat, deltaLng) {
    if (Array.isArray(latlngs[0]) && !(latlngs[0] instanceof L.LatLng)) {
        // Nested array (e.g. polygon with holes, or multipolygon rings)
        return latlngs.map(ring => _shiftLatLngs(ring, deltaLat, deltaLng));
    }
    return latlngs.map(ll => L.latLng(ll.lat + deltaLat, ll.lng + deltaLng));
}

// Hàm dọn dẹp trạng thái group-drag khi không còn temp layers
function _cleanupTempGroupDrag() {
    window.isTempDragging = false;
    window.tempDragLastLatLng = null;
    if (typeof map !== 'undefined') {
        map.dragging.enable();
        map.getContainer().style.cursor = '';
    }
}

window.confirmPasteUnits = async function() {
    if (!window.tempPastedLayers || window.tempPastedLayers.length === 0) {
        return Swal.fire("Thông báo", "Không có ô tạm thời nào để chốt!", "info");
    }

    const { isConfirmed } = await Swal.fire({
        title: 'Chốt dán ô đa giác?',
        text: `Xác nhận lưu ${window.tempPastedLayers.length} ô đa giác vào bản đồ?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Đồng ý chốt',
        cancelButtonText: 'Hủy'
    });

    if (!isConfirmed) return;

    document.getElementById('loading-screen').style.display = 'flex';

    // Thu thập các geometry mới (đã kéo) và metadata từ temp layers
    const polygonsToSave = [];
    window.tempPastedLayers.forEach(layer => {
        const geojson = layer.toGeoJSON();
        const polyData = layer.options.polyData;
        
        polygonsToSave.push({
            name: polyData.name,
            color: polyData.color,
            customer_count: polyData.customer_count,
            order_count: polyData.order_count,
            geometry: geojson.geometry
        });
    });

    try {
        const res = await fetch('/api/units/bulk-clone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                version_id: window.currentVersionId,
                polygons: polygonsToSave
            })
        });
        const data = await res.json();
        document.getElementById('loading-screen').style.display = 'none';

        if (data.success) {
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `Đã lưu thành công ${polygonsToSave.length} ô đa giác!`, timer: 2500, showConfirmButton: false });
            
            // Xóa các ô tạm khỏi bản đồ
            window.tempPastedLayers.forEach(l => {
                if (typeof map !== 'undefined') map.removeLayer(l);
            });
            window.tempPastedLayers = [];
            _cleanupTempGroupDrag();

            // Ẩn panel chốt
            const tempPasteActions = document.getElementById('temp-paste-actions');
            if (tempPasteActions) tempPasteActions.style.display = 'none';

            if (window.cancelBulkMode) window.cancelBulkMode();

            // Load lại bản đồ để hiện các ô chính thức từ DB
            if (window.loadMapData) window.loadMapData(window.currentVersionId);
        } else {
            Swal.fire("Lỗi chốt dán đa giác", data.message || "Không thể dán", "error");
        }
    } catch (err) {
        document.getElementById('loading-screen').style.display = 'none';
        console.error("Confirm paste error:", err);
        Swal.fire("Lỗi kết nối", err.message, "error");
    }
};

window.cancelPasteUnits = function() {
    if (!window.tempPastedLayers || window.tempPastedLayers.length === 0) return;

    // Xóa các ô tạm khỏi bản đồ
    window.tempPastedLayers.forEach(l => {
        if (typeof map !== 'undefined') map.removeLayer(l);
    });
    window.tempPastedLayers = [];
    _cleanupTempGroupDrag();

    // Ẩn panel chốt
    const tempPasteActions = document.getElementById('temp-paste-actions');
    if (tempPasteActions) tempPasteActions.style.display = 'none';

    if (window.cancelBulkMode) window.cancelBulkMode();

    Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'Đã hủy các ô dán tạm thời.', timer: 2000, showConfirmButton: false });
};

// Mở rộng/Wrap window.cancelBulkMode để dọn dẹp các ô tạm thời
setTimeout(() => {
    const originalCancelBulkMode = window.cancelBulkMode;
    window.cancelBulkMode = function() {
        if (typeof originalCancelBulkMode === 'function') {
            originalCancelBulkMode();
        }
        
        // Clear các ô tạm thời khỏi bản đồ
        if (window.tempPastedLayers && window.tempPastedLayers.length > 0) {
            window.tempPastedLayers.forEach(l => {
                if (typeof map !== 'undefined') map.removeLayer(l);
            });
            window.tempPastedLayers = [];
            _cleanupTempGroupDrag();
        }
        
        const tempPasteActions = document.getElementById('temp-paste-actions');
        if (tempPasteActions) {
            tempPasteActions.style.display = 'none';
        }
    };
}, 1000);

// Hàm khởi tạo Panel (Kéo/Co giãn) dùng chung
window.initGenericPanel = function(panelId, handleId) {
    const panel = document.getElementById(panelId);
    const header = document.getElementById(handleId);
    if (!panel || !header) return;

    let isDragging = false;
    let startX, startY, startLeft, startTop;

    header.onmousedown = (e) => {
        if (e.target.closest("button")) return;
        
        // Ngăn chặn việc bôi đen chữ khi bắt đầu kéo
        e.preventDefault();
        
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = panel.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;

        // Vô hiệu hóa chọn văn bản trên toàn trang
        document.body.style.userSelect = 'none';

        const onMouseMove = (e) => {
            if (!isDragging) return;
            panel.style.left = startLeft + (e.clientX - startX) + "px";
            panel.style.top = startTop + (e.clientY - startY) + "px";
            panel.style.right = "auto";
            panel.style.bottom = "auto";
        };

        const onMouseUp = () => {
            isDragging = false;
            // Khôi phục lại khả năng chọn văn bản
            document.body.style.userSelect = '';
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    };

    const resizers = panel.querySelectorAll(".resizer");
    resizers.forEach((resizer) => {
        resizer.onmousedown = (e) => {
            e.preventDefault();
            const type = resizer.classList[1];
            const startW = panel.offsetWidth;
            const startH = panel.offsetHeight;
            const startMouseX = e.clientX;
            const startMouseY = e.clientY;
            const startL = panel.offsetLeft;
            const startT = panel.offsetTop;

            const onMouseMove = (e) => {
                if (type.includes("r")) panel.style.width = startW + (e.clientX - startMouseX) + "px";
                if (type.includes("b")) panel.style.height = startH + (e.clientY - startMouseY) + "px";
                if (type.includes("l")) {
                    const newWidth = startW - (e.clientX - startMouseX);
                    if (newWidth > 150) {
                        panel.style.width = newWidth + "px";
                        panel.style.left = startL + (e.clientX - startMouseX) + "px";
                    }
                }
                if (type.includes("t")) {
                    const newHeight = startH - (e.clientY - startMouseY);
                    if (newHeight > 50) {
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

// ================================================================
//  RUBBER-BAND DRAG SELECTION
// ================================================================
(function initDragSelect() {
    const selBox = document.getElementById('drag-select-box');
    if (!selBox) return;

    let isDragging = false;
    let startX = 0, startY = 0;

    const mapEl = document.getElementById('map');

    mapEl.addEventListener('mousedown', function (e) {
        if (window._cursorMode !== 'select') return;
        if (e.button !== 0) return;
        if (e.target.closest('#cursor-mode-toolbar, #bulk-action-panel, #unit-info-panel, #stats-summary-panel')) return;

        // MỚI: Nếu click vào một đa giác đã được chọn, không hiện hộp chọn vùng (để nhường chỗ cho việc kéo cụm)
        let clickedOnSelected = false;
        if (window.geoJsonLayer && window.selectedUnitsList.length > 0) {
            window.geoJsonLayer.eachLayer(l => {
                if (window.selectedUnitsList.includes(l.options.id)) {
                    if (e.target === l.getElement()) clickedOnSelected = true;
                }
            });
        }
        if (clickedOnSelected) return;

        isDragging = true;
        const rect = mapEl.getBoundingClientRect();
        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;

        selBox.style.left = startX + 'px';
        selBox.style.top = startY + 'px';
        selBox.style.width = '0px';
        selBox.style.height = '0px';
        selBox.style.display = 'block';

        // Kích hoạt bulk mode nếu chưa bật
        if (!window.isBulkSelectMode) {
            window.isBulkSelectMode = true;
            const tbBtn = document.getElementById('toggle-bulk-mode-btn');
            if (tbBtn) tbBtn.classList.add('active');
            const panel = document.getElementById('bulk-action-panel');
            if (panel) panel.style.display = 'flex';
        }
    });

    mapEl.addEventListener('mousemove', function (e) {
        if (!isDragging) return;
        const rect = mapEl.getBoundingClientRect();
        const curX = e.clientX - rect.left;
        const curY = e.clientY - rect.top;

        const x = Math.min(startX, curX);
        const y = Math.min(startY, curY);
        const w = Math.abs(curX - startX);
        const h = Math.abs(curY - startY);

        selBox.style.left = x + 'px';
        selBox.style.top = y + 'px';
        selBox.style.width = w + 'px';
        selBox.style.height = h + 'px';
    });

    window.addEventListener('mouseup', function (e) {
        if (!isDragging) return;
        isDragging = false;
        selBox.style.display = 'none';

        if (window._cursorMode !== 'select') return;
        if (!window.geoJsonLayer || typeof map === 'undefined') return;

        // Tọa độ của hộp chọn trên màn hình → chuyển sang LatLng bounds
        const mapEl2 = document.getElementById('map');
        const rect = mapEl2.getBoundingClientRect();
        const curX = e.clientX - rect.left;
        const curY = e.clientY - rect.top;

        // Convert pixel coords to map coords
        const x1 = Math.min(startX, curX);
        const y1 = Math.min(startY, curY);
        const x2 = Math.max(startX, curX);
        const y2 = Math.max(startY, curY);

        // Nếu hộp quá nhỏ (< 5px) bỏ qua — coi như click thường
        if ((x2 - x1) < 5 && (y2 - y1) < 5) return;

        const sw = map.containerPointToLatLng([x1, y2]);
        const ne = map.containerPointToLatLng([x2, y1]);
        const selBounds = L.latLngBounds(sw, ne);

        // Tìm tất cả polygon nằm trong bounds
        window.geoJsonLayer.eachLayer(function (layer) {
            if (!layer.getBounds) return;
            const lb = layer.getBounds();
            if (!selBounds.intersects(lb)) return;

            const unitId = layer.options.id;
            if (!unitId) return;

            if (!window.selectedUnitsList.includes(unitId)) {
                window.selectedUnitsList.push(unitId);
                const el = layer.getElement();
                if (el) el.classList.add('marching-ants-path');
                
                // KHÔNG gọi pm.enable ở đây để không hiện đỉnh (đúng ý user)
            }
        });

        const countSpan = document.getElementById('bulk-count');
        if (countSpan) countSpan.innerText = window.selectedUnitsList.length;
    });
})();

// ================================================================
//  COPY SELECTED UNITS (Hỗ trợ cả đơn lẻ và nhiều ô chọn)
// ================================================================
window.copySelectedUnits = function () {
    let targetIds = [];
    if (window.selectedUnitsList && window.selectedUnitsList.length > 0) {
        targetIds = [...window.selectedUnitsList];
    } else if (window.currentSelectedLayer) {
        const singleId = window.currentSelectedLayer.options.id;
        if (singleId) targetIds = [singleId];
    }

    if (targetIds.length === 0) {
        Swal.fire({ toast: true, position: 'top-end', icon: 'warning', title: 'Chưa chọn ô nào để copy!', timer: 2000, showConfirmButton: false });
        return;
    }
    if (!window.geoJsonLayer) return;

    const copyData = [];
    const textLines = [];
    textLines.push(`Đã chọn ${targetIds.length} ô:`);
    textLines.push('---');

    window.geoJsonLayer.eachLayer(function (layer) {
        const uid = layer.options.id;
        if (!targetIds.includes(uid)) return;
        const f = layer.feature;
        if (!f) return;
        
        copyData.push({
            name: f.properties.name,
            geometry: f.geometry,
            customer_count: f.properties.customers || f.properties.customer_count || 0,
            order_count: f.properties.orders || f.properties.order_count || 0,
            color: f.properties.color || f.properties.zoneColor || '#3388ff'
        });

        const area = f.properties.area ? f.properties.area.toFixed(4) : '0';
        textLines.push(`Tên: ${f.properties.name || 'N/A'} | ID: ${uid} | Khách: ${f.properties.customers || 0} | Đơn: ${f.properties.orders || 0} | Diện tích: ${area} km² | Màu: ${f.properties.color || '#ccc'}`);
    });

    // Lưu cục bộ trong bộ nhớ RAM
    window.copiedPolygonsData = copyData;

    // Lưu vào Clipboard dưới dạng JSON có ký hiệu riêng biệt
    const clipboardPayload = {
        type: 'gis-polygons',
        polygons: copyData,
        textSummary: textLines.join('\n')
    };

    const textToWrite = JSON.stringify(clipboardPayload);
    navigator.clipboard.writeText(textToWrite).then(() => {
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `Đã copy ${targetIds.length} ô đa giác (Ctrl+C)!`, timer: 2500, showConfirmButton: false });
    }).catch(() => {
        // Fallback ghi text thô
        const ta = document.createElement('textarea');
        ta.value = textLines.join('\n');
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `Đã copy ${targetIds.length} ô!`, timer: 2000, showConfirmButton: false });
    });
};

// ================================================================
//  ROTATE SELECTED UNITS (Xoay cụm)
// ================================================================
window.rotateSelectedUnits = async function () {
    if (!window.selectedUnitsList || window.selectedUnitsList.length === 0) {
        return Swal.fire("Thông báo", "Vui lòng chọn ít nhất 1 ô để xoay.", "info");
    }

    const { value: angle } = await Swal.fire({
        title: 'Xoay cụm đa giác',
        input: 'number',
        inputLabel: 'Nhập góc xoay (độ)',
        inputValue: 0,
        showCancelButton: true,
        confirmButtonText: 'Xoay',
        inputValidator: (value) => {
            if (isNaN(value)) return 'Vui lòng nhập một con số!';
        }
    });

    if (angle === undefined || angle === null) return;
    const rad = (parseFloat(angle) * Math.PI) / 180;

    // 1. Tính tâm của cụm (Centroid)
    let totalLat = 0, totalLng = 0, count = 0;
    const layersToRotate = [];

    window.geoJsonLayer.eachLayer(layer => {
        if (window.selectedUnitsList.includes(layer.options.id)) {
            layersToRotate.push(layer);
            const latlngs = layer.getLatLngs();
            const flat = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
            flat.forEach(ll => {
                totalLat += ll.lat;
                totalLng += ll.lng;
                count++;
            });
        }
    });

    if (count === 0) return;
    const center = { lat: totalLat / count, lng: totalLng / count };

    // 2. Xoay từng đỉnh của từng layer
    layersToRotate.forEach(layer => {
        const latlngs = layer.getLatLngs();
        // Xử lý đệ quy cho Polygon/MultiPolygon
        const rotatePoint = (ll) => {
            const x = ll.lng - center.lng;
            const y = ll.lat - center.lat;
            const newLng = x * Math.cos(rad) - y * Math.sin(rad) + center.lng;
            const newLat = x * Math.sin(rad) + y * Math.cos(rad) + center.lat;
            return L.latLng(newLat, newLng);
        };

        const transformRecursive = (arr) => {
            if (L.Util.isArray(arr[0])) {
                return arr.map(sub => transformRecursive(sub));
            }
            return arr.map(ll => rotatePoint(ll));
        };

        const newLatLngs = transformRecursive(latlngs);
        layer.setLatLngs(newLatLngs);

        // Lưu vào modifiedUnits để gửi lên server
        const gj = layer.toGeoJSON();
        window.modifiedUnits.set(layer.options.id, gj.geometry);
    });

    // Hiện thông báo lưu
    window.sendUpdatesToServer();
};

// ================================================================
//  TOGGLE GROUP MOVE MODE (Bật/Tắt Di chuyển cụm)
// ================================================================
window.isGroupMoveActive = false;
window._groupMoveCleanup = null;

window.toggleGroupMoveMode = function() {
    if (!window.selectedUnitsList || window.selectedUnitsList.length === 0) {
        return Swal.fire("Thông báo", "Vui lòng chọn các ô trước khi di chuyển.", "info");
    }

    const btn = document.getElementById('btn-bulk-move');
    window.isGroupMoveActive = !window.isGroupMoveActive;

    if (window.isGroupMoveActive) {
        // BẬT CHẾ ĐỘ DI CHUYỂN
        if (typeof map !== 'undefined') {
            map.dragging.disable();
            map.getContainer().style.cursor = 'move';
        }
        btn.style.backgroundColor = '#e74c3c';
        btn.innerHTML = '<i class="fa-solid fa-lock"></i> Chốt';
        
        // Gắn mouse events
        window._groupMoveCleanup = _attachGroupMoveEvents();
        
        Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'Kéo vào ô đã chọn để di chuyển cả cụm. Bấm Chốt khi xong.', timer: 3000, showConfirmButton: false });
    } else {
        // TẮT CHẾ ĐỘ DI CHUYỂN (CHỐT)
        if (window._groupMoveCleanup) {
            window._groupMoveCleanup();
            window._groupMoveCleanup = null;
        }
        if (typeof map !== 'undefined') {
            map.getContainer().style.cursor = '';
            map.dragging.enable();
        }
        btn.style.backgroundColor = '#3498db';
        btn.innerHTML = '<i class="fa-solid fa-arrows-up-down-left-right"></i> Di chuyển';

        // Sau khi chốt, lưu tất cả thay đổi
        window.sendUpdatesToServer();
        
        // Xóa viền chọn và trở về chế độ bình thường
        if (window.cancelBulkMode) window.cancelBulkMode();
        if (window.setCursorMode) window.setCursorMode('pan');
    }
};

// ================================================================
//  CUSTOM GROUP DRAG (Mouse events thuần - không dùng Geoman)
// ================================================================
function _attachGroupMoveEvents() {
    const mapContainer = map.getContainer();
    let isDragging = false;
    let lastLatLng = null;
    let initialPositions = new Map(); // lid -> cloned latlngs

    const selectedIds = window.selectedUnitsList.map(Number);

    // Lưu snapshot tọa độ gốc ngay khi bật chế độ
    if (window.geoJsonLayer) {
        window.geoJsonLayer.eachLayer(l => {
            const lid = parseInt(l.options.id);
            if (selectedIds.includes(lid)) {
                const latlngs = l.getLatLngs();
                const cloneDeep = (arr) => {
                    if (Array.isArray(arr[0])) return arr.map(sub => cloneDeep(sub));
                    return arr.map(ll => L.latLng(ll.lat, ll.lng));
                };
                initialPositions.set(lid, cloneDeep(latlngs));
            }
        });
    }

    // Biến tích lũy delta tổng
    let totalDeltaLat = 0;
    let totalDeltaLng = 0;

    function onMouseDown(e) {
        if (e.button !== 0) return; // Chỉ chuột trái
        if (e.target.closest('#bulk-action-panel, #cursor-mode-toolbar, #stats-summary-panel')) return;
        
        // Chuyển pixel sang latlng
        const rect = mapContainer.getBoundingClientRect();
        const point = L.point(e.clientX - rect.left, e.clientY - rect.top);
        const clickLatLng = map.containerPointToLatLng(point);
        
        // Kiểm tra xem click có nằm trên ô đã chọn không
        let hitSelected = false;
        if (window.geoJsonLayer) {
            window.geoJsonLayer.eachLayer(l => {
                const lid = parseInt(l.options.id);
                if (selectedIds.includes(lid) && l.getBounds && l.getBounds().contains(clickLatLng)) {
                    hitSelected = true;
                }
            });
        }
        
        if (!hitSelected) return;
        
        isDragging = true;
        lastLatLng = clickLatLng;
        mapContainer.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        e.preventDefault();
        e.stopPropagation();
    }

    function onMouseMove(e) {
        if (!isDragging || !lastLatLng) return;
        
        const rect = mapContainer.getBoundingClientRect();
        const point = L.point(e.clientX - rect.left, e.clientY - rect.top);
        const currentLatLng = map.containerPointToLatLng(point);
        
        const dLat = currentLatLng.lat - lastLatLng.lat;
        const dLng = currentLatLng.lng - lastLatLng.lng;
        
        totalDeltaLat += dLat;
        totalDeltaLng += dLng;
        
        // Di chuyển TẤT CẢ ô đã chọn dựa trên tọa độ gốc + tổng delta
        initialPositions.forEach((origCoords, lid) => {
            let targetLayer = null;
            window.geoJsonLayer.eachLayer(l => {
                if (parseInt(l.options.id) === lid) targetLayer = l;
            });
            if (!targetLayer) return;

            const movePoint = (ll) => L.latLng(ll.lat + totalDeltaLat, ll.lng + totalDeltaLng);
            const transformRecursive = (arr) => {
                if (Array.isArray(arr[0])) return arr.map(sub => transformRecursive(sub));
                return arr.map(ll => movePoint(ll));
            };
            
            targetLayer.setLatLngs(transformRecursive(origCoords));
        });

        lastLatLng = currentLatLng;
        e.preventDefault();
        e.stopPropagation();
    }

    function onMouseUp(e) {
        if (!isDragging) return;
        isDragging = false;
        lastLatLng = null;
        mapContainer.style.cursor = 'move';
        document.body.style.userSelect = '';
        
        // Cập nhật modifiedUnits
        initialPositions.forEach((_, lid) => {
            let targetLayer = null;
            window.geoJsonLayer.eachLayer(l => {
                if (parseInt(l.options.id) === lid) targetLayer = l;
            });
            if (targetLayer) {
                window.modifiedUnits.set(lid, targetLayer.toGeoJSON().geometry);
            }
        });
    }

    // Gắn events
    mapContainer.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);

    // Trả về hàm cleanup để gỡ bỏ khi tắt chế độ
    return function cleanup() {
        mapContainer.removeEventListener('mousedown', onMouseDown, true);
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('mouseup', onMouseUp, true);
        isDragging = false;
        lastLatLng = null;
        initialPositions.clear();
    };
}

// ================================================================
//  DELETE SELECTED UNITS
// ================================================================
window.deleteSelectedUnits = async function () {
    if (!window.selectedUnitsList || window.selectedUnitsList.length === 0) return;

    const result = await Swal.fire({
        title: `Xóa ${window.selectedUnitsList.length} ô?`,
        text: 'Dữ liệu sẽ mất vĩnh viễn. Bạn có chắc không?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonText: 'Hủy',
        confirmButtonText: 'Đồng ý xóa'
    });

    if (!result.isConfirmed) return;

    const ids = [...window.selectedUnitsList];
    let successCount = 0;

    for (const uid of ids) {
        try {
            const res = await fetch(`/api/units/${uid}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) successCount++;
        } catch (_) { /* bỏ qua lỗi đơn lẻ */ }
    }

    window.cancelBulkMode();
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `Đã xóa ${successCount}/${ids.length} ô!`, timer: 2500, showConfirmButton: false })
        .then(() => { if (window.loadMapData) window.loadMapData(window.currentVersionId); });
};


if (currentUser) {
    var map = L.map('map').setView([21.02, 105.84], 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Kích hoạt tính năng di chuyển cụm toàn cục
    if (currentUser.role === 'admin' && window.setupGlobalGroupMove) {
        window.setupGlobalGroupMove(map);
    }

    // --- NGĂN CHẶN MAP NHẬN SỰ KIỆN KHI THAO TÁC TRÊN PANEL ---
    const stopPropagationElements = [
        'stats-summary-panel',
        'unit-info-panel',
        'bulk-action-panel',
        'sidebar',
        'bottom-management-panel'
    ];
    stopPropagationElements.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            L.DomEvent.disableClickPropagation(el);
            L.DomEvent.disableScrollPropagation(el);
            // Bổ sung cho các sự kiện chạm và wheel nâng cao
            L.DomEvent.on(el, 'contextmenu dblclick wheel mousewheel touchstart', L.DomEvent.stopPropagation);
        }
    });

    // --- ĐOẠN 1: HIỆN NÚT VẼ (Chỉ Admin mới thấy) ---
    if (currentUser.role === 'admin') {
        // --- CUSTOM EDIT MODE STATE ---
        window.isCustomEditMode = false;      // Trạng thái nút Edit tùy chỉnh
        window.editingLayers = new Set();     // Tập hợp các layer đang được chỉnh sửa

        // Bật snapping toàn cục khi vẽ
        map.pm.setGlobalOptions({
            snappable: true,
            snapDistance: 15,
            snapMiddle: false,
            snapSegment: true,
            allowSelfIntersection: false,
            snappingDistance: 20,
        });

        // Hiện các nút vẽ (KHÔNG bật editMode mặc định của Geoman)
        map.pm.addControls({
            position: 'topleft',
            drawMarker: false,
            drawPolyline: true,
            drawCircle: false,
            drawCircleMarker: false,
            drawRectangle: true,
            drawPolygon: true,
            editMode: false,      // TẮT nút Edit mặc định - dùng custom button
            dragMode: true,
            removalMode: true,
            cutPolygon: false,
            rotateMode: true,
        });

        // ----- NÚT EDIT TÙY CHỈNH (thanh bên trái bản đồ) -----
        // Thêm nút custom Edit vào toolbar của Geoman
        map.pm.Toolbar.createCustomControl({
            name: 'customEditMode',
            block: 'edit',
            title: 'Chỉnh sửa ranh giới đa giác',
            className: 'custom-edit-btn',
            toggle: true,
            onClick: () => {
                window.isCustomEditMode = !window.isCustomEditMode;
                if (!window.isCustomEditMode) {
                    // Tắt edit mode: tắt tất cả layer đang edit
                    window.editingLayers.forEach(layer => {
                        if (layer.pm) layer.pm.disable();
                    });
                    window.editingLayers.clear();
                    // Lưu các thay đổi
                    setTimeout(sendUpdatesToServer, 300);
                    map.getContainer().style.cursor = '';
                } else {
                    map.getContainer().style.cursor = 'crosshair';
                }
            },
            afterClick: () => { }
        });

        // ----- HÀM GỬI DỮ LIỆU LÊN SERVER (Bulk Update) -----
        window.sendUpdatesToServer = async function sendUpdatesToServer() {
            if (window.modifiedUnits.size === 0) return;

            const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 4000 });
            Toast.fire({ icon: 'info', title: 'Đang kiểm tra và lưu ranh giới...' });

            const updates = [];
            for (let [id, geometry] of window.modifiedUnits) {
                updates.push({ id, geometry });
            }

            try {
                const response = await fetch('/api/units/bulk-update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        updates: updates,
                        version_id: window.currentVersionId
                    })
                });
                const data = await response.json();

                if (response.ok && data.success) {
                    window.modifiedUnits.clear();
                    const Toast2 = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2500 });
                    Toast2.fire({ icon: 'success', title: 'Đã lưu ranh giới thành công!' });
                    // Tải lại dữ liệu để cập nhật diện tích mới
                    if (window.loadMapData) window.loadMapData(window.currentVersionId);
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Lỗi ranh giới',
                        text: data.message || 'Phát hiện chồng lấn ranh giới với ô khác.'
                    }).then(() => {
                        location.reload();
                    });
                }
            } catch (err) {
                console.error("Bulk Update Error:", err);
                Swal.fire('Lỗi!', 'Không kết nối được tới Server.', 'error');
            }
        }

        // Dự phòng lưu khi tắt drag mode
        map.on('pm:globaldragmodedisabled', () => {
            setTimeout(sendUpdatesToServer, 300);
        });

        // ----- HÀM ĐỒNG BỘ ĐỈNH CHUNG KHI KÉO -----
        // Hàm tìm tất cả layer có đỉnh tại tọa độ (lat, lng) với ngưỡng sai số nhỏ
        function COORD_EPS() { return 1e-8; } // epsilon cho so sánh tọa độ

        function coordsMatch(a, b) {
            return Math.abs(a[0] - b[0]) < COORD_EPS() && Math.abs(a[1] - b[1]) < COORD_EPS();
        }

        // Lấy tất cả đỉnh (coords) của một layer GeoJSON polygon
        function getLayerCoords(layer) {
            const gj = layer.toGeoJSON();
            if (!gj || !gj.geometry) return [];
            const geom = gj.geometry;
            if (geom.type === 'Polygon') return geom.coordinates[0];
            if (geom.type === 'MultiPolygon') return geom.coordinates.flatMap(p => p[0]);
            return [];
        }

        // Khi kéo xong 1 đỉnh trong editingLayers, đồng bộ sang tất cả layer khác đang edit
        function syncSharedVertex(movedLayer, movedUnitId) {
            if (!window.geoJsonLayer) return;
            // Lấy tọa độ mới của layer vừa kéo
            const newCoords = getLayerCoords(movedLayer);

            // Duyệt tất cả các layer trên bản đồ
            window.geoJsonLayer.eachLayer(otherLayer => {
                if (otherLayer === movedLayer) return;
                if (!otherLayer.pm || !otherLayer.pm.enabled()) return;

                // Kiểm tra xem có đỉnh nào khớp không
                const otherCoords = getLayerCoords(otherLayer);
                let needsUpdate = false;

                // Lấy latlngs thực của layer kia
                let latlngs = otherLayer.getLatLngs();
                const flatLatlngs = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;

                flatLatlngs.forEach((latlng, idx) => {
                    // Tìm đỉnh mới nhất trong newCoords khớp với đỉnh này
                    newCoords.forEach(newPt => {
                        // So sánh với tọa độ gốc (trước khi edit) thông qua pm markers
                    });
                });

                // Phương pháp: compare marker handles của movedLayer với latlngs của otherLayer
                if (movedLayer.pm && movedLayer.pm._markers) {
                    const markerGroups = movedLayer.pm._markers;
                    const allMarkers = Array.isArray(markerGroups[0]) ? markerGroups[0] : markerGroups;

                    allMarkers.forEach(marker => {
                        const newLL = marker.getLatLng();
                        // Tìm đỉnh trong otherLayer có tọa độ TrướcKhi kéo gần với nhau
                        // Chúng ta dùng _origLatLng đã lưu trước đó
                        const origLL = marker._origLatLng;
                        if (!origLL) return;

                        flatLatlngs.forEach((otherLL, idx) => {
                            if (Math.abs(otherLL.lat - origLL.lat) < COORD_EPS() &&
                                Math.abs(otherLL.lng - origLL.lng) < COORD_EPS()) {
                                flatLatlngs[idx] = L.latLng(newLL.lat, newLL.lng);
                                needsUpdate = true;
                            }
                        });
                    });
                }

                if (needsUpdate) {
                    if (Array.isArray(latlngs[0])) {
                        otherLayer.setLatLngs([flatLatlngs]);
                    } else {
                        otherLayer.setLatLngs(flatLatlngs);
                    }
                    otherLayer.pm.reset(); // Cập nhật lại markers của geoman
                    const otherId = otherLayer.options.id;
                    if (otherId) {
                        window.modifiedUnits.set(otherId, otherLayer.toGeoJSON().geometry);
                    }
                }
            });
        }

        // Lưu tọa độ gốc (trước khi kéo) của tất cả marker khi bắt đầu kéo
        function attachOrigLatLng(layer) {
            if (!layer.pm || !layer.pm._markers) return;
            const markerGroups = layer.pm._markers;
            const allMarkers = Array.isArray(markerGroups[0]) ? markerGroups[0] : markerGroups;
            allMarkers.forEach(marker => {
                marker._origLatLng = marker.getLatLng();
                marker.on('drag', () => {
                    // Cập nhật real-time tọa độ gốc của các marker KHÁC trong layer này
                    // (không thay đổi _origLatLng của chính nó trong lúc kéo)
                });
            });
        }

        // Hiện thêm cái khung Admin Tools ở Sidebar (đã tạo ở HTML)
        const adminTools = document.getElementById('admin-tools');
        if (adminTools) adminTools.style.display = 'block';
    }

    // Wrap in function
    window.loadMapData = function (versionId) {
        // Fallback về currentVersionId nếu không truyền vào
        if (!versionId) versionId = window.currentVersionId;
        // Remove old layer if exists
        if (window.geoJsonLayer && typeof map !== 'undefined') {
            map.removeLayer(window.geoJsonLayer);
        }

        // Tải ALL Units cho versionId cụ thể
        fetch(`/api/units?versionId=${versionId || ''}`)
            .then(res => {
                // --- CHỖ CẦN THÊM: Kiểm tra trạng thái Server ---
                console.log("Status Code từ Server:", res.status);
                if (!res.ok) {
                    throw new Error(`Server báo lỗi: ${res.status}`);
                }
                return res.json();
            })
            .then(data => {
                // --- CHỖ CẦN THÊM: Kiểm tra dữ liệu thực tế ---
                console.log("Dữ liệu nhận được:", data);

                if (!data.features) {
                    throw new Error("Dữ liệu không đúng định dạng GeoJSON (thiếu features)");
                }

                const layerGroup = L.geoJSON(data, {
                    style: function (f) {
                        return {
                            color: "#333", weight: 2, fillOpacity: 0.5,
                            fillColor: f.properties.color || '#ccc'
                        };
                    },
                    onEachFeature: function (f, l) {
                        const unitId = f.id || (f.properties && f.properties.id);
                        l.options.id = unitId;

                        // --- GHI NHẬN KHI KÉO CẢ Ô / CẮT / ROTATE ---
                        const markAsModified = () => {
                            if (unitId) window.modifiedUnits.set(unitId, l.toGeoJSON().geometry);
                        };
                        l.on('pm:dragend', markAsModified);
                        l.on('pm:cut', markAsModified);
                        l.on('pm:rotateend', markAsModified);

                        // Kích hoạt tính năng di chuyển cụm nếu là admin
                        if (currentUser && currentUser.role === 'admin' && window.initGroupMove) {
                            window.initGroupMove(l);
                        }

                        // --- ĐỒNG BỘ ĐỈNH CHUNG KHI KÉO (pm:markerdrag) ---
                        // Lưu snapshot vị trí TRƯỚC khi kéo cho marker đang active
                        l.on('pm:markerdragstart', (ev) => {
                            if (ev.marker) ev.marker._origLatLng = ev.marker.getLatLng();
                        });

                        l.on('pm:markerdrag', (ev) => {
                            if (!window.geoJsonLayer || !ev.marker) return;
                            const draggedMarker = ev.marker;
                            const newLL = draggedMarker.getLatLng();
                            const origLL = draggedMarker._origLatLng;
                            if (!origLL) return;

                            window.geoJsonLayer.eachLayer(otherLayer => {
                                if (otherLayer === l) return;
                                if (!otherLayer.pm || !otherLayer.pm.enabled()) return;

                                let lls = otherLayer.getLatLngs();
                                // Polygon: lls = [[pt, pt, ...]] ; MultiPolygon: lls = [[[pt, ...]]]
                                const isMulti = Array.isArray(lls[0]) && Array.isArray(lls[0][0]);
                                const ring = isMulti ? lls[0][0] : (Array.isArray(lls[0]) ? lls[0] : lls);

                                let changed = false;
                                for (let i = 0; i < ring.length; i++) {
                                    if (Math.abs(ring[i].lat - origLL.lat) < 1e-8 &&
                                        Math.abs(ring[i].lng - origLL.lng) < 1e-8) {
                                        ring[i] = L.latLng(newLL.lat, newLL.lng);
                                        changed = true;
                                    }
                                }
                                if (changed) {
                                    if (isMulti) otherLayer.setLatLngs([[ring]]);
                                    else if (Array.isArray(lls[0])) otherLayer.setLatLngs([ring]);
                                    else otherLayer.setLatLngs(ring);
                                    // Refresh pm markers của layer kia
                                    if (otherLayer.pm && otherLayer.pm._markers) {
                                        try { otherLayer.pm.reset(); } catch (_) { }
                                    }
                                }
                            });
                        });

                        l.on('pm:markerdragend', () => {
                            // Lưu layer này
                            markAsModified();
                            // Lưu tất cả layer đang edit cùng bị tác động
                            if (!window.geoJsonLayer) return;
                            window.geoJsonLayer.eachLayer(otherLayer => {
                                if (otherLayer === l) return;
                                if (!otherLayer.pm || !otherLayer.pm.enabled()) return;
                                const otherId = otherLayer.options.id;
                                if (otherId) window.modifiedUnits.set(otherId, otherLayer.toGeoJSON().geometry);
                            });
                        });

                        // --- CLICK: TOGGLE EDIT (khi isCustomEditMode) hoặc HIỆN THÔNG TIN ---
                        const areaFormatted = f.properties.area ? f.properties.area.toFixed(2) : "0.00";
                        l.on('click', function (e) {
                            // 1. Bulk select mode
                            if (window.isBulkSelectMode || (e.originalEvent && (e.originalEvent.shiftKey || e.originalEvent.ctrlKey))) {
                                if (!unitId) return;
                                if (!window.isBulkSelectMode) {
                                    window.isBulkSelectMode = true;
                                    const tbBtn = document.getElementById('toggle-bulk-mode-btn');
                                    if (tbBtn) tbBtn.classList.add('active');
                                    const panel = document.getElementById('bulk-action-panel');
                                    if (panel) panel.style.display = 'flex';
                                    if (window.clearSelectedPolygon) window.clearSelectedPolygon();
                                }
                                const idx = window.selectedUnitsList.indexOf(unitId);
                                if (idx > -1) {
                                    window.selectedUnitsList.splice(idx, 1);
                                    if (l.getElement()) l.getElement().classList.remove('marching-ants-path');
                                } else {
                                    window.selectedUnitsList.push(unitId);
                                    if (l.getElement()) l.getElement().classList.add('marching-ants-path');
                                }
                                const countSpan = document.getElementById('bulk-count');
                                if (countSpan) countSpan.innerText = window.selectedUnitsList.length;
                                return;
                            }

                            // 2. Custom edit mode: toggle per-polygon editing
                            if (window.isCustomEditMode) {
                                if (e.originalEvent) e.originalEvent.stopPropagation();
                                if (l.pm && l.pm.enabled()) {
                                    // Đang edit → TẮT
                                    l.pm.disable();
                                    if (window.editingLayers) window.editingLayers.delete(l);
                                    l.setStyle({ weight: 2, color: '#333' });
                                } else {
                                    // Chưa edit → BẬT
                                    l.pm.enable({ allowSelfIntersection: false });
                                    if (window.editingLayers) window.editingLayers.add(l);
                                    l.setStyle({ weight: 3, color: '#7d33ff' });
                                    // Gán _origLatLng cho markers sau khi Geoman render xong
                                    setTimeout(() => {
                                        if (!l.pm || !l.pm._markers) return;
                                        const groups = l.pm._markers;
                                        const markers = Array.isArray(groups[0]) ? groups[0] : groups;
                                        markers.forEach(m => {
                                            m._origLatLng = m.getLatLng();
                                            m.on('mousedown', () => { m._origLatLng = m.getLatLng(); });
                                        });
                                    }, 120);
                                }
                                return;
                            }

                            // 3. Hiện panel thông tin bình thường
                            const currentProps = f.properties;
                            currentProps.id = unitId;
                            updateSidebarStats(currentProps);
                            if (currentUser && currentUser.role === 'admin') {
                                updateSidebarAdmin(unitId, currentProps);
                            }

                            // ✨ Highlight viền vàng polygon đang chọn
                            window.clearSelectedPolygon();          // Xóa highlight cũ
                            const selEl = l.getElement();
                            if (selEl) selEl.classList.add('polygon-selected');
                            window.currentSelectedLayer = l;        // Lưu lại để reset sau

                            // Highlight card trong danh sách quản lý (nếu panel đang mở)
                            if (window.highlightUnitCard) window.highlightUnitCard(unitId);
                            const currentColor = f.properties.color || f.properties.zoneColor || '#cccccc';
                            let colorRow = '';
                            if (currentUser && currentUser.role === 'admin') {
                                colorRow = `
                                    <div class="panel-color-row">
                                        <label>Màu đa giác:</label>
                                        <input type="color" id="colorPicker-${unitId}" value="${currentColor}">
                                        <button class="btn-change-color" onclick="changeUnitColor(${unitId})">Đổi Màu</button>
                                    </div>
                                `;
                            }
                            document.getElementById('unit-info-panel-title').innerHTML =
                                `<i class="fa-solid fa-map-pin"></i> 📦 ${f.properties.name}`;
                            document.getElementById('unit-info-panel-body').innerHTML = `
                                <table>
                                    <tr><td>Diện tích:</td><td>${areaFormatted} km²</td></tr>
                                    <tr><td>Khách:</td><td>${f.properties.customers || 0}</td></tr>
                                    <tr><td>Đơn:</td><td>${f.properties.orders || 0}</td></tr>
                                </table>
                                ${colorRow}
                            `;
                            document.getElementById('unit-info-panel').classList.add('visible');
                        });

                        l.on('pm:remove', () => {
                            Swal.fire({
                                title: `Xóa ô "${f.properties.name}"?`,
                                text: "Dữ liệu này sẽ mất vĩnh viễn. Bạn có chắc không ?",
                                icon: 'warning',
                                showCancelButton: true,
                                confirmButtonColor: '#d33',
                                cancelButtonText: 'Hủy',
                                confirmButtonText: 'Đồng ý xóa'
                            }).then((result) => {
                                if (result.isConfirmed) {
                                    fetch(`/api/units/${unitId}`, { method: 'DELETE' })
                                        .then(res => res.json())
                                        .then(data => {
                                            if (data.success) {
                                                Swal.fire('Đã xóa!', 'Ô đã được gỡ khỏi bản đồ.', 'success');
                                            } else {
                                                Swal.fire('Lỗi!', 'Không thể xóa dữ liệu.', 'error');
                                                location.reload();
                                            }
                                        });
                                } else {
                                    location.reload();
                                }
                            });
                        });

                    }
                });
                window.geoJsonLayer = layerGroup;
                layerGroup.addTo(map);

                // --- Cập nhật danh sách Ô đa giác ở sidebar ---
                if (window.renderDistrictManagementList && data.features) {
                    const unitsData = data.features.map(f => ({
                        id: f.id || f.properties.id,
                        name: f.properties.name,
                        color: f.properties.color || f.properties.zoneColor || '#ccc',
                        customer_count: f.properties.customers ?? 0,
                        order_count: f.properties.orders ?? 0,
                    }));
                    window.renderDistrictManagementList(unitsData);
                }

                if (currentUser && currentUser.role === 'admin') {
                    // Admin có quyền chỉnh sửa bất kỳ version nào đã được chọn
                    const canEdit = !!window.currentVersionId;
                    
                    if (!canEdit) {
                        map.pm.removeControls();
                        document.getElementById('admin-tools-content').innerHTML = `
                            <div style="padding: 10px; color: #dc3545; background: #f8d7da; border-radius: 5px; font-size: 13px;">
                                <b>Lưu ý:</b> Không thể vẽ ở trạng thái hiện tại.<br>
                                - Vui lòng chọn một <b>Phiên bản (Version)</b> ở mục Chọn Vùng để bắt đầu chỉnh sửa bản đồ.
                            </div>
                        `;
                    } else {
                        // Thêm lại các nút vẽ cơ bản
                        map.pm.addControls({
                            position: 'topleft',
                            drawMarker: false,
                            drawPolyline: true,
                            drawCircle: false,
                            drawCircleMarker: false,
                            drawRectangle: true,
                            drawPolygon: true,
                            editMode: false, // Dùng nút custom
                            dragMode: true,
                            removalMode: true,
                            cutPolygon: false,
                            rotateMode: true
                        });

                        // Thêm lại nút Edit tùy chỉnh (pencil)
                        if (!map.pm.Toolbar.getButtons().customEditMode) {
                            map.pm.Toolbar.createCustomControl({
                                name: 'customEditMode',
                                block: 'edit',
                                title: 'Bật/tắt chỉnh sửa ranh giới đa giác',
                                className: 'custom-edit-btn',
                                toggle: true,
                                onClick: () => {
                                    window.isCustomEditMode = !window.isCustomEditMode;
                                    if (!window.isCustomEditMode) {
                                        if (window.editingLayers) {
                                            window.editingLayers.forEach(layer => {
                                                if (layer.pm) layer.pm.disable();
                                                layer.setStyle({ weight: 2, color: '#333' });
                                            });
                                            window.editingLayers.clear();
                                        }
                                        if (window.modifiedUnits.size > 0) setTimeout(window.sendUpdatesToServer, 300);
                                        map.getContainer().style.cursor = '';
                                    } else {
                                        map.getContainer().style.cursor = 'crosshair';
                                    }
                                }
                            });
                        }
                        document.getElementById('admin-tools-content').innerHTML = '<p class="empty-msg">Click vào ô muốn chỉnh sửa khi ở chế độ Edit ✏️. Bấm lại vào ô đó để tắt.</p>';
                    }
                }
            })
            .catch(err => {
                // --- CHỖ NÀY SẼ HIỆN LỖI CHI TIẾT ---
                console.error("Lỗi chi tiết:", err.message);
                Swal.fire({
                    icon: 'error',
                    title: 'Lỗi tải bản đồ',
                    text: err.message // Hiện thẳng lỗi ra để biết đường sửa
                });
            });

        // --- ĐOẠN 2: KHI VẼ XONG MỘT Ô ---
        map.off('pm:create'); // Tránh duplicate event listener khi loadMapData chạy nhiều lần
        map.on('pm:create', async (e) => {
            const layer = e.layer;
            const geometry = layer.toGeoJSON().geometry; // Lấy tọa độ vừa vẽ

            // Bỏ qua khi Geoman cắt bằng Scissors (pm:cut xử lý riêng), không cần kiểm tra overlap
            if (e.shape === 'Cut') {
                layer.remove(); // Xóa mảnh tạm của Geoman, reload để refetch
                return;
            }

            if (e.shape === 'Line') {
                // TÍNH NĂNG MỚI: CẮT ĐA GIÁC BẰNG ĐƯỜNG KẺ
                document.getElementById('loading-screen').style.display = 'flex';
                fetch('/api/units/split', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ geometry, version_id: window.currentVersionId })
                }).then(res => res.json()).then(data => {
                    document.getElementById('loading-screen').style.display = 'none';
                    if (data.success) {
                        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: data.message, timer: 3000, showConfirmButton: false });
                        setTimeout(() => location.reload(), 1500);
                    } else {
                        Swal.fire('Thất bại', data.message, 'error');
                        layer.remove(); // Xóa đường kẻ hỏng vì không cắt qua
                    }
                }).catch(err => {
                    document.getElementById('loading-screen').style.display = 'none';
                    Swal.fire('Lỗi', err.message, 'error');
                    layer.remove();
                });
                return; // Ngừng logic của 'Polygon' (vẽ thêm ô)
            }

            // 1. Kiểm tra chồng lấn trước
            document.getElementById('loading-screen').style.display = 'flex';
            try {
                const res = await fetch('/api/units/check-overlap', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ geometry, version_id: window.currentVersionId })
                });
                const data = await res.json();
                document.getElementById('loading-screen').style.display = 'none';

                if (data.overlap) {
                    Swal.fire({
                        icon: 'error',
                        title: 'Đè Ranh Giới!',
                        text: `Ô vừa vẽ đã lấn vào khu vực của "${data.name}". Vui lòng vẽ lại!`,
                        confirmButtonText: 'OK',
                        confirmButtonColor: '#d33'
                    }).then(() => {
                        location.reload();
                    });
                    return; // Không hiện popup nhập liệu
                }
            } catch (err) {
                document.getElementById('loading-screen').style.display = 'none';
                console.error("Lỗi:", err);
                return;
            }

            // 2. Nếu không lỗi, gọi hàm hiện bảng nhập thông tin
            showSaveForm(geometry, layer);
        });

        // ĐÓNG NGOẶC HÀM loadMapData (Được thêm bởi thay đổi trước đó)
    };

    if (currentUser.role !== 'admin') {
        // Render map for driver - currently just loading all units as districts are gone
        window.loadMapData();
    }
}



