--
-- PostgreSQL database dump
--

\restrict JSudmYKZwvboLJHtX9XdB7YCR0CyzXanVMh4A3FlWGmGeRoWyWbBMoDgYhgr7Ew

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: check_no_overlap(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.check_no_overlap() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM basic_units 
        WHERE ST_Intersects(geom, NEW.geom) 
        AND id != NEW.id 
        AND ST_Area(ST_Intersection(geom, NEW.geom)) > (ST_Area(NEW.geom) * 0.1)
    ) THEN
        RAISE EXCEPTION 'Lỗi: Ô này đang bị chồng lấn quá nhiều lên ô khác!';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.check_no_overlap() OWNER TO postgres;

--
-- Name: fn_auto_calculate_bu(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_auto_calculate_bu() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- 1. Tự động tính Tâm (Centroid)
    NEW.centroid := ST_Centroid(NEW.geom);
    
    -- 2. Tự động tính Diện tích (Chuyển sang hệ mét 3857 rồi chia 1 triệu để ra km2)
    NEW.area_km2 := ST_Area(ST_Transform(NEW.geom, 3857)) / 1000000;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_auto_calculate_bu() OWNER TO postgres;

--
-- Name: fn_update_bu_metadata(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_update_bu_metadata() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.centroid := ST_Centroid(NEW.geom);
    NEW.area_km2 := ST_Area(ST_Transform(NEW.geom, 3857)) / 1000000; -- Tính diện tích ra km2
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_update_bu_metadata() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: basic_units; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.basic_units (
    id integer NOT NULL,
    name character varying(100),
    geom public.geometry(Polygon,4326),
    customer_count integer DEFAULT 0,
    order_count integer DEFAULT 0,
    area_km2 double precision,
    district_id integer,
    centroid public.geometry(Point,4326),
    created_by integer,
    color character varying(20),
    sales_id integer
);


ALTER TABLE public.basic_units OWNER TO postgres;

--
-- Name: basic_units_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.basic_units_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.basic_units_id_seq OWNER TO postgres;

--
-- Name: basic_units_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.basic_units_id_seq OWNED BY public.basic_units.id;


--
-- Name: districts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.districts (
    id integer NOT NULL,
    name character varying(100),
    color character varying(20),
    driver_id integer,
    target_orders integer DEFAULT 100,
    max_load_orders integer DEFAULT 200,
    user_id integer,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.districts OWNER TO postgres;

--
-- Name: districts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.districts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.districts_id_seq OWNER TO postgres;

--
-- Name: districts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.districts_id_seq OWNED BY public.districts.id;


--
-- Name: drivers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.drivers (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    phone character varying(20),
    license_plate character varying(20)
);


ALTER TABLE public.drivers OWNER TO postgres;

--
-- Name: drivers_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.drivers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.drivers_id_seq OWNER TO postgres;

--
-- Name: drivers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.drivers_id_seq OWNED BY public.drivers.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(50) NOT NULL,
    password character varying(255) NOT NULL,
    full_name character varying(100),
    role character varying(20) NOT NULL,
    driver_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'sales'::character varying])::text[])))
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: v_district_report; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_district_report AS
SELECT
    NULL::integer AS district_id,
    NULL::character varying(100) AS district_name,
    NULL::character varying(20) AS color,
    NULL::character varying(100) AS sales_person,
    NULL::character varying(100) AS driver_name,
    NULL::bigint AS total_units,
    NULL::bigint AS total_customers,
    NULL::bigint AS total_orders,
    NULL::integer AS target_orders,
    NULL::numeric AS completion_rate;


ALTER VIEW public.v_district_report OWNER TO postgres;

--
-- Name: basic_units id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.basic_units ALTER COLUMN id SET DEFAULT nextval('public.basic_units_id_seq'::regclass);


--
-- Name: districts id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.districts ALTER COLUMN id SET DEFAULT nextval('public.districts_id_seq'::regclass);


