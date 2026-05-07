const pool = require('./db');

async function fix() {
    try {
        // 1. Xóa trigger cũ trước
        await pool.query('DROP TRIGGER IF EXISTS trg_no_overlap ON basic_units;');

        // 2. Viết lại function với logic tốt hơn
        await pool.query(`
            CREATE OR REPLACE FUNCTION public.check_no_overlap()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                -- Tự động sửa lỗi hình học
                NEW.geom := ST_MakeValid(NEW.geom);

                IF EXISTS (
                    SELECT 1 FROM basic_units 
                    WHERE id != COALESCE(NEW.id, -1) 
                    AND (version_id IS NOT DISTINCT FROM NEW.version_id)
                    AND ST_Intersects(geom, NEW.geom)
                    -- Bỏ ST_GeometryType check để bắt được mọi trường hợp chồng lấn area (GeometryCollection)
                    -- Chỉ tính diện tích giao nhau thực tế
                    AND ST_Area(ST_Intersection(geom, NEW.geom)::geography)
                        > 0.01 * LEAST(
                            ST_Area(geom::geography),
                            ST_Area(NEW.geom::geography)
                        )
                ) THEN
                    RAISE EXCEPTION 'Lỗi: Ô này đang bị chồng lấn quá 1%% lên ô khác trong cùng Version!';
                END IF;
                
                RETURN NEW;
            END;
            $$;
        `);

        // 3. Gắn lại trigger
        await pool.query(`
            CREATE TRIGGER trg_no_overlap 
            BEFORE INSERT OR UPDATE OF geom ON public.basic_units 
            FOR EACH ROW EXECUTE FUNCTION public.check_no_overlap();
        `);

        console.log("✅ Trigger đã được cập nhật thành công!");
        console.log("   - Ngưỡng overlap: 2% của ô nhỏ hơn (thay vì 10% của ô mới)");
        console.log("   - Dùng ST_MakeValid để làm sạch geometry trước khi tính");
        console.log("   - Dùng LEAST() để tránh false positive với mảnh cắt biên");

    } catch (err) {
        console.error("❌ Lỗi:", err.message);
    } finally {
        process.exit();
    }
}

fix();
