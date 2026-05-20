const fs = require('fs');
const path = require('path');
const pool = require('../db');

// Rút gọn giá trị để chèn vào câu lệnh SQL INSERT
function escapeSqlValue(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'number') return val.toString();
    if (val instanceof Date) return `'${val.toISOString()}'`;
    if (typeof val === 'string') {
        // Nếu là toạ độ hình học (hex string dài), không cần escape chuỗi ký tự thường
        if (/^[0-9A-Fa-f]+$/.test(val) && val.length > 30) {
            return `'${val}'`;
        }
        return `'${val.replace(/'/g, "''")}'`;
    }
    return `'${val.toString().replace(/'/g, "''")}'`;
}

async function generateDump() {
    console.log('=== KHỞI CHẠY DUMP GENERATOR THỦ CÔNG ===');
    
    try {
        // BƯỚC 1: Cập nhật tên Vùng miền thành "Toàn quốc" theo yêu cầu người dùng
        console.log('Cập nhật tên Vùng miền ID = 1 thành "Toàn quốc"...');
        await pool.query("UPDATE regions SET name = 'Toàn quốc' WHERE id = 1;");
        console.log('  - Cập nhật thành công.');

        const dumpFilePath = path.join(__dirname, '../database_dump.sql');
        let sql = '';

        // Header SQL
        sql += `--\n-- PostgreSQL database dump\n--\n\n`;
        sql += `SET statement_timeout = 0;\n`;
        sql += `SET lock_timeout = 0;\n`;
        sql += `SET idle_in_transaction_session_timeout = 0;\n`;
        sql += `SET transaction_timeout = 0;\n`;
        sql += `SET client_encoding = 'UTF8';\n`;
        sql += `SET standard_conforming_strings = on;\n`;
        sql += `SELECT pg_catalog.set_config('search_path', '', false);\n`;
        sql += `SET check_function_bodies = false;\n`;
        sql += `SET xmloption = content;\n`;
        sql += `SET client_min_messages = warning;\n`;
        sql += `SET row_security = off;\n\n`;

        // Extension PostGIS
        sql += `--\n-- Name: postgis; Type: EXTENSION; Schema: -\n--\n\n`;
        sql += `CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;\n\n`;

        // User Defined Functions
        sql += `--\n-- Name: check_no_overlap(); Type: FUNCTION\n--\n\n`;
        sql += `CREATE OR REPLACE FUNCTION public.check_no_overlap()\n`;
        sql += ` RETURNS trigger\n`;
        sql += ` LANGUAGE plpgsql\n`;
        sql += ` AS $$\n`;
        sql += `BEGIN\n`;
        sql += `    NEW.geom := ST_MakeValid(NEW.geom);\n\n`;
        sql += `    IF EXISTS (\n`;
        sql += `        SELECT 1 FROM basic_units \n`;
        sql += `        WHERE id != COALESCE(NEW.id, -1)\n`;
        sql += `        AND ST_Intersects(geom, NEW.geom) \n`;
        sql += `        AND ST_GeometryType(ST_Intersection(geom, NEW.geom)) IN ('ST_Polygon', 'ST_MultiPolygon')\n`;
        sql += `        AND ST_Area(ST_Intersection(geom, NEW.geom)) > (ST_Area(NEW.geom) * 0.1)\n`;
        sql += `    ) THEN\n`;
        sql += `        RAISE EXCEPTION 'Lỗi: Ô này đang bị chồng lấn quá 10%% lên ô khác!';\n`;
        sql += `    END IF;\n`;
        sql += `    \n`;
        sql += `    RETURN NEW;\n`;
        sql += `END;\n`;
        sql += `$$;\n\n`;

        sql += `--\n-- Name: fn_auto_calculate_bu(); Type: FUNCTION\n--\n\n`;
        sql += `CREATE OR REPLACE FUNCTION public.fn_auto_calculate_bu()\n`;
        sql += ` RETURNS trigger\n`;
        sql += ` LANGUAGE plpgsql\n`;
        sql += ` AS $$\n`;
        sql += `BEGIN\n`;
        sql += `    NEW.centroid := ST_Centroid(NEW.geom);\n`;
        sql += `    NEW.area_km2 := ST_Area(ST_Transform(NEW.geom, 3857)) / 1000000;\n`;
        sql += `    RETURN NEW;\n`;
        sql += `END;\n`;
        sql += `$$;\n\n`;

        sql += `--\n-- Name: fn_update_bu_metadata(); Type: FUNCTION\n--\n\n`;
        sql += `CREATE OR REPLACE FUNCTION public.fn_update_bu_metadata()\n`;
        sql += ` RETURNS trigger\n`;
        sql += ` LANGUAGE plpgsql\n`;
        sql += ` AS $$\n`;
        sql += `BEGIN\n`;
        sql += `    NEW.centroid := ST_Centroid(NEW.geom);\n`;
        sql += `    NEW.area_km2 := ST_Area(ST_Transform(NEW.geom, 3857)) / 1000000;\n`;
        sql += `    RETURN NEW;\n`;
        sql += `END;\n`;
        sql += `$$;\n\n`;

        // BƯỚC 2: Định nghĩa cấu trúc bảng (CREATE TABLE)
        console.log('Tạo các câu lệnh cấu trúc bảng...');

        // 1. regions
        sql += `CREATE TABLE public.regions (\n`;
        sql += `    id integer NOT NULL,\n`;
        sql += `    name character varying NOT NULL\n`;
        sql += `);\n\n`;

        // 2. provinces
        sql += `CREATE TABLE public.provinces (\n`;
        sql += `    id integer NOT NULL,\n`;
        sql += `    name character varying NOT NULL,\n`;
        sql += `    region_id integer\n`;
        sql += `);\n\n`;

        // 3. versions
        sql += `CREATE TABLE public.versions (\n`;
        sql += `    id integer NOT NULL,\n`;
        sql += `    name character varying NOT NULL,\n`;
        sql += `    province_id integer,\n`;
        sql += `    status character varying DEFAULT 'draft'::character varying,\n`;
        sql += `    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,\n`;
        sql += `    is_optimizing boolean DEFAULT false\n`;
        sql += `);\n\n`;

        // 4. drivers
        sql += `CREATE TABLE public.drivers (\n`;
        sql += `    id integer NOT NULL,\n`;
        sql += `    name character varying NOT NULL,\n`;
        sql += `    phone character varying,\n`;
        sql += `    license_plate character varying\n`;
        sql += `);\n\n`;

        // 5. users
        sql += `CREATE TABLE public.users (\n`;
        sql += `    id integer NOT NULL,\n`;
        sql += `    username character varying NOT NULL,\n`;
        sql += `    password character varying NOT NULL,\n`;
        sql += `    full_name character varying,\n`;
        sql += `    role character varying NOT NULL,\n`;
        sql += `    driver_id integer,\n`;
        sql += `    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,\n`;
        sql += `    province_id integer\n`;
        sql += `);\n\n`;

        // 6. basic_units
        sql += `CREATE TABLE public.basic_units (\n`;
        sql += `    id integer NOT NULL,\n`;
        sql += `    name character varying,\n`;
        sql += `    geom public.geometry(Polygon,4326),\n`;
        sql += `    customer_count integer DEFAULT 0,\n`;
        sql += `    order_count integer DEFAULT 0,\n`;
        sql += `    area_km2 double precision,\n`;
        sql += `    centroid public.geometry(Point,4326),\n`;
        sql += `    created_by integer,\n`;
        sql += `    color character varying,\n`;
        sql += `    version_id integer\n`;
        sql += `);\n\n`;

        // 7. unit_adjacencies
        sql += `CREATE TABLE public.unit_adjacencies (\n`;
        sql += `    unit_a_id integer NOT NULL,\n`;
        sql += `    unit_b_id integer NOT NULL,\n`;
        sql += `    version_id integer\n`;
        sql += `);\n\n`;

        // 8. optimization_jobs
        sql += `CREATE TABLE public.optimization_jobs (\n`;
        sql += `    id integer NOT NULL,\n`;
        sql += `    version_id integer NOT NULL,\n`;
        sql += `    status character varying DEFAULT 'pending'::character varying NOT NULL,\n`;
        sql += `    progress integer DEFAULT 0,\n`;
        sql += `    total integer DEFAULT 0,\n`;
        sql += `    message text,\n`;
        sql += `    started_at timestamp with time zone,\n`;
        sql += `    finished_at timestamp with time zone,\n`;
        sql += `    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP\n`;
        sql += `);\n\n`;

        // BƯỚC 3: Tạo các Sequence và gán mặc định tự tăng cho ID
        console.log('Tạo cấu trúc Sequence...');
        const tablesWithSeqs = [
            { name: 'regions', seq: 'regions_id_seq' },
            { name: 'provinces', seq: 'provinces_id_seq' },
            { name: 'versions', seq: 'versions_id_seq' },
            { name: 'drivers', seq: 'drivers_id_seq' },
            { name: 'users', seq: 'users_id_seq' },
            { name: 'basic_units', seq: 'basic_units_id_seq' },
            { name: 'optimization_jobs', seq: 'optimization_jobs_id_seq' }
        ];

        for (const item of tablesWithSeqs) {
            sql += `CREATE SEQUENCE public.${item.seq} AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;\n`;
            sql += `ALTER SEQUENCE public.${item.seq} OWNED BY public.${item.name}.id;\n`;
            sql += `ALTER TABLE ONLY public.${item.name} ALTER COLUMN id SET DEFAULT nextval('public.${item.seq}'::regclass);\n\n`;
        }

        // BƯỚC 4: Xuất dữ liệu (INSERT INTO) cho từng bảng kịch bản
        console.log('Quét dữ liệu các bảng và chuyển đổi thành câu lệnh SQL INSERT...');
        const tablesToDump = [
            { name: 'regions', cols: ['id', 'name'] },
            { name: 'provinces', cols: ['id', 'name', 'region_id'] },
            { name: 'versions', cols: ['id', 'name', 'province_id', 'status', 'created_at', 'is_optimizing'] },
            { name: 'drivers', cols: ['id', 'name', 'phone', 'license_plate'] },
            { name: 'users', cols: ['id', 'username', 'password', 'full_name', 'role', 'driver_id', 'created_at', 'province_id'] },
            { name: 'basic_units', cols: ['id', 'name', 'geom', 'customer_count', 'order_count', 'area_km2', 'centroid', 'created_by', 'color', 'version_id'] },
            { name: 'unit_adjacencies', cols: ['unit_a_id', 'unit_b_id', 'version_id'] },
            { name: 'optimization_jobs', cols: ['id', 'version_id', 'status', 'progress', 'total', 'message', 'started_at', 'finished_at', 'created_at'] }
        ];

        for (const table of tablesToDump) {
            console.log(`  - Đang xuất dữ liệu bảng "${table.name}"...`);
            const colList = table.cols.join(', ');
            
            // Xử lý riêng các trường địa lý hình học PostGIS để lấy chuỗi nhị phân Hex
            let selectQuery = `SELECT ${colList} FROM public."${table.name}" ORDER BY `;
            if (table.name === 'unit_adjacencies') {
                selectQuery += 'unit_a_id, unit_b_id';
            } else {
                selectQuery += 'id';
            }

            const dataRes = await pool.query(selectQuery);
            
            if (dataRes.rows.length > 0) {
                sql += `--\n-- Data for Name: ${table.name}; Type: TABLE DATA\n--\n\n`;
                for (const row of dataRes.rows) {
                    const values = table.cols.map(col => {
                        let val = row[col];
                        // Nếu là đối tượng Buffer (địa lý nhị phân), chuyển đổi sang Hex string
                        if (val instanceof Buffer) {
                            val = val.toString('hex').toUpperCase();
                        }
                        return escapeSqlValue(val);
                    });
                    sql += `INSERT INTO public."${table.name}" (${colList}) VALUES (${values.join(', ')});\n`;
                }
                sql += `\n`;
            }
        }

        // BƯỚC 5: Thiết lập lại giá trị hiện tại của các Sequence (setval)
        console.log('Thiết lập đồng bộ Sequence setval...');
        sql += `--\n-- Sync Sequence values\n--\n\n`;
        for (const item of tablesWithSeqs) {
            const maxIdRes = await pool.query(`SELECT COALESCE(MAX(id), 1) as max_id FROM public."${item.name}";`);
            const maxId = maxIdRes.rows[0].max_id;
            sql += `SELECT pg_catalog.setval('public.${item.seq}', ${maxId}, true);\n`;
        }
        sql += `\n`;

        // BƯỚC 6: Thêm các ràng buộc Khóa chính, Unique và Index
        console.log('Thêm các ràng buộc khoá chính, duy nhất và chỉ mục không gian...');
        sql += `--\n-- Constraints & Indexes\n--\n\n`;
        
        sql += `ALTER TABLE ONLY public.regions ADD CONSTRAINT regions_pkey PRIMARY KEY (id);\n`;
        sql += `ALTER TABLE ONLY public.provinces ADD CONSTRAINT provinces_pkey PRIMARY KEY (id);\n`;
        sql += `ALTER TABLE ONLY public.versions ADD CONSTRAINT versions_pkey PRIMARY KEY (id);\n`;
        sql += `ALTER TABLE ONLY public.drivers ADD CONSTRAINT drivers_pkey PRIMARY KEY (id);\n`;
        sql += `ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);\n`;
        sql += `ALTER TABLE ONLY public.users ADD CONSTRAINT users_username_key UNIQUE (username);\n`;
        sql += `ALTER TABLE ONLY public.users ADD CONSTRAINT users_driver_id_key UNIQUE (driver_id);\n`;
        sql += `ALTER TABLE ONLY public.basic_units ADD CONSTRAINT basic_units_pkey PRIMARY KEY (id);\n`;
        sql += `ALTER TABLE ONLY public.unit_adjacencies ADD CONSTRAINT unit_adjacencies_pkey PRIMARY KEY (unit_a_id, unit_b_id, version_id);\n`;
        sql += `ALTER TABLE ONLY public.optimization_jobs ADD CONSTRAINT optimization_jobs_pkey PRIMARY KEY (id);\n\n`;

        // Index không gian GiST cho PostGIS
        sql += `CREATE INDEX idx_basic_units_geom ON public.basic_units USING gist (geom);\n`;
        sql += `CREATE INDEX idx_basic_units_centroid ON public.basic_units USING gist (centroid);\n\n`;

        // BƯỚC 7: Thiết lập các Triggers
        console.log('Tạo các Trigger địa lý không gian...');
        sql += `--\n-- Triggers\n--\n\n`;
        sql += `CREATE TRIGGER trg_auto_calculate_bu BEFORE INSERT OR UPDATE OF geom ON public.basic_units FOR EACH ROW EXECUTE FUNCTION public.fn_auto_calculate_bu();\n`;
        sql += `CREATE TRIGGER trg_no_overlap BEFORE INSERT OR UPDATE ON public.basic_units FOR EACH ROW EXECUTE FUNCTION public.check_no_overlap();\n`;
        sql += `CREATE TRIGGER trg_update_bu_metadata BEFORE INSERT OR UPDATE OF geom ON public.basic_units FOR EACH ROW EXECUTE FUNCTION public.fn_update_bu_metadata();\n\n`;

        // BƯỚC 8: Thiết lập các Khóa ngoại (Foreign Keys)
        console.log('Thiết lập các Khóa ngoại liên kết...');
        sql += `--\n-- Foreign Keys\n--\n\n`;
        sql += `ALTER TABLE ONLY public.provinces ADD CONSTRAINT provinces_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL;\n`;
        sql += `ALTER TABLE ONLY public.versions ADD CONSTRAINT versions_province_id_fkey FOREIGN KEY (province_id) REFERENCES public.provinces(id) ON DELETE SET NULL;\n`;
        sql += `ALTER TABLE ONLY public.users ADD CONSTRAINT fk_user_driver FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL;\n`;
        sql += `ALTER TABLE ONLY public.users ADD CONSTRAINT users_province_id_fkey FOREIGN KEY (province_id) REFERENCES public.provinces(id) ON DELETE SET NULL;\n`;
        sql += `ALTER TABLE ONLY public.basic_units ADD CONSTRAINT fk_created_by FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;\n`;
        sql += `ALTER TABLE ONLY public.basic_units ADD CONSTRAINT basic_units_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.versions(id) ON DELETE SET NULL;\n`;
        sql += `ALTER TABLE ONLY public.unit_adjacencies ADD CONSTRAINT unit_adjacencies_unit_a_id_fkey FOREIGN KEY (unit_a_id) REFERENCES public.basic_units(id) ON DELETE CASCADE;\n`;
        sql += `ALTER TABLE ONLY public.unit_adjacencies ADD CONSTRAINT unit_adjacencies_unit_b_id_fkey FOREIGN KEY (unit_b_id) REFERENCES public.basic_units(id) ON DELETE CASCADE;\n`;
        sql += `ALTER TABLE ONLY public.unit_adjacencies ADD CONSTRAINT unit_adjacencies_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.versions(id) ON DELETE CASCADE;\n`;
        sql += `ALTER TABLE ONLY public.optimization_jobs ADD CONSTRAINT optimization_jobs_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.versions(id) ON DELETE CASCADE;\n`;

        // Ghi dữ liệu ra tệp
        fs.writeFileSync(dumpFilePath, sql, 'utf8');
        console.log(`\n=== TẤT CẢ HOÀN TẤT! Đã xuất database ra file: database_dump.sql thành công! ===`);

    } catch (err) {
        console.error('LỖI TRONG QUÁ TRÌNH DUMP:', err.message);
    } finally {
        await pool.end();
    }
}

generateDump();