--
-- Name: drivers id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.drivers ALTER COLUMN id SET DEFAULT nextval('public.drivers_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Data for Name: basic_units; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.basic_units (id, name, geom, customer_count, order_count, area_km2, district_id, centroid, created_by, color, sales_id) FROM stdin;
10	Võ Chí Công	0103000020E6100000010000000600000072A774B0FE725A409563B2B8FF1035404969368FC3735A40F10EF0A4850F35402F3196E997745A40A27BD6355A163540328FFCC1C0735A409161156F6416354071C6302768735A40CEC474215613354072A774B0FE725A409563B2B8FF103540	40	30	4.2923185438928435	\N	0101000020E6100000B2EC98A8CC735A403B717A2539133540	\N	#123445	3
2	Khu vực Mở rộng	0103000020E61000000100000006000000FB21365838735A409A3E3BE0BA0A35407F1475E61E755A40BFB51325210935401B12F758FA745A4090D959F44E0D354045B8C9A832745A40D0807A336A0E354038DC476E4D735A40933655F7C80E3540FB21365838735A409A3E3BE0BA0A3540	20	50	6.21250519621036	4	0101000020E6100000A4BEAC4227745A40C1CC4F820C0C3540	\N	#38a423	3
1	Khu vực Hoàn Kiếm	0103000020E610000001000000050000001B12F758FA745A4090D959F44E0D3540193BE12538765A40AB984A3FE10C3540D9226937FA755A4006B8205B960F3540B9FE5D9F39755A4005F86EF3C61135401B12F758FA745A4090D959F44E0D3540	15	30	2.901742949001684	3	0101000020E6100000EB86EC528B755A40119BD7A5D00E3540	\N	\N	\N
9	1	0103000020E610000001000000070000008CDB68006F765A40DFDDCA129D153540D9226937FA755A4006B8205B960F3540B9FE5D9F39755A4005F86EF3C61135406092CA1473755A402A1F82AAD113354026FF93BF7B755A404FB0FF3A3715354022C7D63384755A4091D5AD9E931635408CDB68006F765A40DFDDCA129D153540	1	1	3.944568447730304	3	0101000020E61000004F6FCF21D4755A400F26FE6F5C133540	\N	#46188c	\N
4	Khu vực Bách Khoa	0103000020E610000001000000050000007F1475E61E755A40BFB5132521093540662FDB4E5B765A407A522635B4093540193BE12538765A40AB984A3FE10C35401B12F758FA745A4090D959F44E0D35407F1475E61E755A40BFB5132521093540	25	45	3.6998078182112857	4	0101000020E6100000C286AB0FA4755A408D8BFEE43E0B3540	\N	#6a294c	\N
\.


--
-- Data for Name: districts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.districts (id, name, color, driver_id, target_orders, max_load_orders, user_id, updated_at) FROM stdin;
3	Hoàn Kiếm	#ff0000	\N	100	200	\N	2026-03-20 17:07:06.259537
1	Vùng Hoàn Kiếm 1	#FF5733	1	100	200	2	2026-03-20 17:07:06.259537
2	Vùng Hoàn Kiếm 2	#33FF57	2	100	200	3	2026-03-20 17:07:06.259537
4	Vùng Hai Bà Trưng	#3498db	2	70	160	3	2026-03-20 19:33:02.445389
\.


--
-- Data for Name: drivers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.drivers (id, name, phone, license_plate) FROM stdin;
1	Nguyễn Văn Tài	0912345678	29A-123.45
2	Trần Văn Xế	0988888888	30E-999.99
\.


--
-- Data for Name: spatial_ref_sys; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, username, password, full_name, role, driver_id, created_at) FROM stdin;
4	dabu	123456	Phạm Đức Anh	admin	\N	2026-03-19 01:30:42.292123
3	sales_xe	123456	Trần Văn Xế	sales	2	2026-03-19 01:29:12.988457
2	sales_tai	123456	Nguyễn Văn Tài	sales	1	2026-03-19 01:29:12.988457
1	admin_thanh	123456	Quản trị viên Hệ thống	admin	\N	2026-03-19 01:29:12.988457
\.


--
-- Name: basic_units_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.basic_units_id_seq', 15, true);


--
-- Name: districts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.districts_id_seq', 4, true);


--
-- Name: drivers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.drivers_id_seq', 2, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 4, true);


--
-- Name: basic_units basic_units_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.basic_units
    ADD CONSTRAINT basic_units_pkey PRIMARY KEY (id);


--
-- Name: districts districts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.districts
    ADD CONSTRAINT districts_pkey PRIMARY KEY (id);


--
-- Name: drivers drivers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_pkey PRIMARY KEY (id);


--
-- Name: users users_driver_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_driver_id_key UNIQUE (driver_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_basic_units_centroid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_basic_units_centroid ON public.basic_units USING gist (centroid);


--
-- Name: idx_basic_units_geom; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_basic_units_geom ON public.basic_units USING gist (geom);


--
-- Name: v_district_report _RETURN; Type: RULE; Schema: public; Owner: postgres
--

CREATE OR REPLACE VIEW public.v_district_report AS
 SELECT d.id AS district_id,
    d.name AS district_name,
    d.color,
    u.full_name AS sales_person,
    dr.name AS driver_name,
    count(bu.id) AS total_units,
    sum(bu.customer_count) AS total_customers,
    sum(bu.order_count) AS total_orders,
    d.target_orders,
    round((((sum(bu.order_count))::numeric / (d.target_orders)::numeric) * (100)::numeric), 2) AS completion_rate
   FROM (((public.districts d
     LEFT JOIN public.basic_units bu ON ((d.id = bu.district_id)))
     LEFT JOIN public.users u ON ((d.user_id = u.id)))
     LEFT JOIN public.drivers dr ON ((d.driver_id = dr.id)))
  GROUP BY d.id, u.full_name, dr.name;


--
-- Name: basic_units trg_auto_calculate_bu; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_auto_calculate_bu BEFORE INSERT OR UPDATE OF geom ON public.basic_units FOR EACH ROW EXECUTE FUNCTION public.fn_auto_calculate_bu();


--
-- Name: basic_units trg_no_overlap; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_no_overlap BEFORE INSERT OR UPDATE ON public.basic_units FOR EACH ROW EXECUTE FUNCTION public.check_no_overlap();


--
-- Name: basic_units trg_update_bu_metadata; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_update_bu_metadata BEFORE INSERT OR UPDATE OF geom ON public.basic_units FOR EACH ROW EXECUTE FUNCTION public.fn_update_bu_metadata();


--
-- Name: basic_units fk_created_by; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.basic_units
    ADD CONSTRAINT fk_created_by FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: basic_units fk_district; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.basic_units
    ADD CONSTRAINT fk_district FOREIGN KEY (district_id) REFERENCES public.districts(id) ON DELETE SET NULL;


--
-- Name: districts fk_district_user; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.districts
    ADD CONSTRAINT fk_district_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: districts fk_driver; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.districts
    ADD CONSTRAINT fk_driver FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL;


--
-- Name: users fk_user_driver; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_user_driver FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict JSudmYKZwvboLJHtX9XdB7YCR0CyzXanVMh4A3FlWGmGeRoWyWbBMoDgYhgr7Ew


--update 8/4
CREATE OR REPLACE FUNCTION public.check_no_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- 1. Tự động sửa lỗi hình học (nếu vẽ tay bị chéo nét)
    NEW.geom := ST_MakeValid(NEW.geom);

    IF EXISTS (
        SELECT 1 FROM basic_units 
        WHERE id != COALESCE(NEW.id, -1) -- Tránh lỗi so sánh null khi Insert mới
        AND ST_Intersects(geom, NEW.geom) 
        -- 2. CHỈ BẮT LỖI NẾU PHẦN ĐÈ NHAU LÀ MỘT MẶT PHẲNG (POLYGON)
        AND ST_GeometryType(ST_Intersection(geom, NEW.geom)) IN ('ST_Polygon', 'ST_MultiPolygon')
        -- 3. Ngưỡng đè 10% của ông giữ nguyên
        AND ST_Area(ST_Intersection(geom, NEW.geom)) > (ST_Area(NEW.geom) * 0.1)
    ) THEN
        RAISE EXCEPTION 'Lỗi: Ô này đang bị chồng lấn quá 10%% lên ô khác!';
    END IF;
    
    RETURN NEW;
END;
$$;