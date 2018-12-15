--
-- PostgreSQL database dump
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;

--
-- Name: sidewalk; Type: SCHEMA; Schema: -; Owner: sidewalk
--

CREATE SCHEMA sidewalk;


ALTER SCHEMA sidewalk OWNER TO sidewalk;

--
-- Name: plpgsql; Type: EXTENSION; Schema: -; Owner:
--

CREATE EXTENSION IF NOT EXISTS plpgsql WITH SCHEMA pg_catalog;


--
-- Name: EXTENSION plpgsql; Type: COMMENT; Schema: -; Owner:
--

COMMENT ON EXTENSION plpgsql IS 'PL/pgSQL procedural language';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner:
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner:
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry, geography, and raster spatial types and functions';


--
-- Name: pgrouting; Type: EXTENSION; Schema: -; Owner:
--

CREATE EXTENSION IF NOT EXISTS pgrouting WITH SCHEMA public;


--
-- Name: EXTENSION pgrouting; Type: COMMENT; Schema: -; Owner:
--

COMMENT ON EXTENSION pgrouting IS 'pgRouting Extension';


SET default_tablespace = '';

SET default_with_oids = false;

--
-- Name: accessibility_feature; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.accessibility_feature (
    geom public.geometry(Point,4326),
    accessibility_feature_id integer NOT NULL,
    label_type_id integer,
    x double precision,
    y double precision
);


ALTER TABLE sidewalk.accessibility_feature OWNER TO sidewalk;

--
-- Name: amt_assignment; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.amt_assignment (
    amt_assignment_id integer NOT NULL,
    assignment_id text NOT NULL,
    assignment_start timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    assignment_end timestamp with time zone DEFAULT timezone('utc'::text, now()),
    hit_id text NOT NULL,
    turker_id text NOT NULL,
    confirmation_code text,
    completed boolean DEFAULT false NOT NULL
);


ALTER TABLE sidewalk.amt_assignment OWNER TO sidewalk;

--
-- Name: amt_assignment_amt_assignment_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.amt_assignment_amt_assignment_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.amt_assignment_amt_assignment_id_seq OWNER TO sidewalk;

--
-- Name: amt_assignment_amt_assignment_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.amt_assignment_amt_assignment_id_seq OWNED BY sidewalk.amt_assignment.amt_assignment_id;


--
-- Name: audit_task; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.audit_task (
    audit_task_id integer NOT NULL,
    amt_assignment_id integer,
    user_id text NOT NULL,
    street_edge_id integer NOT NULL,
    task_start timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    task_end timestamp with time zone DEFAULT timezone('utc'::text, now()),
    completed boolean DEFAULT false NOT NULL
);


ALTER TABLE sidewalk.audit_task OWNER TO sidewalk;

--
-- Name: audit_task_audit_task_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.audit_task_audit_task_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.audit_task_audit_task_id_seq OWNER TO sidewalk;

--
-- Name: audit_task_audit_task_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.audit_task_audit_task_id_seq OWNED BY sidewalk.audit_task.audit_task_id;


--
-- Name: audit_task_comment; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.audit_task_comment (
    audit_task_comment_id integer NOT NULL,
    edge_id integer NOT NULL,
    user_id text NOT NULL,
    ip_address text NOT NULL,
    gsv_panorama_id text,
    heading double precision,
    pitch double precision,
    zoom integer,
    "timestamp" timestamp with time zone NOT NULL,
    comment text NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL
);


ALTER TABLE sidewalk.audit_task_comment OWNER TO sidewalk;

--
-- Name: audit_task_comment_audit_task_comment_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.audit_task_comment_audit_task_comment_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.audit_task_comment_audit_task_comment_id_seq OWNER TO sidewalk;

--
-- Name: audit_task_comment_audit_task_comment_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.audit_task_comment_audit_task_comment_id_seq OWNED BY sidewalk.audit_task_comment.audit_task_comment_id;


--
-- Name: audit_task_environment; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.audit_task_environment (
    audit_task_environment_id integer NOT NULL,
    audit_task_id integer NOT NULL,
    browser text,
    browser_version text,
    browser_width integer,
    browser_height integer,
    avail_width integer,
    avail_height integer,
    screen_width integer,
    screen_height integer,
    operating_system text,
    ip_address text
);


ALTER TABLE sidewalk.audit_task_environment OWNER TO sidewalk;

--
-- Name: audit_task_environment_audit_task_environment_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.audit_task_environment_audit_task_environment_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.audit_task_environment_audit_task_environment_id_seq OWNER TO sidewalk;

--
-- Name: audit_task_environment_audit_task_environment_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.audit_task_environment_audit_task_environment_id_seq OWNED BY sidewalk.audit_task_environment.audit_task_environment_id;


--
-- Name: audit_task_incomplete_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.audit_task_incomplete_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.audit_task_incomplete_id_seq OWNER TO sidewalk;

--
-- Name: audit_task_incomplete; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.audit_task_incomplete (
    audit_task_incomplete_id integer DEFAULT nextval('sidewalk.audit_task_incomplete_id_seq'::regclass) NOT NULL,
    issue_description character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    audit_task_id integer NOT NULL
);


ALTER TABLE sidewalk.audit_task_incomplete OWNER TO sidewalk;

--
-- Name: audit_task_interaction; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.audit_task_interaction (
    audit_task_interaction_id bigint NOT NULL,
    audit_task_id integer NOT NULL,
    action text NOT NULL,
    gsv_panorama_id character varying(64),
    lat double precision,
    lng double precision,
    heading double precision,
    pitch double precision,
    zoom integer,
    note text,
    "timestamp" timestamp with time zone NOT NULL,
    temporary_label_id integer
);


ALTER TABLE sidewalk.audit_task_interaction OWNER TO sidewalk;

--
-- Name: audit_task_interaction_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.audit_task_interaction_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.audit_task_interaction_id_seq OWNER TO sidewalk;

--
-- Name: audit_task_interaction_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.audit_task_interaction_id_seq OWNED BY sidewalk.audit_task_interaction.audit_task_interaction_id;


--
-- Name: gsv_data; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.gsv_data (
    gsv_panorama_id character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    image_width integer NOT NULL,
    image_height integer NOT NULL,
    tile_width integer NOT NULL,
    tile_height integer NOT NULL,
    image_date character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    imagery_type integer NOT NULL,
    copyright character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL
);


ALTER TABLE sidewalk.gsv_data OWNER TO sidewalk;

--
-- Name: gsv_link; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.gsv_link (
    gsv_panorama_id character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    yaw_deg double precision NOT NULL,
    target_panorama_id character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    road_argb character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    description character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL
);


ALTER TABLE sidewalk.gsv_link OWNER TO sidewalk;

--
-- Name: gsv_link_gsv_link_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.gsv_link_gsv_link_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.gsv_link_gsv_link_id_seq OWNER TO sidewalk;

--
-- Name: gsv_location; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.gsv_location (
    gsv_panorama_id character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    zoom_levels integer NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    original_lat double precision NOT NULL,
    original_lng double precision NOT NULL,
    elevation_wgs84_m double precision NOT NULL,
    description character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    street_range integer,
    region character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    country character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    elevation_egm96_m double precision NOT NULL
);


ALTER TABLE sidewalk.gsv_location OWNER TO sidewalk;

--
-- Name: gsv_model; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.gsv_model (
    gsv_panorama_id character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    depth_map text COLLATE pg_catalog."POSIX" NOT NULL,
    pano_map text COLLATE pg_catalog."POSIX" NOT NULL
);


ALTER TABLE sidewalk.gsv_model OWNER TO sidewalk;

--
-- Name: gsv_onboarding_pano; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.gsv_onboarding_pano (
    gsv_panorama_id text NOT NULL,
    has_labels boolean NOT NULL
);


ALTER TABLE sidewalk.gsv_onboarding_pano OWNER TO sidewalk;

--
-- Name: gsv_projection; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.gsv_projection (
    gsv_panorama_id character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    projection_type character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    pano_yaw_deg double precision NOT NULL,
    tilt_yaw_deg double precision NOT NULL,
    tilt_pitch_deg double precision NOT NULL
);


ALTER TABLE sidewalk.gsv_projection OWNER TO sidewalk;

--
-- Name: label; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.label (
    label_id integer NOT NULL,
    audit_task_id integer NOT NULL,
    gsv_panorama_id character varying(64) NOT NULL,
    label_type_id integer NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    photographer_heading double precision NOT NULL,
    photographer_pitch double precision NOT NULL,
    panorama_lat double precision,
    panorama_lng double precision,
    temporary_label_id integer,
    time_created timestamp without time zone
);


ALTER TABLE sidewalk.label OWNER TO sidewalk;

--
-- Name: label_label_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.label_label_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.label_label_id_seq OWNER TO sidewalk;

--
-- Name: label_label_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.label_label_id_seq OWNED BY sidewalk.label.label_id;


--
-- Name: label_point; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.label_point (
    label_point_id integer NOT NULL,
    label_id integer NOT NULL,
    sv_image_x integer NOT NULL,
    sv_image_y integer NOT NULL,
    canvas_x integer NOT NULL,
    canvas_y integer NOT NULL,
    heading double precision NOT NULL,
    pitch double precision NOT NULL,
    zoom integer NOT NULL,
    canvas_height integer NOT NULL,
    canvas_width integer NOT NULL,
    alpha_x double precision NOT NULL,
    alpha_y double precision NOT NULL,
    lat double precision,
    lng double precision,
    geom public.geometry
);


ALTER TABLE sidewalk.label_point OWNER TO sidewalk;

--
-- Name: label_point_label_point_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.label_point_label_point_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.label_point_label_point_id_seq OWNER TO sidewalk;

--
-- Name: label_point_label_point_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.label_point_label_point_id_seq OWNED BY sidewalk.label_point.label_point_id;


--
-- Name: label_type; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.label_type (
    label_type_id integer NOT NULL,
    label_type text NOT NULL,
    description text
);


ALTER TABLE sidewalk.label_type OWNER TO sidewalk;

--
-- Name: label_type_label_type_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.label_type_label_type_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.label_type_label_type_id_seq OWNER TO sidewalk;

--
-- Name: label_type_label_type_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.label_type_label_type_id_seq OWNED BY sidewalk.label_type.label_type_id;

INSERT INTO sidewalk.label_type (label_type_id, label_type, description) VALUES
( 1, 'CurbRamp', 'Curb Ramp' ),
( 2, 'NoCurbRamp', 'Missing Curb Ramp' ),
( 3, 'Obstacle', 'Obstacle in a Path' ),
( 4, 'SurfaceProblem', 'Surface Problem' ),
( 5, 'Other', ''),
( 6, 'Occlusion', 'Cant see the sidewalk' ),
( 7, 'NoSidewalk', 'No Sidewalk' )
;

--
-- Name: login_info; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.login_info (
    login_info_id bigint NOT NULL,
    provider_id character varying(254),
    provider_key character varying(254)
);


ALTER TABLE sidewalk.login_info OWNER TO sidewalk;

--
-- Name: logininfo_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.logininfo_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.logininfo_id_seq OWNER TO sidewalk;

--
-- Name: logininfo_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.logininfo_id_seq OWNED BY sidewalk.login_info.login_info_id;


--
-- Name: mission; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.mission (
    mission_id integer NOT NULL,
    region_id integer,
    label text NOT NULL,
    level integer NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    coverage double precision,
    distance double precision,
    distance_ft double precision,
    distance_mi double precision
);


ALTER TABLE sidewalk.mission OWNER TO sidewalk;

--
-- Name: mission_mission_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.mission_mission_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.mission_mission_id_seq OWNER TO sidewalk;

--
-- Name: mission_mission_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.mission_mission_id_seq OWNED BY sidewalk.mission.mission_id;


--
-- Name: mission_user; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.mission_user (
    mission_user_id integer NOT NULL,
    mission_id integer NOT NULL,
    user_id text NOT NULL,
    paid boolean DEFAULT false NOT NULL
);


ALTER TABLE sidewalk.mission_user OWNER TO sidewalk;

--
-- Name: mission_user_mission_user_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.mission_user_mission_user_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.mission_user_mission_user_id_seq OWNER TO sidewalk;

--
-- Name: mission_user_mission_user_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.mission_user_mission_user_id_seq OWNED BY sidewalk.mission_user.mission_user_id;


--
-- Name: play_evolutions; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.play_evolutions (
    id integer NOT NULL,
    hash character varying(255) NOT NULL,
    applied_at timestamp without time zone NOT NULL,
    apply_script text,
    revert_script text,
    state character varying(255),
    last_problem text
);


ALTER TABLE sidewalk.play_evolutions OWNER TO sidewalk;

--
-- Name: problem_description; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.problem_description (
    problem_description_id integer NOT NULL,
    label_id integer NOT NULL,
    description text NOT NULL
);


ALTER TABLE sidewalk.problem_description OWNER TO sidewalk;

--
-- Name: problem_description_problem_description_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.problem_description_problem_description_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.problem_description_problem_description_id_seq OWNER TO sidewalk;

--
-- Name: problem_description_problem_description_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.problem_description_problem_description_id_seq OWNED BY sidewalk.problem_description.problem_description_id;


--
-- Name: problem_severity; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.problem_severity (
    problem_severity_id integer NOT NULL,
    label_id integer NOT NULL,
    severity integer NOT NULL
);


ALTER TABLE sidewalk.problem_severity OWNER TO sidewalk;

--
-- Name: problem_severity_problem_severity_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.problem_severity_problem_severity_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.problem_severity_problem_severity_id_seq OWNER TO sidewalk;

--
-- Name: problem_severity_problem_severity_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.problem_severity_problem_severity_id_seq OWNED BY sidewalk.problem_severity.problem_severity_id;


--
-- Name: problem_temporariness; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.problem_temporariness (
    problem_temporariness_id integer NOT NULL,
    label_id integer NOT NULL,
    temporary_problem boolean NOT NULL
);


ALTER TABLE sidewalk.problem_temporariness OWNER TO sidewalk;

--
-- Name: problem_temporariness_problem_temporariness_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.problem_temporariness_problem_temporariness_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.problem_temporariness_problem_temporariness_id_seq OWNER TO sidewalk;

--
-- Name: problem_temporariness_problem_temporariness_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.problem_temporariness_problem_temporariness_id_seq OWNED BY sidewalk.problem_temporariness.problem_temporariness_id;


--
-- Name: region_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.region_id_seq
    START WITH 1
    INCREMENT BY 1
    MINVALUE 0
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.region_id_seq OWNER TO sidewalk;

--
-- Name: region; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.region (
    region_id integer DEFAULT nextval('sidewalk.region_id_seq'::regclass) NOT NULL,
    region_type_id integer NOT NULL,
    data_source character varying(2044) COLLATE pg_catalog."POSIX",
    description character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    geom public.geometry(Geometry,4326),
    deleted boolean DEFAULT false NOT NULL
);


ALTER TABLE sidewalk.region OWNER TO sidewalk;

--
-- Name: region_completion; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.region_completion (
    region_id integer NOT NULL,
    total_distance real,
    audited_distance real
);


ALTER TABLE sidewalk.region_completion OWNER TO sidewalk;

--
-- Name: region_property; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.region_property (
    region_property_id integer NOT NULL,
    region_id integer NOT NULL,
    key text NOT NULL,
    value text NOT NULL
);


ALTER TABLE sidewalk.region_property OWNER TO sidewalk;

--
-- Name: region_property_region_property_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.region_property_region_property_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.region_property_region_property_id_seq OWNER TO sidewalk;

--
-- Name: region_property_region_property_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.region_property_region_property_id_seq OWNED BY sidewalk.region_property.region_property_id;


--
-- Name: region_type; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.region_type (
    region_type_id integer NOT NULL,
    region_type character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL
);


ALTER TABLE sidewalk.region_type OWNER TO sidewalk;

--
-- Name: role; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.role (
    role_id integer NOT NULL,
    role text NOT NULL
);


ALTER TABLE sidewalk.role OWNER TO sidewalk;

--
-- Name: role_role_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.role_role_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.role_role_id_seq OWNER TO sidewalk;

--
-- Name: role_role_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.role_role_id_seq OWNED BY sidewalk.role.role_id;


--
-- Name: sidewalk_edge; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.sidewalk_edge (
    geom public.geometry(LineString,4326),
    y1 double precision,
    x2 double precision,
    x1 double precision,
    sidewalk_edge_id integer NOT NULL,
    y2 double precision,
    way_type character varying,
    source integer,
    target integer,
    deleted boolean DEFAULT false,
    "timestamp" timestamp with time zone DEFAULT timezone('utc'::text, now())
);


ALTER TABLE sidewalk.sidewalk_edge OWNER TO sidewalk;

--
-- Name: sidewalk_edge_accessibility_feature; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.sidewalk_edge_accessibility_feature (
    sidewalk_edge_accessibility_feature_id integer NOT NULL,
    sidewalk_edge_id integer,
    accessibility_feature_id integer
);


ALTER TABLE sidewalk.sidewalk_edge_accessibility_feature OWNER TO sidewalk;

--
-- Name: sidewalk_edge_accessibility_f_sidewalk_edge_accessibility_f_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.sidewalk_edge_accessibility_f_sidewalk_edge_accessibility_f_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.sidewalk_edge_accessibility_f_sidewalk_edge_accessibility_f_seq OWNER TO sidewalk;

--
-- Name: sidewalk_edge_accessibility_f_sidewalk_edge_accessibility_f_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.sidewalk_edge_accessibility_f_sidewalk_edge_accessibility_f_seq OWNED BY sidewalk.sidewalk_edge_accessibility_feature.sidewalk_edge_accessibility_feature_id;


--
-- Name: sidewalk_edge_parent_edge; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.sidewalk_edge_parent_edge (
    sidewalk_edge_id bigint NOT NULL,
    parent_edge_id bigint
);


ALTER TABLE sidewalk.sidewalk_edge_parent_edge OWNER TO sidewalk;

--
-- Name: sidewalk_edge_sidewalk_node; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.sidewalk_edge_sidewalk_node (
    sidewalk_edge_id bigint NOT NULL,
    sidewalk_node_id bigint
);


ALTER TABLE sidewalk.sidewalk_edge_sidewalk_node OWNER TO sidewalk;

--
-- Name: sidewalk_edge_sidewalk_node_sidewalk_edge_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.sidewalk_edge_sidewalk_node_sidewalk_edge_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.sidewalk_edge_sidewalk_node_sidewalk_edge_id_seq OWNER TO sidewalk;

--
-- Name: sidewalk_edge_sidewalk_node_sidewalk_edge_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.sidewalk_edge_sidewalk_node_sidewalk_edge_id_seq OWNED BY sidewalk.sidewalk_edge_sidewalk_node.sidewalk_edge_id;


--
-- Name: sidewalk_edges_sidewalk_edge_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.sidewalk_edges_sidewalk_edge_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.sidewalk_edges_sidewalk_edge_id_seq OWNER TO sidewalk;

--
-- Name: sidewalk_edges_sidewalk_edge_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.sidewalk_edges_sidewalk_edge_id_seq OWNED BY sidewalk.sidewalk_edge.sidewalk_edge_id;


--
-- Name: sidewalk_node; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.sidewalk_node (
    id_0 integer NOT NULL,
    geom public.geometry(Point,4326),
    lat double precision,
    way_ids character varying,
    lng double precision,
    sidewalk_node_id character varying
);


ALTER TABLE sidewalk.sidewalk_node OWNER TO sidewalk;

--
-- Name: sidewalk_nodes_id_0_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.sidewalk_nodes_id_0_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.sidewalk_nodes_id_0_seq OWNER TO sidewalk;

--
-- Name: sidewalk_nodes_id_0_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.sidewalk_nodes_id_0_seq OWNED BY sidewalk.sidewalk_node.id_0;


--
-- Name: street_edge; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.street_edge (
    street_edge_id integer NOT NULL,
    geom public.geometry(LineString,4326) NOT NULL,
    x1 double precision NOT NULL,
    y1 double precision NOT NULL,
    x2 double precision NOT NULL,
    y2 double precision NOT NULL,
    way_type character varying,
    source integer,
    target integer,
    deleted boolean NOT NULL,
    "timestamp" timestamp with time zone DEFAULT timezone('utc'::text, now())
);


ALTER TABLE sidewalk.street_edge OWNER TO sidewalk;

INSERT INTO sidewalk.street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, source, target, deleted, "timestamp") VALUES
(27047,'0102000020E6100000040000005A290472894353C0BB75A33440724340AF5E4546874353C0AF48A70936724340FEF38F19834353C07AD67FE7287243404209336D7F4353C0B09E49511D724340','-77.0546525000000031','38.8915197000000035','-77.0546525000000031','38.8915197000000035','trunk','1666462','1666465','f','2015-12-04 12:34:17.852+00'),
(27048,'0102000020E61000000500000023FA10AF464353C02050EC57F07543400BB5A679474353C0823CBB7CEB754340F36F3C44484353C0A20BEA5BE675434028695952494353C039AF5692E175434021167B794B4353C0314DC752DA754340','-77.0514816000000025','38.9207251999999997','-77.0514816000000025','38.9207251999999997','trunk','1666466','1666470','f','2015-12-04 12:34:17.852+00'),
(27049,'0102000020E61000000400000021167B794B4353C0314DC752DA7543400EE7D0D84D4353C03A22DFA5D4754340FA9D81EC504353C078AE940ACF754340CF9C9A70544353C0997DC3E9C9754340','-77.0520288000000022','38.9202244000000022','-77.0520288000000022','38.9202244000000022','trunk','1666471','1666474','f','2015-12-04 12:34:17.852+00'),
(27089,'0102000020E61000000300000058F32DBD474353C0DF77C201E3754340171E45E7464353C0C91CCBBBEA75434023FA10AF464353C02050EC57F0754340','-77.051189199999996','38.9213972000000012','-77.051189199999996','38.9213972000000012','trunk','1667450','1667452','f','2015-12-04 12:34:17.852+00'),
(27053,'0102000020E61000002500000034208CE9534353C0CD785BE9B5744340D9695A18584353C0A45016BEBE7443404501ECED604353C0687D25EBCB74434061DD7877644353C04852D2C3D0744340062AE3DF674353C0D542C9E4D4744340C3B57F0A6C4353C0506CAA93D87443405C9CE73E6F4353C0A21C16B4DA744340BFC81528734353C0BFE7D19EDC74434005DF347D764353C01D46F762DE74434080643A747A4353C0E0D91EBDE17443404162BB7B804353C0293FA9F6E9744340010FB166894353C0AA1496D3F9744340109370218F4353C0E7559DD502754340840AB375954353C018C110830A754340637A67599C4353C09ECEBAEB1175434064A021D2A54353C0BC2429441B75434013D4F02DAC4353C0BF81C98D22754340C3802557B14353C02043C70E2A7543403E20D099B44353C0ACFF73982F754340310A82C7B74353C0A9FB00A436754340ADDD76A1B94353C08255F5F23B754340D656EC2FBB4353C0A818E76F4275434076340EF5BB4353C059DFC0E446754340CF4BC5C6BC4353C0F59ECA694F754340286618D2BC4353C0D46D3FCF557543402997C62FBC4353C0C4CF7F0F5E75434017467A51BB4353C00F9D9E7763754340605AD427B94353C064B0E2546B7543402B4D4A41B74353C01477BCC96F754340C8091346B34353C0935165187775434017F549EEB04353C02CF015DD7A754340FB5DD89AAD4353C0CB4BFE277F7543400E4B033FAA4353C0B187F6B182754340F299EC9FA74353C0DAE6C6F484754340BEDA519CA34353C0FC54151A887543409770E82D9E4353C047286CF58B7543403BAB05F6984353C06F8104C58F754340','-77.0562110000000047','38.91845','-77.0562110000000047','38.91845','trunk','1666549','1666585','f','2015-12-04 12:34:17.852+00'),
(27054,'0102000020E6100000240000003BAB05F6984353C06F8104C58F75434043DF8211A04353C0A03F23C78C754340B8E9CF7EA44353C072512D228A754340EBA86A82A84353C050E3DEFC86754340085A8121AB4353C027840EBA84754340BEC92544AF4353C0FA3F2C408075434003081F4AB44353C0EC34D252797543401E51A1BAB94353C09D465A2A6F754340E7BE4120BC4353C04861287167754340DB24F554BD4353C0A4D8767F617543409F93DE37BE4353C0F5BBB0355B75434033DDEBA4BE4353C089B48D3F51754340F8C43A55BE4353C00F971C774A7543405EBEF561BD4353C0D2AB014A43754340E1D05B3CBC4353C07573F1B73D75434071AB2006BA4353C0865968E73475434097033DD4B64353C0E9995E622C754340A4FFE55AB44353C0E0BBCD1B27754340CA8B4CC0AF4353C08BA8893E1F754340F0315871AA4353C047CCECF31875434088653387A44353C0499C1551137543404489963C9E4353C0A6B73F170D754340A661F888984353C0F16778B30675434009FB7612914353C0D35FF93DFB7443401215AA9B8B4353C09ED32CD0EE74434055E2957F884353C001E0D8B3E77443407521567F844353C0992D5915E17443407D941117804353C0E3A9471ADC74434056B4DE147B4353C0DF9C5B32D874434053F245D6754353C0341DF0AFD47443405C7171546E4353C049861C5BCF744340312592E8654353C081CB63CDC874434099D4D006604353C00D37E0F3C3744340E202D0285D4353C0508E0244C1744340029EB470594353C09FC728CFBC74434034208CE9534353C0CD785BE9B5744340','-77.0519965999999954','38.9118015000000028','-77.0519965999999954','38.9118015000000028','trunk','1666586','1666621','f','2015-12-04 12:34:17.852+00'),
(27055,'0102000020E61000000E0000002A368BBC514353C0ABF35E6BA5714340C3AC61D0534353C00F7F4DD6A8714340092241A7564353C04DFAD6E2AE7143400EF049CC584353C0C1A2C794B4714340544E20915B4353C0DB69108BBD714340711C78B55C4353C043F4B578C271434018E87F5E5D4353C03A1F9E25C8714340411F76F05D4353C0606CC60ECF714340F4531C075E4353C0220E23CED4714340A61595C35D4353C07841446ADA7143405964E0255D4353C0F997EEBFDF71434030BABC395C4353C097AB1F9BE4714340F6D8F1BA594353C0D4A46F2DEE7143402E2C6E92554353C001C4B876FD714340','-77.0520979000000068','38.8905475999999979','-77.0520979000000068','38.8905475999999979','trunk','1666622','1666635','f','2015-12-04 12:34:17.852+00'),
(27056,'0102000020E6100000040000004209336D7F4353C0B09E49511D7243404DF6CFD3804353C07C444C8924724340B25F1C01814353C062F0D53329724340E27327D87F4353C02E90A0F831724340','-77.0546779999999956','38.8921500000000009','-77.0546779999999956','38.8921500000000009','trunk','1666636','1666639','f','2015-12-04 12:34:17.852+00'),
(27057,'0102000020E610000006000000876FBC966B4353C0F4AE30332272434068C06A766E4353C07CB4DDA925724340D7C86427724353C0D9AA6E3F2A724340D571A197764353C0957B26A02E724340AE6CD5647C4353C0281B20E230724340E27327D87F4353C02E90A0F831724340','-77.0546779999999956','38.8921500000000009','-77.0546779999999956','38.8921500000000009','trunk','1666640','1666645','f','2015-12-04 12:34:17.852+00'),
(27058,'0102000020E610000004000000CF9C9A70544353C0997DC3E9C975434084B5D6BC4F4353C0E31CD02DCF75434097FE25A94C4353C0A0BF756AD37543405DEF48064A4353C0DFF87F7AD8754340','-77.0513930999999985','38.9206689000000026','-77.0513930999999985','38.9206689000000026','trunk','1666646','1666649','f','2015-12-04 12:34:17.852+00'),
(27061,'0102000020E610000009000000FCB1A437374353C04A8B44B291714340BEE36FD63B4353C038BEF6CC92714340F8657AD33E4353C0738EF0AC93714340E41C2BE7414353C025EB707495714340AD591DEF444353C0776DCA7097714340F32A210E484353C04C2A64F8997143404B53A97E4A4353C08CF9145B9C714340B52B3E4F4D4353C00D56F723A07143402A368BBC514353C0ABF35E6BA5714340','-77.0518638000000067','38.8878606999999974','-77.0518638000000067','38.8878606999999974','trunk','1666671','1666679','f','2015-12-04 12:34:17.852+00'),
(27062,'0102000020E61000000A00000064A593B6824053C0553607639F7843404268F3EE7E4053C0EED7F8A7AF7843404FEED2E17C4053C0EE70E07AB9784340D3D226987B4053C0B09C73A6BF78434068531AD6794053C0EC95C338C9784340CED60B4F794053C0483E65EBCF78434069E0EC7B794053C0C1B1C288D87843409E21C1F9794053C0EF1010DDFD7843408C6E18607A4053C0D1CFD4EB16794340CDE7DCED7A4053C030B374AA21794340','-77.0075029999999998','38.9463398999999981','-77.0075029999999998','38.9463398999999981','trunk','1666680','1653297','f','2015-12-04 12:34:17.852+00'),
(27063,'0102000020E610000004000000E27327D87F4353C02E90A0F831724340F273E899834353C0EBAE473C34724340143E5B07874353C089C27817397243405A290472894353C0BB75A33440724340','-77.055263999999994','38.8925843999999969','-77.055263999999994','38.8925843999999969','trunk','1666689','1666692','f','2015-12-04 12:34:17.852+00'),
(27064,'0102000020E61000004400000002CCC694D93F53C0AC17E87F5E6E434087A81D59D43F53C07E2F2A4E5A6E4340F0405365CE3F53C06342CC25556E434077B3507CC63F53C07F1244824E6E434091C2AB9BC13F53C03916CA784A6E43405E20521DBC3F53C0D18B248B456E434050125CF6B53F53C027E4DE57406E4340119436B0B03F53C0FAD346753A6E4340309FAC18AE3F53C0A280481A376E4340435B295FAB3F53C03FC7478B336E434003A3810EA93F53C0595D3DDD2F6E4340D5FC42D9A53F53C0978DCEF9296E43401829EF3EA23F53C00C95DAE6216E4340E407F87F9F3F53C0D5809C8B1A6E4340C828CFBC9C3F53C08C7D6E0D116E43400475CAA39B3F53C0AD1E8BC80B6E4340289600A19A3F53C0DFE819B1056E43409A829087993F53C00DE2033BFE6D4340173147EA983F53C029A44632F56D434094F36A25993F53C050B7A283E46D4340230A7778993F53C02EA23726D56D43404CB7369E993F53C0B58AFED0CC6D434099F5BDE1993F53C0931337B8BE6D43406ACD45329A3F53C01DFA38E4B06D43403472CC689A3F53C01D0824BC986D4340BDF9B2599A3F53C0DC29C2F28C6D434088E6F0FF993F53C015B7C0D4856D434052EDD3F1983F53C0DE04DF347D6D4340D0B52FA0973F53C0BE4C1421756D434018DEF64E963F53C0C7F319506F6D434055449781943F53C0EE2994E0686D434091AA37B4923F53C038EE3955636D4340DAECA3AE903F53C0598F56105E6D43405E7B0B908D3F53C009F19249576D4340CB51DBE18A3F53C09400EB27526D4340EAE923F0873F53C038DC476E4D6D43406F92301D843F53C0F9A23D5E486D43407D7A6CCB803F53C0C5E3A25A446D4340674A46297C3F53C02D0373993F6D43400AE18739773F53C05F7F129F3B6D4340E98CDE5F733F53C04ED8D9EB386D434056AE015B6F3F53C061D97168366D4340A29520C8663F53C08709B485316D434057F3774A623F53C017E4784F2F6D43407013A4085F3F53C083FCC79D2D6D434001F4A0455B3F53C03D0E83F92B6D43406C2B5151503F53C045C3BD8D286D434058AE1287473F53C087D2286E266D43400442469B3E3F53C00B2D46B8246D434097033DD4363F53C047A753C3236D4340DDA051152E3F53C09B1B785A236D4340A05F4A13253F53C071CADC7C236D434027C1768B1B3F53C06AD95A5F246D434007793D98143F53C058DEFA55256D4340C86D45AC0F3F53C087D2286E266D4340CB2665F7093F53C0C22C59BA276D4340C9810D3E033F53C0EB5D17D9296D434083233779003F53C0795A7EE02A6D4340981CD203FA3E53C09BC8CC052E6D4340D047742AF43E53C06F230AD2316D4340D40330AFED3E53C055FDA5A0366D43404F3E3DB6E53E53C0944A1D893C6D434010C01770E03E53C03821BE5D406D43406C312E0BDC3E53C05ABD1EA7436D434097A542E1D83E53C08F82F11D466D4340289D4830D53E53C0046564DA486D434036EA7CD3CF3E53C0BB9289004C6D43405D627660CA3E53C0C634D3BD4E6D4340','-76.9811021000000011','38.853965500000001','-76.9811021000000011','38.853965500000001','trunk','1666693','1666760','f','2015-12-04 12:34:17.852+00'),
(27066,'0102000020E610000006000000EC6D8ECE544353C0A766C526E871434029DA0BBB5E4353C009B83187EE714340416D0A1A694353C08159A148F7714340D7C86427724353C058E36C3A02724340F7AE415F7A4353C0FD9474DE107243404209336D7F4353C0B09E49511D724340','-77.0546525000000031','38.8915197000000035','-77.0546525000000031','38.8915197000000035','trunk','1666770','1666775','f','2015-12-04 12:34:17.852+00'),
(27069,'0102000020E610000008000000876FBC966B4353C0F4AE303322724340CB283BA2674353C03FA1E8CB1C7243402CB011D2644353C08873C3A51972434082983A7E5E4353C0B4A8F4B81472434085EFFD0D5A4353C051EFF32911724340E5E90198574353C0B8AC67AD0D7243402D9F9BEC554353C0D84D8468087243402E2C6E92554353C001C4B876FD714340','-77.0520979000000068','38.8905475999999979','-77.0520979000000068','38.8905475999999979','trunk','1666792','1666799','f','2015-12-04 12:34:17.852+00'),
(27070,'0102000020E6100000080000002E2C6E92554353C001C4B876FD7143405E297057544353C022403C01037243406A053C1F544353C0BF61A2410A724340C8A87C19564353C02D8FDA691072434042870A1F5B4353C03D16365E157243404D124BCA5D4353C02A8B677517724340D913138A634353C0F83CDA931B724340876FBC966B4353C0F4AE303322724340','-77.0534416999999934','38.8916686999999968','-77.0534416999999934','38.8916686999999968','trunk','1666800','1666807','f','2015-12-04 12:34:17.852+00'),
(27071,'0102000020E610000005000000F1CBAA19634353C01A886533877343407B93F0CE6B4353C0BB511A2087734340BD1EA743824353C0FC9CCC8987734340177321A08C4353C0EABB11CC87734340F19B6791924353C0F6F301DC87734340','-77.0558208000000064','38.9025835999999998','-77.0558208000000064','38.9025835999999998','trunk','1666808','210681','f','2015-12-04 12:34:17.852+00'),
(27073,'0102000020E610000012000000CF9C9A70544353C0997DC3E9C9754340CD5F7C2C584353C05F155E38C675434089EB18575C4353C0BAF605F4C27543404C378941604353C0FD4D2844C0754340D384ED27634353C07BA35698BE754340FBAF73D3664353C0B709F7CABC75434022C154336B4353C005DB8827BB754340AAF413CE6E4353C06BD44334BA7543406092CA14734353C0FB9463B2B87543407C293C68764353C0E4A08499B6754340D9AF3BDD794353C0BC75FEEDB2754340DE1E84807C4353C0717495EEAE75434036E84B6F7F4353C08B6CE7FBA9754340E7C8CA2F834353C0A69883A0A37543407A0668B6864353C07A5AD9999D754340D13FC1C58A4353C070067FBF987543405182FE428F4353C03C2D3F70957543403BAB05F6984353C06F8104C58F754340','-77.0562110000000047','38.91845','-77.0562110000000047','38.91845','trunk','1666963','1666980','f','2015-12-04 12:34:17.852+00'),
(27074,'0102000020E61000001B00000076D0DB8E5F4353C0E24E33EE177B4340B4A789E3654353C043F34AA3137B4340CA953089694353C08CF337A1107B4340B74CE19C6C4353C08D1315600E7B4340E5F21FD26F4353C071766B990C7B4340B9F13856734353C0603FC4060B7B4340288705AD764353C04F081D74097B43401F50919E7D4353C0F04DD367077B4340A4B95F4F854353C06842EE7D057B43406000E143894353C0DA73999A047B4340525A24928D4353C0F8302020047B434080739021914353C08DC2E4FC037B4340D65EFA4D974353C0878FE3E2037B4340DDB1D826954353C09AD832CF007B4340BBE765B9914353C03BFE0B04017B43404CDF6B088E4353C047640E38017B43406028BBF48A4353C01D41857E017B43406265D938874353C0C9CC60E7017B4340CEC87B30844353C082BE3E84027B43402AC764717F4353C02887AAF3037B434061A417B57B4353C0C2E9132F057B434047BA55C6754353C0143E5B07077B434096C2CDF3714353C0FC2367BC087B43409D2F51186F4353C0CB3D6E090A7B434083B8BC83694353C0C45A21510D7B4340FBF72A43664353C04C66063B0F7B43406A25BE245F4353C096D7005B147B4340','-77.0526820999999984','38.9615586999999977','-77.0526820999999984','38.9615586999999977','trunk','1666981','1664464','f','2015-12-04 12:34:17.852+00'),
(27084,'0102000020E61000000E000000A8C87C9B594353C0A80CD242B8714340DA2D138F554353C0BEB8F9EBBA714340895869F7504353C08799C7ABBD714340D28668194E4353C0B631D17BBE714340FE14223B4A4353C0F8C43A55BE7143401EE1B4E0454353C040D9942BBC714340CCF165FD414353C03623DE95B87143404C0B4DC83D4353C05CF1C3F7B4714340B3B1B7393A4353C04B8C0A41B3714340F54DF5BF374353C0297AE063B071434025315239374353C03D258C0BAC7143405BD1E638374353C0D5BAC3DCA471434090717B38374353C038995D9C9D714340FCB1A437374353C04A8B44B291714340','-77.0502452000000062','38.8872587999999979','-77.0502452000000062','38.8872587999999979','trunk','1520599','1667400','f','2015-12-04 12:34:17.852+00'),
(27085,'0102000020E610000002000000FCB1A437374353C04A8B44B2917143401FFE501F374353C01F25C0FA89714340','-77.0502393999999953','38.8870233000000027','-77.0502393999999953','38.8870233000000027','trunk','1667401','210191','f','2015-12-04 12:34:17.852+00'),
(27086,'0102000020E6100000080000002A368BBC514353C0ABF35E6BA571434018FFE329504353C0960BF038A0714340380DF6CB4C4353C03A01F2CA9A7143403AA63858494353C03698E19A967143400C48B192454353C0DFBAACD39271434055EC7948424353C0F892212290714340C8B667F13D4353C0231E3F0A8D7143401FFE501F374353C01F25C0FA89714340','-77.0502393999999953','38.8870233000000027','-77.0502393999999953','38.8870233000000027','trunk','1667402','210191','f','2015-12-04 12:34:17.852+00'),
(27088,'0102000020E6100000030000005DEF48064A4353C0DFF87F7AD875434034D2F7BF484353C0305BFCB7DC75434058F32DBD474353C0DF77C201E3754340','-77.0512535999999955','38.9209901999999985','-77.0512535999999955','38.9209901999999985','trunk','1667447','1667449','f','2015-12-04 12:34:17.852+00'),
(27091,'0102000020E61000000200000058F32DBD474353C0DF77C201E375434021167B794B4353C0314DC752DA754340','-77.0514816000000025','38.9207251999999997','-77.0514816000000025','38.9207251999999997','trunk','1667459','1667460','f','2015-12-04 12:34:17.852+00'),
(27092,'0102000020E610000002000000ABFB11D00E4553C0A5E7CC2CF87343402CE5C63E124553C071845671F4734340','-77.0792385999999965','38.9058972999999995','-77.0792385999999965','38.9058972999999995','trunk','213627','213621','f','2015-12-04 12:34:17.852+00'),
(27093,'0102000020E6100000250000002CE5C63E124553C071845671F473434031D86894094553C0292E7D9EF57343402315C616024553C0B21188D7F5734340D82D0263FD4453C02FA93528F5734340768071BAF64453C0D73B9281F273434091195EFFE44453C071A9EFA1E97343403150638CD94453C02532BD0EE6734340A0D67E7CD34453C085549B49E5734340A52B7D8DC94453C0BAC381EBE573434050A50B56C14453C0AE8B91DBE5734340F6227FD5B64453C0689D4C37E47343407D47E8C2A34453C034F8567FDF734340CE33F6259B4453C03CAD9113DC734340FC1873D7924453C0D921A3A8D873434088878B378D4453C068E2C226D7734340688709B4854453C092335E04D7734340A8EBE4677E4453C03E4970D9D773434034A891F1834453C0C69C0C33D973434019F2BEE0894453C0FC81BC68D973434069EF4229904453C0F5BE4C6FDA7343400188BB7A954453C007F6F301DC734340D3BCE3149D4453C0C9891B5CDF73434065A9F57EA34453C015EDE016E2734340E33213B1AD4453C04AB2B38DE4734340CB55E2F0B84453C096438B6CE7734340DAD60572BF4453C0C537B984E8734340A0A28F9EC74453C059C97D61E8734340D17AF832D14453C042CF66D5E773434075EF3C4CD64453C06072480FE8734340AF714749D94453C0A18FE854E8734340BD7F3D70DF4453C0E24A2CDFE9734340E9E85D61E64453C03FEBD09FEC7343404FA03EB8F14453C096F0DF17F2734340EA8486B4FC4453C058923CD7F7734340F37CBC46014553C087866AEFF873434003A557B9064553C087866AEFF8734340ABFB11D00E4553C0A5E7CC2CF8734340','-77.0790290999999996','38.9060112000000018','-77.0790290999999996','38.9060112000000018','trunk','213621','213627','f','2015-12-04 12:34:17.852+00'),
(27094,'0102000020E6100000120000001FFE501F374353C01F25C0FA897143401C7E37DD324353C0AE275F7589714340A66DB2FC2F4353C031C4FBBB88714340E89E1AD4234353C0FC54151A8871434031FB86D3134353C02692431F8771434016C50666E04253C093F8815083714340D6ECDC0FD34253C0F306F3B28171434052A3EB1DC94253C09A1D4E058171434096760F75C44253C06B6B9FE9807143408BA94FCDC04253C0DC0CDC2681714340E68AF788BD4253C0F3AACE6A81714340806B8203B54253C052370653837143406CD49EEDAC4253C00F289B7285714340E76AD03CA54253C0A98A04AE867143404352B06BA04253C0A98A04AE867143400E2A1664704253C0E4FED9458771434065A54929684253C09D386F528771434025FB31F75A4253C00E7E874787714340','-77.0502393999999953','38.8870233000000027','-77.0368021000000027','38.886940899999999','trunk','210191','1645540','f','2015-12-05 00:31:16.235+00'),
(27095,'0102000020E61000001500000025FB31F75A4253C00E7E874787714340689A0BB7574253C08C1535988671434022C90798544253C0F1B2CB5C857143400072C284514253C0750DE9A68371434013002DA74E4253C08293C89981714340DF8211A04B4253C0A74709B07E71434035796FB1474253C0C72AA5677A7143403D484F91434253C0FA7E6ABC7471434038D906EE404253C0D3872EA86F714340925852EE3E4253C0AC90F2936A71434070B6B9313D4253C0D236FE44657143403BC3D4963A4253C06CEC12D55B714340CB9D9960384253C02844C02154714340850B7904374253C05A643BDF4F7143404450357A354253C0BC0853944B714340279F1EDB324253C006B98B3045714340A5F44C2F314253C09D9E7763417143406553AEF02E4253C08DCF64FF3C714340A8AAD0402C4253C00D8D27823871434045813E91274253C052F6F12B31714340195D39D6204253C027DE5C5727714340','-77.0368021000000027','38.886940899999999','-77.0332542000000018','38.8840130999999971','trunk','1645540','21368','f','2015-12-05 00:31:16.235+00'),
(27096,'0102000020E610000002000000195D39D6204253C027DE5C5727714340A5411BCA1A4253C013FC259820714340','-77.0332542000000018','38.8840130999999971','-77.0328851000000014','38.8838071999999997','trunk','21368','4187','f','2015-12-05 00:31:16.235+00'),
(27097,'0102000020E610000004000000A5411BCA1A4253C013FC259820714340740AF2B3114253C0B26E72AE17714340771F36470C4253C086E8103812714340013DC38A094253C0289023E70E714340','-77.0328851000000014','38.8838071999999997','-77.031832399999999','38.8832673','trunk','4187','1667446','f','2015-12-05 00:31:16.235+00'),
(42,'0102000020E6100000030000000A9865F4484053C01FAB4A11CF7B434001DF6DDE384053C0E99D0AB8E77B4340164B917C254053C0B0928FDD057C4340','-77.0044527999999957','38.9672567000000001','-77.002287999999993','38.9689290000000028','residential','22240','385','t','2015-11-17 04:20:19.46+00'),
(43,'0102000020E610000003000000BBDC161B294153C084C60215447D43409FB01FBD3C4153C010165FFE547D43409977E62F3E4153C05F07CE19517D4340','-77.0181338999999952','38.978640200000001','-77.0194206000000037','38.9790374999999969','residential','1157834','209122','t','2015-11-17 04:20:19.46+00'),
(27098,'0102000020E610000018000000EC18575C1C4253C0A4B789A4277143407157AF22234253C08EB27E333171434093077D44274253C05559CAE8367143400ED539AB2A4253C05ED5FE733D714340B427DC862C4253C0CDC6EF124171434006D847A72E4253C05FA230DE45714340DB977D68304253C06F151FFA49714340877945A6324253C00C512A8650714340CDC3AE92344253C0D9E2BFE556714340CCEB8843364253C053A40C665D714340A24F9ABC374253C03802A72D64714340F502A216394253C052CF27976B7143405305A3923A4253C0786407F071714340527298793C4253C0DA11989878714340EC4493D53E4253C0E992BB197F7143407980DD9F414253C0217F1FC4847143401C1DFC69484253C0BD5296218E7143406EF5413B4C4253C0AFC67EBB9171434030F9FAB5504253C0434CD3B19471434093DD712F554253C0064257C796714340A8C87C9B594253C04759BF9998714340694AFC9B614253C0862238899C714340A3E30FAB644253C062A2410A9E714340658808A4694253C0A1E1838DA1714340','-77.0329810000000066','38.884022299999998','-77.0376978000000037','38.8877426999999969','trunk','1667242','1519245','f','2015-12-05 00:31:16.235+00'),
(27087,'0102000020E61000002A0000001FFE501F374353C01F25C0FA897143401C7E37DD324353C0AE275F7589714340A66DB2FC2F4353C031C4FBBB88714340E89E1AD4234353C0FC54151A8871434031FB86D3134353C02692431F8771434016C50666E04253C093F8815083714340D6ECDC0FD34253C0F306F3B28171434052A3EB1DC94253C09A1D4E058171434096760F75C44253C06B6B9FE9807143408BA94FCDC04253C0DC0CDC2681714340E68AF788BD4253C0F3AACE6A81714340806B8203B54253C052370653837143406CD49EEDAC4253C00F289B7285714340E76AD03CA54253C0A98A04AE867143404352B06BA04253C0A98A04AE867143400E2A1664704253C0E4FED9458771434065A54929684253C09D386F528771434025FB31F75A4253C00E7E874787714340689A0BB7574253C08C1535988671434022C90798544253C0F1B2CB5C857143400072C284514253C0750DE9A68371434013002DA74E4253C08293C89981714340DF8211A04B4253C0A74709B07E71434035796FB1474253C0C72AA5677A7143403D484F91434253C0FA7E6ABC7471434038D906EE404253C0D3872EA86F714340925852EE3E4253C0AC90F2936A71434070B6B9313D4253C0D236FE44657143403BC3D4963A4253C06CEC12D55B714340CB9D9960384253C02844C02154714340850B7904374253C05A643BDF4F7143404450357A354253C0BC0853944B714340279F1EDB324253C006B98B3045714340A5F44C2F314253C09D9E7763417143406553AEF02E4253C08DCF64FF3C714340A8AAD0402C4253C00D8D27823871434045813E91274253C052F6F12B31714340195D39D6204253C027DE5C5727714340A5411BCA1A4253C013FC259820714340740AF2B3114253C0B26E72AE17714340771F36470C4253C086E8103812714340013DC38A094253C0289023E70E714340','-77.031832399999999','38.8832673','-77.031832399999999','38.8832673','trunk','210191','1667446','t','2015-12-04 12:34:17.852+00'),
(27090,'0102000020E6100000070000005DEF48064A4353C0DFF87F7AD8754340236D3E09474353C07CECD396DF754340E32A604C444353C055409072E6754340FC47F0D0414353C0F353C14DEB754340BC4A2D4A3F4353C07F106ED7F07543409D56C0F3414353C009E643ABEE75434058F32DBD474353C0DF77C201E3754340','-77.0512535999999955','38.9209901999999985','-77.0512535999999955','38.9209901999999985','trunk','1667453','1667458','t','2015-12-04 12:34:17.852+00'),
(27099,'0102000020E610000002000000658808A4694253C0A1E1838DA1714340FD99E6C26D4253C0B993E3A9A2714340','-77.0376978000000037','38.8877426999999969','-77.037949299999994','38.8877766000000022','trunk','1519245','1519295','f','2015-12-05 00:31:16.235+00'),
(27102,'0102000020E610000003000000187F36CD964353C00B010A3F82734340F2ECF2AD8F4353C0C9810D3E837343408FC0C4C48B4353C03360DA8184734340','-77.0560791999999992','38.9024123000000017','-77.0554058000000026','38.902481299999998','trunk','210695','1123508','f','2015-12-05 00:31:16.235+00'),
(27103,'0102000020E6100000040000008FC0C4C48B4353C03360DA8184734340C9FA720B824353C0B0DDE286847343405E7A45016C4353C08D91369F84734340D972D30B634353C0878C47A984734340','-77.0554058000000026','38.902481299999998','-77.0529202999999967','38.9024860000000032','trunk','1123508','1667112','f','2015-12-05 00:31:16.235+00'),
(27104,'0102000020E61000000200000023FA10AF464353C02050EC57F0754340CADFBDA3464353C0AC0C99E1F5754340','-77.051189199999996','38.9213972000000012','-77.0511865','38.9215662000000009','trunk','1666650','4256','f','2015-12-05 00:31:16.235+00'),
(27105,'0102000020E610000003000000CADFBDA3464353C0AC0C99E1F575434070ABC54C474353C06D80E37CFB75434070ED4449484353C0D047197101764340','-77.0511865','38.9215662000000009','-77.0512870000000021','38.9219190000000026','trunk','4256','7710','f','2015-12-05 00:31:16.235+00'),
(27106,'0102000020E61000000C00000070ED4449484353C0D04719710176434010B1C1C2494353C0732CEFAA077643404A7B832F4C4353C0D52137C30D764340014D840D4F4353C05C21ACC612764340FA27B858514353C019CA89761576434093C6681D554353C00BB43BA418764340C1E270E6574353C0EC32FCA71B764340074147AB5A4353C0D23AAA9A2076434030BABC395C4353C0B285200725764340410B09185D4353C0261AA4E02976434006D9B27C5D4353C0FAB660A92E764340717500C45D4353C0C7629B5434764340','-77.0512870000000021','38.9219190000000026','-77.0525980000000033','38.9234719999999967','trunk','7710','24253','f','2015-12-05 00:31:16.235+00'),
(27107,'0102000020E610000006000000E0956E5C904053C0A0D10C98766F43406E36B11B914053C0EB5CAC037B6F4340B52792F9914053C071B8454F806F434038EC08F1924053C007454EBA886F4340385F364B934053C033631B02916F434091798956934053C07FFD6BD49E6F4340','-77.0088111000000026','38.8708067000000028','-77.0089928000000015','38.8720345999999992','trunk','211236','211231','f','2015-12-05 00:31:16.235+00'),
(27108,'0102000020E61000000200000091798956934053C07FFD6BD49E6F43403E4D1C2F934053C0F8B0CD7CBD6F4340','-77.0089928000000015','38.8720345999999992','-77.0089834000000053','38.8729701999999975','trunk','211231','1664580','f','2015-12-05 00:31:16.235+00'),
(27109,'0102000020E6100000090000003E4D1C2F934053C0F8B0CD7CBD6F4340C18AF8F3924053C04D88145EDD6F4340DE44E33F934053C07F69519FE46F43408B5AF514944053C0EEA53A2EF46F434061095A37944053C0EA43728D2A70434061095A37944053C0C7BEBF9C3470434061095A37944053C03D409C2C5A7043406DE525FF934053C09752978C6370434020347161934053C0FDD8C9856F704340','-77.0089834000000053','38.8729701999999975','-77.0089954000000034','38.8784034000000034','trunk','1664580','211292','f','2015-12-05 00:31:16.235+00'),
(27110,'0102000020E61000000400000020347161934053C0FDD8C9856F70434091932EA2924053C0A28AD1297E7043405C0D3FEE914053C0623A634E86704340C2903067914053C0E8A969728C704340','-77.0089954000000034','38.8784034000000034','-77.0088747000000069','38.8792861000000016','trunk','211292','211295','f','2015-12-05 00:31:16.235+00'),
(27111,'0102000020E6100000130000005644F23A073E53C00917F2086E7543406A9CF28D0D3E53C0BB03E1AF6E754340A070766B193E53C0B54071B66F7543406D8FDE701F3E53C02C15AF0D70754340161AE31E263E53C0CD3A8842707543409A1EB9DA2F3E53C09DD090966F75434035481C0D3B3E53C015D918856E754340FDDAFAE93F3E53C0AA6ADD616E754340D0CDA387463E53C0F10236316E754340C8A29F5F4A3E53C02D91B0146E754340C08EA4494E3E53C0681F2BF86D754340700DC74E533E53C0860AC4A16D7543409B98897D5D3E53C08710FC146C75434032A42F29633E53C0DBB232D06B7543405EF3AACE6A3E53C064DEF4786B75434038E3EAB67A3E53C07C0C569C6A75434096FC998B893E53C0237FD5366A754340659A9FD18C3E53C0E28F47156A75434020BEA7CD933E53C00580CFB469754340','-76.9691913000000056','38.9174204999999986','-76.9777712000000065','38.9172883999999968','trunk','1667113','1718','f','2015-12-05 00:31:16.235+00'),
(27112,'0102000020E61000000C00000020BEA7CD933E53C00580CFB46975434066B56565A03E53C08F7D7F3969754340851CA55CAB3E53C03C99C981687543404DB21F73AF3E53C0D7016B306875434024E36256B93E53C0A14ACD1E68754340BD9580F3BD3E53C0F5BEF1B567754340EAAEEC82C13E53C0D15ED8F566754340012A66CEC43E53C0A26AAADD65754340EDE016E2C73E53C0080841A264754340B6903644CB3E53C0B6B3F9C9627543404E4354E1CF3E53C09FABADD85F754340EDED3B2B0E3F53C033D1D67734754340','-76.9777712000000065','38.9172883999999968','-76.9852398000000022','38.9156637000000032','trunk','1718','212671','f','2015-12-05 00:31:16.235+00'),
(27113,'0102000020E610000002000000EDED3B2B0E3F53C033D1D67734754340E87F5E5D3A3F53C0D18D55EF15754340','-76.9852398000000022','38.9156637000000032','-76.9879372999999987','38.9147318999999996','trunk','212671','212673','f','2015-12-05 00:31:16.235+00'),
(27114,'0102000020E610000002000000E87F5E5D3A3F53C0D18D55EF1575434031D4BC3E4E3F53C008A40E3C08754340','-76.9879372999999987','38.9147318999999996','-76.9891506999999962','38.9143138000000022','trunk','212673','212675','f','2015-12-05 00:31:16.235+00'),
(27115,'0102000020E61000000200000031D4BC3E4E3F53C008A40E3C087543409F94490D6D3F53C05A1AAEC4F2744340','-76.9891506999999962','38.9143138000000022','-76.9910310000000067','38.9136586999999992','trunk','212675','1124808','f','2015-12-05 00:31:16.235+00'),
(27116,'0102000020E6100000040000009F94490D6D3F53C05A1AAEC4F2744340380E61A17B3F53C00C2C369CE87443400080AD5CB93F53C0D5ACD804BD74434091EB4BDBE43F53C04974E0E69E744340','-76.9910310000000067','38.9136586999999992','-76.9983433000000019','38.9110992999999965','trunk','1124808','212631','f','2015-12-05 00:31:16.235+00'),
(27117,'0102000020E61000000400000091EB4BDBE43F53C04974E0E69E744340A24E2FE7084053C0D93CB3C986744340253CA1D71F4053C0649FB6FC76744340F64B7ACE4C4053C0A97290C657744340','-76.9983433000000019','38.9110992999999965','-77.0046878999999933','38.908928699999997','trunk','212631','212620','f','2015-12-05 00:31:16.235+00'),
(27118,'0102000020E610000003000000F64B7ACE4C4053C0A97290C657744340C4AFFD09534053C040FC57B153744340F821252C604053C086C77E164B744340','-77.0046878999999933','38.908928699999997','-77.0058698999999933','38.9085414999999983','trunk','212620','213305','f','2015-12-05 00:31:16.235+00'),
(27119,'0102000020E610000003000000F821252C604053C086C77E164B744340D027F224694053C09603E21A447443403EDD8A0E924053C021D96D6127744340','-77.0058698999999933','38.9085414999999983','-77.0089145999999971','38.9074517999999969','trunk','213305','212622','f','2015-12-05 00:31:16.235+00'),
(27120,'0102000020E6100000020000003EDD8A0E924053C021D96D61277443401E70B8EA954053C0052857C224744340','-77.0089145999999971','38.9074517999999969','-77.0091501999999934','38.9073718','trunk','212622','212600','f','2015-12-05 00:31:16.235+00'),
(27123,'0102000020E610000003000000606D31E47D4053C07FFACF9A1F794340F0A07EBC7C4053C0CAF2BFA618794340C0C0BD7C7C4053C05A5139DCFD784340','-77.0076837999999952','38.946277000000002','-77.0075980999999956','38.9452471999999972','trunk','213600','213608','f','2015-12-05 00:31:16.235+00'),
(27124,'0102000020E610000009000000C0C0BD7C7C4053C05A5139DCFD784340BB1A8F087C4053C07AC37DE4D67843400859164C7C4053C02BA1BB24CE7843408BAA5FE97C4053C0E2218C9FC6784340D7CE41E17D4053C0C7968A32C078434042F2295B7F4053C01EC76A4EB978434012DE1E84804053C0AA7A9EE4B3784340D55DD905834053C09E0B23BDA8784340B66C08E9844053C019BCF957A0784340','-77.0075980999999956','38.9452471999999972','-77.0081121999999993','38.9423932999999991','trunk','213608','1666670','f','2015-12-05 00:31:16.235+00'),
(27127,'0102000020E610000003000000A109B9F7954053C0C5BA021B21744340BB29E5B5924053C0BE672442237443400536429A8C4053C0A489778027744340','-77.0091532999999941','38.9072602999999972','-77.0085816999999935','38.9074554999999975','trunk','212596','212590','f','2015-12-05 00:31:16.235+00'),
(27128,'0102000020E6100000040000000536429A8C4053C0A48977802774434033993B446D4053C09330783D3D74434096A5E727664053C0AEEFC3414274434046329A4B604053C03B3CDFAA46744340','-77.0085816999999935','38.9074554999999975','-77.0058774000000028','38.9084065999999993','trunk','212590','213304','f','2015-12-05 00:31:16.235+00'),
(27129,'0102000020E61000000200000046329A4B604053C03B3CDFAA467443405CBBA3B5584053C0F11B15EE4B744340','-77.0058774000000028','38.9084065999999993','-77.0054144000000065','38.9085672000000002','trunk','213304','212592','f','2015-12-05 00:31:16.235+00'),
(27130,'0102000020E6100000030000005CBBA3B5584053C0F11B15EE4B74434002F4FBFE4D4053C017974FFB52744340103BF82E4A4053C01C06989E55744340','-77.0054144000000065','38.9085672000000002','-77.0045278000000053','38.9088629000000026','trunk','212592','212594','f','2015-12-05 00:31:16.235+00'),
(27100,'0102000020E610000008000000FD99E6C26D4253C0B993E3A9A2714340FC6541727C4253C0D923D40CA97143403C7771D17F4253C07FBE2D58AA714340D49CBCC8844253C00E315EF3AA714340DEF3B2DC884253C0B42D14FAAA7143407D9AEED08B4253C0559BA49EAA714340E0AF13A88F4253C09776C5E7A9714340908DF62E944253C07A072E45A8714340','-77.037949299999994','38.8877766000000022','-77.0402943999999934','38.887947699999998','trunk','1519295','27974','f','2015-12-05 00:31:16.235+00'),
(27131,'0102000020E61000001A000000103BF82E4A4053C01C06989E557443405A35BEE5204053C0FB422333727443404DA3247F0B4053C0A0C618B3807443405998CF03E93F53C0D0E0A58A987443406253420BE43F53C0B0E99CFA9B7443404EFB9C71D03F53C0565925A2A974434085EF58C7CC3F53C03D539E2FAC74434076093D51C83F53C065C6DB4AAF7443408F20F01BBA3F53C030D63730B9744340845B881FAD3F53C0EAC2595BC2744340C5F94097953F53C08EF85FF8D2744340AA2E3B1F793F53C0908653E6E6744340FD82DDB06D3F53C098CE3DDAEE744340C0554387653F53C024B9FC87F47443402CA4575E4D3F53C021F24C1E05754340BFD53A71393F53C044DFDDCA127543407661B5430D3F53C02EAA454431754340AD45555DD13E53C0495EE7F05A754340960FF747CE3E53C0DCA1BCEA5C754340F26904D1C93E53C06AF40FC75F754340B3EBDE8AC43E53C03FB1A94E627543406E4B89C9C03E53C0C1A3326A63754340DCBA9BA7BA3E53C0C7EAA05C64754340FD1CD59FB33E53C0D350A390647543407B979C24A73E53C0611FF873657543403D1FAF51A03E53C08AFAC9BD65754340','-77.0045278000000053','38.9088629000000026','-76.978535100000002','38.9171673999999967','trunk','212594','1701','f','2015-12-05 00:31:16.235+00'),
(27132,'0102000020E61000000C0000003D1FAF51A03E53C08AFAC9BD65754340D8E033C8933E53C0BA089D2166754340D03C258C8B3E53C02BD8EB8266754340C7F65AD07B3E53C0137C783B67754340E06CCE1C6D3E53C0EFB902C067754340EF045669663E53C0CB9B68FC67754340069497465D3E53C00C5DE4F967754340FA2A5492503E53C0016DAB5967754340B6BE48684B3E53C066A8E56267754340B7D5AC333E3E53C066321CCF6775434082D6B26B313E53C048A3A76D687543406101A7D22A3E53C0596ABDDF68754340','-76.978535100000002','38.9171673999999967','-76.9713636999999977','38.9172629999999984','trunk','1701','1667045','f','2015-12-05 00:31:16.235+00'),
(27133,'0102000020E6100000230000005A290472894353C0BB75A33440724340C51B3E8E8B4353C0177A692F47724340F96A47718E4353C07D2079E750724340E6CB0BB08F4353C00A11700855724340FDBFEAC8914353C0B3B27DC85B72434055D16927944353C00E55E7076472434060EC18B2954353C065D0BF1369724340E251CF27974353C0CE740A4D6D7243405391AFA9984353C025C2D03472724340460BD0B69A4353C0E65DF58079724340E01115AA9B4353C0371C96067E724340516B9A779C4353C0F25CDF8783724340E5B4A7E49C4353C02502D53F88724340C79BFC169D4353C064213A048E724340DFDDCA129D4353C08544DAC69F7243400F62670A9D4353C01ADF1797AA7243400F62670A9D4353C0284696CCB17243405628D2FD9C4353C0AE2EA704C47243406E6AA0F99C4353C0179AEB34D272434074417DCB9C4353C0204432E4D872434080EF366F9C4353C07C48F8DEDF7243402174D0259C4353C0E45CD438E57243400AD6DDE19B4353C05F9A22C0E97243406F9EEA909B4353C0DFC2BAF1EE7243404BC8073D9B4353C04D327216F6724340938E72309B4353C02B155454FD7243405D33F9669B4353C064778192027343407B32FFE89B4353C0DEC83CF2077343409EEE3CF19C4353C0AB402D060F734340D3156C239E4353C0D7C0560916734340F6B704E09F4353C078094E7D207343404221020EA14353C00492B06F27734340415AAD5DA44353C083A3E4D5397343409940B6D1A54353C0A9047A97417343405040C9D3A84353C036E4446051734340','-77.055263999999994','38.8925843999999969','-77.0571793999999954','38.9009209000000027','trunk','1667147','210647','f','2015-12-05 00:31:16.235+00'),
(27134,'0102000020E61000003E0000005040C9D3A84353C036E4446051734340329A4B60A94353C00FF6813F5773434068AD0DBAA94353C053D21E8A5D73434026BE7F98A94353C00EB10B5064734340264B523EA94353C0528DA89A6A734340B0D5D468A84353C00D6C956071734340DA401592A74353C0B82D80DF757343409FFDED57A64353C0BAA4C5747C734340CF6D1D77A54353C01DA0450081734340D6EE0D74A34353C006AFA7678B73434083802150A24353C01B7D714E9173434007AA903CA14353C077813749987343402BF9D85DA04353C06CFCD357A17343406745D4449F4353C0CBAB297FAD734340979EFA519E4353C0968D7340B77343407A01518B9C4353C0CE177B2FBE734340459506239B4353C001BD70E7C273434030A75F7D974353C06DD800B6CD7343401F42A6C6954353C09417F439D2734340A35DE04D924353C04ED60341DB734340DBADC0EB8E4353C0EFA83121E6734340954FEA268C4353C00E130D52F0734340FB624A7F8A4353C0BDB90908F77343407E198C11894353C00E164ED2FC7343406E72535E864353C0CC71B8A0087443408672A25D854353C01D0247020D744340B16D5166834353C0B9C15087157443403B71395E814353C0FC3559A31E7443407100FDBE7F4353C0B742588D25744340F08975AA7C4353C09F03CB11327443402CF015DD7A4353C03D2B69C53774434081B22957784353C09372F7393E744340596DFE5F754353C089B14CBF4474434036E50AEF724353C01C5F7B6649744340200BD121704353C09DA1B8E34D74434092E68F696D4353C053591476517443401747E5266A4353C0999D45EF5474434030F14751674353C044DB3175577443404AB54FC7634353C04F2157EA597443406F0D6C95604353C00DFE7E315B744340FB78E8BB5B4353C0A1478C9E5B7443404D8237A4514353C043739D465A744340DE76A1B94E4353C04F2157EA597443402D7C7DAD4B4353C00E32C9C859744340D5CC5A0A484353C037C5E3A25A7443405A2DB0C7444353C0B96FB54E5C7443402C11A8FE414353C0E1CE85915E744340AA807B9E3F4353C06FF3C649617443408121AB5B3D4353C037161406657443408F1D54E23A4353C0172D40DB6A7443405AF624B0394353C06D74CE4F71744340D717096D394353C05E2A36E67574434000C5C892394353C074B680D07A744340E29178793A4353C0F4C473B680744340D595CFF23C4353C0850A0E2F88744340048761D13E4353C00C10BBA58B7443406258B4EF404353C02717BE199074434025F213BD424353C02BC885B99374434012369776454353C0C318479B997443408D1A5DEF484353C0A2574D21A1744340D80121A34D4353C0D2EA9A7FAA74434034208CE9534353C0CD785BE9B5744340','-77.0571793999999954','38.9009209000000027','-77.0519965999999954','38.9118015000000028','trunk','210647','1667241','f','2015-12-05 00:31:16.235+00'),
(27135,'0102000020E610000004000000E9B23D1F0A4253C0486128716771434001F50B1B0A4253C0E113460E6C7143400DE8E0F4094253C08349963897714340D613025E0B4253C016C9B2BB9B714340','-77.0318678000000006','38.8859692999999993','-77.0319437999999934','38.8875651000000033','trunk','20591','20592','f','2015-12-05 00:31:16.235+00'),
(27136,'0102000020E610000005000000D613025E0B4253C016C9B2BB9B714340E2009FC40C4253C0B88A6AB697714340C4D0EAE40C4253C02EDF9FF76B7143409A513DE30C4253C048612871677143406AE4A9FD0C4253C08A89720E43714340','-77.0319437999999934','38.8875651000000033','-77.0320428999999933','38.8848588999999976','trunk','20592','1666791','f','2015-12-05 00:31:16.235+00'),
(27137,'0102000020E6100000050000005DEF48064A4353C0DFF87F7AD8754340236D3E09474353C07CECD396DF754340E32A604C444353C055409072E6754340FC47F0D0414353C0F353C14DEB754340BC4A2D4A3F4353C07F106ED7F0754340','-77.0513930999999985','38.9206689000000026','-77.0507379000000014','38.9214124000000012','trunk','1667453','212018','f','2015-12-05 00:31:16.235+00'),
(27138,'0102000020E610000003000000BC4A2D4A3F4353C07F106ED7F07543409D56C0F3414353C009E643ABEE75434058F32DBD474353C0DF77C201E3754340','-77.0507379000000014','38.9214124000000012','-77.0512535999999955','38.9209901999999985','trunk','212018','1667458','f','2015-12-05 00:31:16.235+00'),
(27139,'0102000020E6100000110000002CE5C63E124553C071845671F4734340E3546B61164553C0CD3D247CEF7343405837DE1D194553C0BC067DE9ED734340C9AD49B7254553C0A7AE7C96E77343401C3F541A314553C0FE0C6FD6E0734340B6F7A92A344553C070B4E386DF734340F0A7C64B374553C0B894F3C5DE734340E29178793A4553C0D6AD9E93DE734340C93846B2474553C076711B0DE07343402D9622F94A4553C0D4450A65E17343404643C6A3544553C03CF88903E8734340297B4B395F4553C0AF2479AEEF734340DD7C23BA674553C07022FAB5F57343403B3AAE46764553C083DE1B4300744340A454C2137A4553C0FF976BD10274434018062CB98A4553C0BEF90D130D7443402EC6C03A8E4553C0A56950340F744340','-77.0792385999999965','38.9058972999999995','-77.0868059999999957','38.9067140000000009','trunk','213621','8697','f','2015-12-05 00:31:16.235+00'),
(27140,'0102000020E61000003B0000002EC6C03A8E4553C0A56950340F744340E404B7FF924553C0505F854A12744340B61F3A4E9B4553C02A5D5551177443400690EBF0A14553C0A5106D6C1B744340FC805193AA4553C0E97C789620744340001874E7AE4553C029A84D41237443407B6F67BAB24553C05E3F0E9425744340A327C00BB64553C0B6F468AA277443402A7524F2B84553C074B7EBA529744340646A5C49BC4553C00D8AE6012C7443404AE8D3CFC04553C0D6500F762F744340BFDEB364C44553C0871D215E32744340946A9F8EC74553C0FDFF931A357443403944DC9CCA4553C037F867AB377443403596557DD34553C057540E773F74434021DAD836D64553C0914CE20742744340F6F29606D94553C066097C8F44744340E3361AC0DB4553C0A001502047744340E8A56263DE4553C07BF1EAC1497443407AC6BE64E34553C037A8FDD64E744340F67F0EF3E54553C006BCCCB051744340897B2C7DE84553C016BF29AC547443407C7F83F6EA4553C05646239F57744340278925E5EE4553C0FA5E43705C7443404206F2ECF24553C051DA1B7C61744340914259F8FA4553C057E883656C744340DC291DACFF4553C0664F029B73744340DA8D3EE6034653C080643A747A7443402C6684B7074653C0BE839F388074434005C078060D4653C0376DC66988744340D237691A144653C0C0594A969374434029E78BBD174653C0CFF412639974434046B247A8194653C03352EFA99C744340DF6A9DB81C4653C03C3080F0A1744340DDCEBEF2204653C002B7EEE6A974434095D74AE82E4653C0118C834BC7744340768A5583304653C009336DFFCA7443400A86730D334653C0A75A0BB3D07443409D9B36E3344653C05264ADA1D474434037548CF3374653C053E9279CDD7443406B2DCC423B4653C0BFF04A92E7744340F8510DFB3D4653C003999D45EF744340BB9D7DE5414653C0F14A92E7FA744340A7B05241454653C0338B506C057543409966BAD7494653C020D5B0DF1375434033535A7F4B4653C0BDFC4E93197543405038BBB54C4653C0C11DA8531E754340888043A8524653C0DFA469503475434069FF03AC554653C0AA807B9E3F75434026A8E15B584653C0D498107349754340D7A205685B4653C00A2B1554547543402F6CCD565E4653C0ED629AE95E7543405C548B88624653C0B6A2CD716E7543409738F240644653C00CEA5BE6747543404E0AF31E674653C0064A0A2C8075434023F59ECA694653C024B4E55C8A7543407044F7AC6B4653C0448655BC91754340CEB925836D4653C041DE061099754340D35CB8BD6E4653C0F65BE0979F754340','-77.0868059999999957','38.9067140000000009','-77.1005090999999965','38.9189329000000015','trunk','8697','8765','f','2015-12-05 00:31:16.235+00'),
(27141,'0102000020E610000033000000D35CB8BD6E4653C0F65BE0979F75434096218E75714653C03ECF9F36AA754340CB2E185C734653C0D505BCCCB0754340B85B9203764653C0187AC4E8B97543403A0664AF774653C00A302C7FBE7543407AA702EE794653C0439259BDC37543408507CDAE7B4653C0ACAC6D8AC7754340B43D7AC37D4653C06EDE3829CC754340D10836AE7F4653C01EA5129ED075434010768A55834653C0C712D6C6D87543406859F78F854653C0B8C83D5DDD75434024809BC58B4653C018EE5C18E97543402EAC1BEF8E4653C0A9674128EF75434092239D81914653C04E8061F9F3754340056A3178984653C06B82A8FB00764340516B9A779C4653C02B4CDF6B0876434086AFAF75A94653C0DEE8633E20764340F0FD0DDAAB4653C01D3C139A24764340C4E8B985AE4653C05C8FC2F5287643402DE92807B34653C071E7C2482F76434085CC9541B54653C0E0F2583332764340FBAE08FEB74653C014CC988235764340BDE0D39CBC4653C000917EFB3A764340793BC269C14653C06E3480B74076434029E8F692C64653C000AE64C746764340BA2D910BCE4653C0DD5CFC6D4F76434095D5743DD14653C0F9D9C87553764340B7291E17D54653C0DFE17668587643403D29931ADA4653C0B24AE9995E764340F4E0EEACDD4653C09E4319AA627643402D776682E14653C0E353008C677643408B170B43E44653C0BDE13E726B76434012312592E84653C0849CF7FF717643404033880FEC4653C0C3BB5CC4777643401ADB6B41EF4653C0C0EB33677D764340548B8862F24653C01C2444F982764340056C0723F64653C007B5DFDA897643400F7EE200FA4653C0B6132521917643406C04E275FD4653C0EE4108C897764340EE60C43E014753C00266BE839F764340D482177D054753C05645B8C9A87643405BD07B63084753C0D0622992AF764340187959130B4753C067994528B6764340B82231410D4753C00B7E1B62BC764340E19BA6CF0E4753C002F1BA7EC1764340C2340C1F114753C046990D32C976434097395D16134753C04E4354E1CF76434030D80DDB164753C07DB08C0DDD7643400A4CA7751B4753C00ABE69FAEC7643404F5C8E57204753C08AE942ACFE7643400492B06F274753C02B210EC814774340','-77.1005090999999965','38.9189329000000015','-77.1117820000000052','38.9303217000000004','trunk','8765','8832','f','2015-12-05 00:31:16.235+00'),
(27143,'0102000020E610000005000000D79244E5954053C00598439C987043405A153CE0954053C04B636A0190704340D7F10467954053C0DC12149A7F704340310C5872954053C094579D8B7570434025308CAA954053C0D3B540CC6F704340','-77.0091488999999996','38.8796572999999981','-77.0091349000000065','38.8784118000000021','trunk','211290','211291','f','2015-12-05 00:31:16.235+00'),
(27144,'0102000020E61000000600000025308CAA954053C0D3B540CC6F704340726E13EE954053C02CE45B6963704340CB8866F9954053C06791370A5A704340726E13EE954053C0C7BEBF9C34704340E9CF23EB954053C0EA43728D2A70434012ABF534964053C08365112FF46F4340','-77.0091349000000065','38.8784118000000021','-77.0091678999999942','38.8746393999999995','trunk','211291','211213','f','2015-12-05 00:31:16.235+00'),
(27145,'0102000020E61000000700000012ABF534964053C08365112FF46F4340E98A08B5954053C0DB3BFE66BD6F434072FBE593954053C07FFD6BD49E6F4340E340FE88954053C07C35F6DB8D6F4340E3CDD02E954053C0B5C2F4BD866F434008EF062C944053C018A18E7D7F6F43403E0B9D32924053C06A3414D2756F4340','-77.0091678999999942','38.8746393999999995','-77.0089231999999981','38.870783099999997','trunk','211213','1667387','f','2015-12-05 00:31:16.235+00'),
(27146,'0102000020E6100000060000009D90E744CC3E53C0EEA710D9516D4340BDBBDFB2D43E53C04ABD022C4D6D43403813D385D83E53C080666BD84A6D4340220093AFDF3E53C000E2AE5E456D4340A88306ACE63E53C0B61490F63F6D43403E86D8AAEE3E53C0DC0253173A6D4340','-76.9812175999999937','38.8540603000000004','-76.9833170999999936','38.8533352999999977','trunk','1667046','1645517','f','2015-12-05 00:31:16.235+00'),
(27077,'0102000020E610000006000000187F36CD964353C00B010A3F82734340F2ECF2AD8F4353C0C9810D3E837343408FC0C4C48B4353C03360DA8184734340C9FA720B824353C0B0DDE286847343405E7A45016C4353C08D91369F84734340D972D30B634353C0878C47A984734340','-77.0529202999999967','38.9024860000000032','-77.0529202999999967','38.9024860000000032','trunk','210695','1667112','t','2015-12-04 12:34:17.852+00'),
(27147,'0102000020E61000003C0000003E86D8AAEE3E53C0DC0253173A6D4340A17EBCFCF33E53C0F065474F366D4340C8444AB3F93E53C04B8FA67A326D43407EE59C33FD3E53C0A60EF27A306D434052370653033F53C08F90DCF52D6D4340844C8D2B093F53C0675F1ED72B6D434052126D220E3F53C0618E79782A6D4340C100C287123F53C074B7EBA5296D4340D00EB8AE183F53C0E5E896C2286D43405A8E46F4213F53C0C25A6BDE276D4340E0A4C409273F53C0987F9994276D43403088A3062E3F53C039A572C9276D4340806B8203353F53C0519F8955286D4340CABF3B9E3B3F53C0C72B103D296D4340A97DDF64403F53C0CD446C0B2A6D4340E11B542C483F53C0B4588AE42B6D4340904C874E4F3F53C0C5477A072E6D434043763980593F53C0C92654CB316D4340EB3C85B7623F53C05B4A4C06366D434017A6A5A8693F53C036D88AEC396D4340F1A0D9756F3F53C02E51627C3D6D43400C186E0A753F53C008DFA062416D434009C1AA7A793F53C06C98A1F1446D43408A4B9F677D3F53C004C18822496D43406B2684B3803F53C01406651A4D6D43401B9139E0843F53C0FFF85CB7526D4340E4CD2BE8873F53C0A9A0A2EA576D43402A9F2F078B3F53C00002D6AA5D6D4340AC4665798D3F53C08C625EEC626D43400A5DD3CD8F3F53C0187B2FBE686D434068734122923F53C014A5CEED6F6D434061AD35EF933F53C0F9D45691766D434078B81D1A963F53C0002B76EA806D43409B2F40EC963F53C05011F120876D4340D0B52FA0973F53C0A58059468F6D4340351F7CCD973F53C01D50DB2B986D43401DF4B6E3973F53C0A3A53C049F6D4340EE13F6A3973F53C066FA25E2AD6D4340530A1577973F53C08871EDFABB6D4340A1D56E60973F53C0475DC6A8C66D434065EBCF34973F53C084E6841ACF6D4340AD3E0DCE963F53C03E0A325DE36D4340837A4496963F53C060611CB7F36D434065A6B4FE963F53C014BF1880FC6D4340D65B5E14983F53C0A560D740046E43409A829087993F53C01D3059260D6E4340A424DA449C3F53C09AF8591B196E43407F9EAB529F3F53C012C8DB00226E4340B82EEBB4A43F53C09B6CA8BD2D6E434004087A03A73F53C0818EFBFB316E434056CFEE35A93F53C020329BB6356E43407DDD335CAE3F53C058BCA2A53C6E43408CEB2983B43F53C0DD11047E436E4340EDC094DCBC3F53C0BC7E1C284B6E4340CBD1883EC43F53C05F63F261516E43403A36A737C83F53C058248161546E4340DFDB99AECC3F53C00376DABF576E4340F46A80D2D03F53C0A28F430E5B6E4340B537537CD73F53C0E1F65F42606E434089D40F45DC3F53C0F28F6390606E4340','-76.9833170999999936','38.8533352999999977','-76.997819199999995','38.8623218999999978','trunk','1645517','211057','f','2015-12-05 00:31:16.235+00'),
(27101,'0102000020E610000016000000908DF62E944253C07A072E45A8714340E21D8590984253C0C9F264EDA5714340EBB996DA9C4253C04177EEE2A2714340197442E8A04253C05B69087D9F714340CFCCDDF8A44253C0DADE13909B714340A46FD234A84253C065726A6798714340CC3E3498AB4253C09C35785F95714340ED4A2602B04253C0A9EFA1E991714340AA04D550B44253C081AA76F28E7143407D845094BA4253C04D2D5BEB8B714340E536D032C14253C078280AF4897143408F0FC4C3C54253C07E75B05989714340687A89B1CC4253C0193A7650897143402F9402C1D24253C05AB33ADE89714340EC2E5052E04253C04EEBDBEE8A714340829B7BFEEA4253C0BE7273E08B714340067EF9090C4353C0F33746578E7143405B07077B134353C01C6F3CE98E714340B739DF991A4353C04BAB21718F714340B3B112F32C4353C0802E75EB90714340C8ADEEFD324353C0868F882991714340FCB1A437374353C04A8B44B291714340','-77.0402943999999934','38.887947699999998','-77.0502452000000062','38.8872587999999979','trunk','27974','1667291','f','2015-12-05 00:31:16.235+00')
;

--
-- Name: street_edge_assignment_count; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.street_edge_assignment_count (
    street_edge_assignment_count_id integer NOT NULL,
    street_edge_id integer NOT NULL,
    assignment_count integer DEFAULT 0 NOT NULL,
    completion_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE sidewalk.street_edge_assignment_count OWNER TO sidewalk;

--
-- Name: street_edge_assignment_count_street_edge_assignment_count_i_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.street_edge_assignment_count_street_edge_assignment_count_i_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.street_edge_assignment_count_street_edge_assignment_count_i_seq OWNER TO sidewalk;

--
-- Name: street_edge_assignment_count_street_edge_assignment_count_i_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.street_edge_assignment_count_street_edge_assignment_count_i_seq OWNED BY sidewalk.street_edge_assignment_count.street_edge_assignment_count_id;


--
-- Name: street_edge_issue; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.street_edge_issue (
    street_edge_issue_id integer NOT NULL,
    street_edge_id integer NOT NULL,
    issue text NOT NULL,
    user_id text NOT NULL,
    ip_address text NOT NULL,
    "timestamp" timestamp with time zone NOT NULL
);


ALTER TABLE sidewalk.street_edge_issue OWNER TO sidewalk;

--
-- Name: street_edge_issue_street_edge_issue_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.street_edge_issue_street_edge_issue_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.street_edge_issue_street_edge_issue_id_seq OWNER TO sidewalk;

--
-- Name: street_edge_issue_street_edge_issue_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.street_edge_issue_street_edge_issue_id_seq OWNED BY sidewalk.street_edge_issue.street_edge_issue_id;


--
-- Name: street_edge_parent_edge_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.street_edge_parent_edge_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.street_edge_parent_edge_seq OWNER TO sidewalk;

--
-- Name: street_edge_parent_edge; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.street_edge_parent_edge (
    street_edge_id bigint NOT NULL,
    parent_edge_id bigint NOT NULL,
    street_edge_parent_edge_id integer DEFAULT nextval('sidewalk.street_edge_parent_edge_seq'::regclass) NOT NULL
);


ALTER TABLE sidewalk.street_edge_parent_edge OWNER TO sidewalk;

--
-- Name: street_edge_parent_edge_street_edge_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.street_edge_parent_edge_street_edge_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.street_edge_parent_edge_street_edge_id_seq OWNER TO sidewalk;

--
-- Name: street_edge_parent_edge_street_edge_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.street_edge_parent_edge_street_edge_id_seq OWNED BY sidewalk.street_edge_parent_edge.street_edge_id;


--
-- Name: street_edge_region_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.street_edge_region_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.street_edge_region_id_seq OWNER TO sidewalk;

--
-- Name: street_edge_region; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.street_edge_region (
    street_edge_region_id integer DEFAULT nextval('sidewalk.street_edge_region_id_seq'::regclass) NOT NULL,
    street_edge_id integer NOT NULL,
    region_id integer NOT NULL
);


ALTER TABLE sidewalk.street_edge_region OWNER TO sidewalk;

--
-- Name: street_edge_street_edge_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.street_edge_street_edge_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.street_edge_street_edge_id_seq OWNER TO sidewalk;

--
-- Name: street_edge_street_edge_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.street_edge_street_edge_id_seq OWNED BY sidewalk.street_edge.street_edge_id;


--
-- Name: street_edge_street_node_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.street_edge_street_node_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.street_edge_street_node_id_seq OWNER TO sidewalk;

--
-- Name: street_edge_street_node; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.street_edge_street_node (
    street_edge_id bigint NOT NULL,
    street_node_id bigint NOT NULL,
    street_edge_street_node_id integer DEFAULT nextval('sidewalk.street_edge_street_node_id_seq'::regclass) NOT NULL
);


ALTER TABLE sidewalk.street_edge_street_node OWNER TO sidewalk;

--
-- Name: street_edge_street_node_street_edge_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.street_edge_street_node_street_edge_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.street_edge_street_node_street_edge_id_seq OWNER TO sidewalk;

--
-- Name: street_edge_street_node_street_edge_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.street_edge_street_node_street_edge_id_seq OWNED BY sidewalk.street_edge_street_node.street_edge_id;


--
-- Name: street_node; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.street_node (
    street_node_id integer NOT NULL,
    geom public.geometry(Point,4326) NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL
);


ALTER TABLE sidewalk.street_node OWNER TO sidewalk;

--
-- Name: street_node_street_node_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.street_node_street_node_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.street_node_street_node_id_seq OWNER TO sidewalk;

--
-- Name: street_node_street_node_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.street_node_street_node_id_seq OWNED BY sidewalk.street_node.street_node_id;


--
-- Name: survey_category_option; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.survey_category_option (
    survey_category_option_id integer NOT NULL,
    survey_category_option_text text NOT NULL
);


ALTER TABLE sidewalk.survey_category_option OWNER TO sidewalk;

--
-- Name: survey_category_option_survey_category_option_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.survey_category_option_survey_category_option_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.survey_category_option_survey_category_option_id_seq OWNER TO sidewalk;

--
-- Name: survey_category_option_survey_category_option_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.survey_category_option_survey_category_option_id_seq OWNED BY sidewalk.survey_category_option.survey_category_option_id;


--
-- Name: survey_option; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.survey_option (
    survey_option_id integer NOT NULL,
    survey_category_option_id integer NOT NULL,
    survey_option_text text NOT NULL,
    survey_display_rank integer
);


ALTER TABLE sidewalk.survey_option OWNER TO sidewalk;

--
-- Name: survey_question; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.survey_question (
    survey_question_id integer NOT NULL,
    survey_question_text text NOT NULL,
    survey_input_type text NOT NULL,
    survey_category_option_id integer,
    survey_display_rank integer,
    deleted boolean DEFAULT false NOT NULL,
    survey_user_role_id integer DEFAULT 1 NOT NULL,
    required boolean DEFAULT false NOT NULL
);


ALTER TABLE sidewalk.survey_question OWNER TO sidewalk;

--
-- Name: survey_question_survey_question_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.survey_question_survey_question_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.survey_question_survey_question_id_seq OWNER TO sidewalk;

--
-- Name: survey_question_survey_question_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.survey_question_survey_question_id_seq OWNED BY sidewalk.survey_question.survey_question_id;


--
-- Name: teaser; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.teaser (
    email character varying(2044) NOT NULL
);


ALTER TABLE sidewalk.teaser OWNER TO sidewalk;

--
-- Name: user; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk."user" (
    user_id text NOT NULL,
    username text NOT NULL,
    email text NOT NULL
);


ALTER TABLE sidewalk."user" OWNER TO sidewalk;

INSERT INTO sidewalk."user" (user_id, username, email) VALUES
('97760883-8ef0-4309-9a5e-0c086ef27573', 'anonymous', 'anonymous@cs.umd.edu')
;

--
-- Name: user_current_region; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.user_current_region (
    user_current_region_id integer NOT NULL,
    user_id text,
    region_id integer
);


ALTER TABLE sidewalk.user_current_region OWNER TO sidewalk;

--
-- Name: user_current_region_user_current_region_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.user_current_region_user_current_region_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.user_current_region_user_current_region_id_seq OWNER TO sidewalk;

--
-- Name: user_current_region_user_current_region_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.user_current_region_user_current_region_id_seq OWNED BY sidewalk.user_current_region.user_current_region_id;


--
-- Name: user_login_info_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.user_login_info_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.user_login_info_id_seq OWNER TO sidewalk;

--
-- Name: user_login_info; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.user_login_info (
    user_id character varying(254) NOT NULL,
    login_info_id bigint NOT NULL,
    user_login_info_id integer DEFAULT nextval('sidewalk.user_login_info_id_seq'::regclass) NOT NULL
);


ALTER TABLE sidewalk.user_login_info OWNER TO sidewalk;

--
-- Name: user_password_info_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.user_password_info_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.user_password_info_id_seq OWNER TO sidewalk;

--
-- Name: user_password_info; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.user_password_info (
    hasher character varying(254) NOT NULL,
    password character varying(254) NOT NULL,
    salt character varying(254),
    login_info_id bigint NOT NULL,
    user_password_info_id integer DEFAULT nextval('sidewalk.user_password_info_id_seq'::regclass) NOT NULL
);


ALTER TABLE sidewalk.user_password_info OWNER TO sidewalk;

--
-- Name: user_role; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.user_role (
    user_role_id integer NOT NULL,
    user_id text NOT NULL,
    role_id integer NOT NULL
);


ALTER TABLE sidewalk.user_role OWNER TO sidewalk;

--
-- Name: user_role_user_role_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.user_role_user_role_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.user_role_user_role_id_seq OWNER TO sidewalk;

--
-- Name: user_role_user_role_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.user_role_user_role_id_seq OWNED BY sidewalk.user_role.user_role_id;


--
-- Name: user_survey_option_submission; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.user_survey_option_submission (
    user_survey_option_submission_id integer NOT NULL,
    user_id text NOT NULL,
    survey_question_id integer NOT NULL,
    survey_option_id integer,
    time_submitted timestamp without time zone,
    num_missions_completed integer
);


ALTER TABLE sidewalk.user_survey_option_submission OWNER TO sidewalk;

--
-- Name: user_survey_option_submission_user_survey_option_submission_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.user_survey_option_submission_user_survey_option_submission_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.user_survey_option_submission_user_survey_option_submission_seq OWNER TO sidewalk;

--
-- Name: user_survey_option_submission_user_survey_option_submission_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.user_survey_option_submission_user_survey_option_submission_seq OWNED BY sidewalk.user_survey_option_submission.user_survey_option_submission_id;


--
-- Name: user_survey_text_submission; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.user_survey_text_submission (
    user_survey_text_submission_id integer NOT NULL,
    user_id text NOT NULL,
    survey_question_id integer NOT NULL,
    survey_text_submission text,
    time_submitted timestamp without time zone,
    num_missions_completed integer
);


ALTER TABLE sidewalk.user_survey_text_submission OWNER TO sidewalk;

--
-- Name: user_survey_text_submission_user_survey_text_submission_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.user_survey_text_submission_user_survey_text_submission_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.user_survey_text_submission_user_survey_text_submission_id_seq OWNER TO sidewalk;

--
-- Name: user_survey_text_submission_user_survey_text_submission_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.user_survey_text_submission_user_survey_text_submission_id_seq OWNED BY sidewalk.user_survey_text_submission.user_survey_text_submission_id;


--
-- Name: webpage_activity; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.webpage_activity (
    webpage_activity_id integer NOT NULL,
    user_id text NOT NULL,
    activity text NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    ip_address text NOT NULL
);


ALTER TABLE sidewalk.webpage_activity OWNER TO sidewalk;

--
-- Name: webpage_activity_webpage_activity_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.webpage_activity_webpage_activity_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.webpage_activity_webpage_activity_id_seq OWNER TO sidewalk;

--
-- Name: webpage_activity_webpage_activity_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.webpage_activity_webpage_activity_id_seq OWNED BY sidewalk.webpage_activity.webpage_activity_id;


--
-- Name: amt_assignment_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.amt_assignment ALTER COLUMN amt_assignment_id SET DEFAULT nextval('sidewalk.amt_assignment_amt_assignment_id_seq'::regclass);


--
-- Name: audit_task_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.audit_task ALTER COLUMN audit_task_id SET DEFAULT nextval('sidewalk.audit_task_audit_task_id_seq'::regclass);


--
-- Name: audit_task_comment_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.audit_task_comment ALTER COLUMN audit_task_comment_id SET DEFAULT nextval('sidewalk.audit_task_comment_audit_task_comment_id_seq'::regclass);


--
-- Name: audit_task_environment_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.audit_task_environment ALTER COLUMN audit_task_environment_id SET DEFAULT nextval('sidewalk.audit_task_environment_audit_task_environment_id_seq'::regclass);


--
-- Name: audit_task_interaction_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.audit_task_interaction ALTER COLUMN audit_task_interaction_id SET DEFAULT nextval('sidewalk.audit_task_interaction_id_seq'::regclass);


--
-- Name: label_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label ALTER COLUMN label_id SET DEFAULT nextval('sidewalk.label_label_id_seq'::regclass);


--
-- Name: label_point_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label_point ALTER COLUMN label_point_id SET DEFAULT nextval('sidewalk.label_point_label_point_id_seq'::regclass);


--
-- Name: label_type_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label_type ALTER COLUMN label_type_id SET DEFAULT nextval('sidewalk.label_type_label_type_id_seq'::regclass);


--
-- Name: login_info_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.login_info ALTER COLUMN login_info_id SET DEFAULT nextval('sidewalk.logininfo_id_seq'::regclass);


--
-- Name: mission_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.mission ALTER COLUMN mission_id SET DEFAULT nextval('sidewalk.mission_mission_id_seq'::regclass);


--
-- Name: mission_user_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.mission_user ALTER COLUMN mission_user_id SET DEFAULT nextval('sidewalk.mission_user_mission_user_id_seq'::regclass);


--
-- Name: problem_description_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.problem_description ALTER COLUMN problem_description_id SET DEFAULT nextval('sidewalk.problem_description_problem_description_id_seq'::regclass);


--
-- Name: problem_severity_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.problem_severity ALTER COLUMN problem_severity_id SET DEFAULT nextval('sidewalk.problem_severity_problem_severity_id_seq'::regclass);


--
-- Name: problem_temporariness_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.problem_temporariness ALTER COLUMN problem_temporariness_id SET DEFAULT nextval('sidewalk.problem_temporariness_problem_temporariness_id_seq'::regclass);


--
-- Name: region_property_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.region_property ALTER COLUMN region_property_id SET DEFAULT nextval('sidewalk.region_property_region_property_id_seq'::regclass);


--
-- Name: role_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.role ALTER COLUMN role_id SET DEFAULT nextval('sidewalk.role_role_id_seq'::regclass);


--
-- Name: sidewalk_edge_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.sidewalk_edge ALTER COLUMN sidewalk_edge_id SET DEFAULT nextval('sidewalk.sidewalk_edges_sidewalk_edge_id_seq'::regclass);


--
-- Name: sidewalk_edge_accessibility_feature_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.sidewalk_edge_accessibility_feature ALTER COLUMN sidewalk_edge_accessibility_feature_id SET DEFAULT nextval('sidewalk.sidewalk_edge_accessibility_f_sidewalk_edge_accessibility_f_seq'::regclass);


--
-- Name: id_0; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.sidewalk_node ALTER COLUMN id_0 SET DEFAULT nextval('sidewalk.sidewalk_nodes_id_0_seq'::regclass);


--
-- Name: street_edge_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.street_edge ALTER COLUMN street_edge_id SET DEFAULT nextval('sidewalk.street_edge_street_edge_id_seq'::regclass);


--
-- Name: street_edge_assignment_count_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.street_edge_assignment_count ALTER COLUMN street_edge_assignment_count_id SET DEFAULT nextval('sidewalk.street_edge_assignment_count_street_edge_assignment_count_i_seq'::regclass);


--
-- Name: street_edge_issue_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.street_edge_issue ALTER COLUMN street_edge_issue_id SET DEFAULT nextval('sidewalk.street_edge_issue_street_edge_issue_id_seq'::regclass);


--
-- Name: street_node_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.street_node ALTER COLUMN street_node_id SET DEFAULT nextval('sidewalk.street_node_street_node_id_seq'::regclass);


--
-- Name: survey_category_option_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.survey_category_option ALTER COLUMN survey_category_option_id SET DEFAULT nextval('sidewalk.survey_category_option_survey_category_option_id_seq'::regclass);


--
-- Name: survey_question_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.survey_question ALTER COLUMN survey_question_id SET DEFAULT nextval('sidewalk.survey_question_survey_question_id_seq'::regclass);


--
-- Name: user_current_region_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_current_region ALTER COLUMN user_current_region_id SET DEFAULT nextval('sidewalk.user_current_region_user_current_region_id_seq'::regclass);


--
-- Name: user_role_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_role ALTER COLUMN user_role_id SET DEFAULT nextval('sidewalk.user_role_user_role_id_seq'::regclass);


--
-- Name: user_survey_option_submission_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_survey_option_submission ALTER COLUMN user_survey_option_submission_id SET DEFAULT nextval('sidewalk.user_survey_option_submission_user_survey_option_submission_seq'::regclass);


--
-- Name: user_survey_text_submission_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_survey_text_submission ALTER COLUMN user_survey_text_submission_id SET DEFAULT nextval('sidewalk.user_survey_text_submission_user_survey_text_submission_id_seq'::regclass);


--
-- Name: webpage_activity_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.webpage_activity ALTER COLUMN webpage_activity_id SET DEFAULT nextval('sidewalk.webpage_activity_webpage_activity_id_seq'::regclass);


--
-- Name: accessibility_features_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.accessibility_feature
    ADD CONSTRAINT accessibility_features_pkey PRIMARY KEY (accessibility_feature_id);


--
-- Name: amt_assignment_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.amt_assignment
    ADD CONSTRAINT amt_assignment_pkey PRIMARY KEY (amt_assignment_id);


--
-- Name: audit_task_comment_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.audit_task_comment
    ADD CONSTRAINT audit_task_comment_pkey PRIMARY KEY (audit_task_comment_id);


--
-- Name: audit_task_environment_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.audit_task_environment
    ADD CONSTRAINT audit_task_environment_pkey PRIMARY KEY (audit_task_environment_id);


--
-- Name: audit_task_incomplete_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.audit_task_incomplete
    ADD CONSTRAINT audit_task_incomplete_pkey PRIMARY KEY (audit_task_incomplete_id);


--
-- Name: audit_task_interaction_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.audit_task_interaction
    ADD CONSTRAINT audit_task_interaction_pkey PRIMARY KEY (audit_task_interaction_id);


--
-- Name: audit_task_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.audit_task
    ADD CONSTRAINT audit_task_pkey PRIMARY KEY (audit_task_id);


--
-- Name: gsv_link_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.gsv_link
    ADD CONSTRAINT gsv_link_pkey PRIMARY KEY (gsv_panorama_id, target_panorama_id);


--
-- Name: gsv_location_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.gsv_location
    ADD CONSTRAINT gsv_location_pkey PRIMARY KEY (gsv_panorama_id);


--
-- Name: gsv_model_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.gsv_model
    ADD CONSTRAINT gsv_model_pkey PRIMARY KEY (gsv_panorama_id);


--
-- Name: gsv_onboarding_pano_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.gsv_onboarding_pano
    ADD CONSTRAINT gsv_onboarding_pano_pkey PRIMARY KEY (gsv_panorama_id);


--
-- Name: gsv_panorama_data_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.gsv_data
    ADD CONSTRAINT gsv_panorama_data_pkey PRIMARY KEY (gsv_panorama_id);


--
-- Name: gsv_panorama_projection_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.gsv_projection
    ADD CONSTRAINT gsv_panorama_projection_pkey PRIMARY KEY (gsv_panorama_id);


--
-- Name: label_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.label
    ADD CONSTRAINT label_pkey PRIMARY KEY (label_id);


--
-- Name: label_point_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.label_point
    ADD CONSTRAINT label_point_pkey PRIMARY KEY (label_point_id);


--
-- Name: label_type_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.label_type
    ADD CONSTRAINT label_type_pkey PRIMARY KEY (label_type_id);


--
-- Name: logininfo_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.login_info
    ADD CONSTRAINT logininfo_pkey PRIMARY KEY (login_info_id);


--
-- Name: mission_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.mission
    ADD CONSTRAINT mission_pkey PRIMARY KEY (mission_id);


--
-- Name: mission_user_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.mission_user
    ADD CONSTRAINT mission_user_pkey PRIMARY KEY (mission_user_id);


--
-- Name: play_evolutions_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.play_evolutions
    ADD CONSTRAINT play_evolutions_pkey PRIMARY KEY (id);


--
-- Name: problem_description_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.problem_description
    ADD CONSTRAINT problem_description_pkey PRIMARY KEY (problem_description_id);


--
-- Name: problem_severity_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.problem_severity
    ADD CONSTRAINT problem_severity_pkey PRIMARY KEY (problem_severity_id);


--
-- Name: problem_temporariness_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.problem_temporariness
    ADD CONSTRAINT problem_temporariness_pkey PRIMARY KEY (problem_temporariness_id);


--
-- Name: region_completion_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.region_completion
    ADD CONSTRAINT region_completion_pkey PRIMARY KEY (region_id);


--
-- Name: region_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.region
    ADD CONSTRAINT region_pkey PRIMARY KEY (region_id);


--
-- Name: region_property_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.region_property
    ADD CONSTRAINT region_property_pkey PRIMARY KEY (region_property_id);


--
-- Name: region_type_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.region_type
    ADD CONSTRAINT region_type_pkey PRIMARY KEY (region_type_id);


--
-- Name: role_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.role
    ADD CONSTRAINT role_pkey PRIMARY KEY (role_id);


--
-- Name: sidewalk_edge_accessibility_feature_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.sidewalk_edge_accessibility_feature
    ADD CONSTRAINT sidewalk_edge_accessibility_feature_pkey PRIMARY KEY (sidewalk_edge_accessibility_feature_id);


--
-- Name: sidewalk_edges_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.sidewalk_edge
    ADD CONSTRAINT sidewalk_edges_pkey PRIMARY KEY (sidewalk_edge_id);


--
-- Name: sidewalk_nodes_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.sidewalk_node
    ADD CONSTRAINT sidewalk_nodes_pkey PRIMARY KEY (id_0);


--
-- Name: street_edge_assignment_count_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.street_edge_assignment_count
    ADD CONSTRAINT street_edge_assignment_count_pkey PRIMARY KEY (street_edge_assignment_count_id);


--
-- Name: street_edge_issue_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.street_edge_issue
    ADD CONSTRAINT street_edge_issue_pkey PRIMARY KEY (street_edge_issue_id);


--
-- Name: street_edge_parent_edge_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.street_edge_parent_edge
    ADD CONSTRAINT street_edge_parent_edge_pkey PRIMARY KEY (street_edge_parent_edge_id);


--
-- Name: street_edge_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.street_edge
    ADD CONSTRAINT street_edge_pkey PRIMARY KEY (street_edge_id);


--
-- Name: street_edge_region_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.street_edge_region
    ADD CONSTRAINT street_edge_region_pkey PRIMARY KEY (street_edge_region_id);


--
-- Name: street_edge_street_node_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.street_edge_street_node
    ADD CONSTRAINT street_edge_street_node_pkey PRIMARY KEY (street_edge_street_node_id);


--
-- Name: street_node_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.street_node
    ADD CONSTRAINT street_node_pkey PRIMARY KEY (street_node_id);


--
-- Name: survey_category_option_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.survey_category_option
    ADD CONSTRAINT survey_category_option_pkey PRIMARY KEY (survey_category_option_id);


--
-- Name: survey_option_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.survey_option
    ADD CONSTRAINT survey_option_pkey PRIMARY KEY (survey_option_id);


--
-- Name: survey_question_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.survey_question
    ADD CONSTRAINT survey_question_pkey PRIMARY KEY (survey_question_id);


--
-- Name: unique_email; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.teaser
    ADD CONSTRAINT unique_email UNIQUE (email);


--
-- Name: user_current_region_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.user_current_region
    ADD CONSTRAINT user_current_region_pkey PRIMARY KEY (user_current_region_id);


--
-- Name: user_login_info_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.user_login_info
    ADD CONSTRAINT user_login_info_pkey PRIMARY KEY (user_login_info_id);


--
-- Name: user_password_info_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.user_password_info
    ADD CONSTRAINT user_password_info_pkey PRIMARY KEY (user_password_info_id);


--
-- Name: user_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (user_id);


--
-- Name: user_role_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.user_role
    ADD CONSTRAINT user_role_pkey PRIMARY KEY (user_role_id);


--
-- Name: user_survey_option_submission_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.user_survey_option_submission
    ADD CONSTRAINT user_survey_option_submission_pkey PRIMARY KEY (user_survey_option_submission_id);


--
-- Name: user_survey_text_submission_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.user_survey_text_submission
    ADD CONSTRAINT user_survey_text_submission_pkey PRIMARY KEY (user_survey_text_submission_id);


--
-- Name: user_username_key; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk."user"
    ADD CONSTRAINT user_username_key UNIQUE (username);


--
-- Name: webpage_activity_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.webpage_activity
    ADD CONSTRAINT webpage_activity_pkey PRIMARY KEY (webpage_activity_id);


--
-- Name: amt_assignment_assignment_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX amt_assignment_assignment_id_idx ON sidewalk.amt_assignment USING btree (assignment_id);


--
-- Name: amt_assignment_hit_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX amt_assignment_hit_id_idx ON sidewalk.amt_assignment USING btree (hit_id);


--
-- Name: audit_task_amt_assignment_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX audit_task_amt_assignment_id_idx ON sidewalk.audit_task USING btree (amt_assignment_id);


--
-- Name: audit_task_comment_edge_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX audit_task_comment_edge_id_idx ON sidewalk.audit_task_comment USING btree (edge_id);


--
-- Name: audit_task_comment_gsv_panorama_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX audit_task_comment_gsv_panorama_id_idx ON sidewalk.audit_task_comment USING btree (gsv_panorama_id);


--
-- Name: audit_task_incomplete_audit_task_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX audit_task_incomplete_audit_task_id_idx ON sidewalk.audit_task_incomplete USING btree (audit_task_id);


--
-- Name: audit_task_interaction_audit_task_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX audit_task_interaction_audit_task_id_idx ON sidewalk.audit_task_interaction USING btree (audit_task_id);


--
-- Name: audit_task_street_edge_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX audit_task_street_edge_id_idx ON sidewalk.audit_task USING btree (street_edge_id);


--
-- Name: gsv_link_gsv_panorama_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX gsv_link_gsv_panorama_id_idx ON sidewalk.gsv_link USING btree (gsv_panorama_id);


--
-- Name: gsv_link_target_panorama_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX gsv_link_target_panorama_id_idx ON sidewalk.gsv_link USING btree (target_panorama_id);


--
-- Name: index_audit_task_incomplete_id; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX index_audit_task_incomplete_id ON sidewalk.audit_task_incomplete USING btree (audit_task_incomplete_id);


--
-- Name: label_audit_task_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX label_audit_task_id_idx ON sidewalk.label USING btree (audit_task_id);


--
-- Name: label_label_type_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX label_label_type_id_idx ON sidewalk.label USING btree (label_type_id);


--
-- Name: label_point_label_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX label_point_label_id_idx ON sidewalk.label_point USING btree (label_id);


--
-- Name: mission_region_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX mission_region_id_idx ON sidewalk.mission USING btree (region_id);


--
-- Name: mission_user_mission_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX mission_user_mission_id_idx ON sidewalk.mission_user USING btree (mission_id);


--
-- Name: mission_user_user_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX mission_user_user_id_idx ON sidewalk.mission_user USING btree (user_id);


--
-- Name: region_property_region_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX region_property_region_id_idx ON sidewalk.region_property USING btree (region_id);


--
-- Name: region_region_type_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX region_region_type_id_idx ON sidewalk.region USING btree (region_type_id);


--
-- Name: sidewalk_edge_accessibility_feature_sidewalk_edge_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX sidewalk_edge_accessibility_feature_sidewalk_edge_id_idx ON sidewalk.sidewalk_edge_accessibility_feature USING btree (sidewalk_edge_id);


--
-- Name: sidewalk_edge_parent_edge_parent_edge_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX sidewalk_edge_parent_edge_parent_edge_id_idx ON sidewalk.sidewalk_edge_parent_edge USING btree (parent_edge_id);


--
-- Name: sidewalk_edge_parent_edge_sidewalk_edge_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX sidewalk_edge_parent_edge_sidewalk_edge_id_idx ON sidewalk.sidewalk_edge_parent_edge USING btree (sidewalk_edge_id);


--
-- Name: sidewalk_edge_sidewalk_node_sidewalk_edge_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX sidewalk_edge_sidewalk_node_sidewalk_edge_id_idx ON sidewalk.sidewalk_edge_sidewalk_node USING btree (sidewalk_edge_id);


--
-- Name: sidewalk_edge_sidewalk_node_sidewalk_node_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX sidewalk_edge_sidewalk_node_sidewalk_node_id_idx ON sidewalk.sidewalk_edge_sidewalk_node USING btree (sidewalk_node_id);


--
-- Name: sidewalk_edges_geom_gidx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX sidewalk_edges_geom_gidx ON sidewalk.sidewalk_edge USING gist (geom);


--
-- Name: sidewalk_edges_source_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX sidewalk_edges_source_idx ON sidewalk.sidewalk_edge USING btree (source);


--
-- Name: sidewalk_edges_target_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX sidewalk_edges_target_idx ON sidewalk.sidewalk_edge USING btree (target);


--
-- Name: sidewalk_node_sidewalk_node_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX sidewalk_node_sidewalk_node_id_idx ON sidewalk.sidewalk_node USING btree (sidewalk_node_id);


--
-- Name: sidx_accessibility_features_geom; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX sidx_accessibility_features_geom ON sidewalk.accessibility_feature USING gist (geom);


--
-- Name: street_edge_assignment_count_street_edge_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX street_edge_assignment_count_street_edge_id_idx ON sidewalk.street_edge_assignment_count USING btree (street_edge_id);


--
-- Name: street_edge_issue_street_edge_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX street_edge_issue_street_edge_id_idx ON sidewalk.street_edge_issue USING btree (street_edge_id);


--
-- Name: street_edge_parent_edge_parent_edge_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX street_edge_parent_edge_parent_edge_id_idx ON sidewalk.street_edge_parent_edge USING btree (parent_edge_id);


--
-- Name: street_edge_parent_edge_street_edge_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX street_edge_parent_edge_street_edge_id_idx ON sidewalk.street_edge_parent_edge USING btree (street_edge_id);


--
-- Name: street_edge_region_region_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX street_edge_region_region_id_idx ON sidewalk.street_edge_region USING btree (region_id);


--
-- Name: street_edge_region_street_edge_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX street_edge_region_street_edge_id_idx ON sidewalk.street_edge_region USING btree (street_edge_id);


--
-- Name: street_edge_source_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX street_edge_source_idx ON sidewalk.street_edge USING btree (source);


--
-- Name: street_edge_street_node_street_edge_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX street_edge_street_node_street_edge_id_idx ON sidewalk.street_edge_street_node USING btree (street_edge_id);


--
-- Name: street_edge_street_node_street_node_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX street_edge_street_node_street_node_id_idx ON sidewalk.street_edge_street_node USING btree (street_node_id);


--
-- Name: street_edge_target_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX street_edge_target_idx ON sidewalk.street_edge USING btree (target);


--
-- Name: user_current_region_region_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX user_current_region_region_id_idx ON sidewalk.user_current_region USING btree (region_id);


--
-- Name: user_current_region_user_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX user_current_region_user_id_idx ON sidewalk.user_current_region USING btree (user_id);


--
-- Name: user_email_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX user_email_idx ON sidewalk."user" USING btree (email);


--
-- Name: user_login_info_login_info_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX user_login_info_login_info_id_idx ON sidewalk.user_login_info USING btree (login_info_id);


--
-- Name: user_login_info_user_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX user_login_info_user_id_idx ON sidewalk.user_login_info USING btree (user_id);


--
-- Name: user_role_role_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX user_role_role_id_idx ON sidewalk.user_role USING btree (role_id);


--
-- Name: user_role_user_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX user_role_user_id_idx ON sidewalk.user_role USING btree (user_id);


--
-- Name: way_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX way_id_idx ON sidewalk.sidewalk_edge USING btree (sidewalk_edge_id);


--
-- Name: webpage_activity_user_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX webpage_activity_user_id_idx ON sidewalk.webpage_activity USING btree (user_id);


--
-- Name: accessibility_feature_label_type_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.accessibility_feature
    ADD CONSTRAINT accessibility_feature_label_type_id_fkey FOREIGN KEY (label_type_id) REFERENCES sidewalk.label_type(label_type_id);


--
-- Name: audit_task_environment_audit_task_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.audit_task_environment
    ADD CONSTRAINT audit_task_environment_audit_task_id_fkey FOREIGN KEY (audit_task_id) REFERENCES sidewalk.audit_task(audit_task_id);


--
-- Name: audit_task_interaction_audit_task_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.audit_task_interaction
    ADD CONSTRAINT audit_task_interaction_audit_task_id_fkey FOREIGN KEY (audit_task_id) REFERENCES sidewalk.audit_task(audit_task_id);


--
-- Name: audit_task_street_edge_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.audit_task
    ADD CONSTRAINT audit_task_street_edge_id_fkey FOREIGN KEY (street_edge_id) REFERENCES sidewalk.street_edge(street_edge_id);


--
-- Name: audit_task_user_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.audit_task
    ADD CONSTRAINT audit_task_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk."user"(user_id);


--
-- Name: label_audit_task_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label
    ADD CONSTRAINT label_audit_task_id_fkey FOREIGN KEY (audit_task_id) REFERENCES sidewalk.audit_task(audit_task_id);


--
-- Name: label_label_type_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label
    ADD CONSTRAINT label_label_type_id_fkey FOREIGN KEY (label_type_id) REFERENCES sidewalk.label_type(label_type_id);


--
-- Name: sidewalk_edge_accessibility_feature_accessibility_feature_id_fk; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.sidewalk_edge_accessibility_feature
    ADD CONSTRAINT sidewalk_edge_accessibility_feature_accessibility_feature_id_fk FOREIGN KEY (accessibility_feature_id) REFERENCES sidewalk.accessibility_feature(accessibility_feature_id);


--
-- Name: sidewalk_edge_accessibility_feature_sidewalk_edge_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.sidewalk_edge_accessibility_feature
    ADD CONSTRAINT sidewalk_edge_accessibility_feature_sidewalk_edge_id_fkey FOREIGN KEY (sidewalk_edge_id) REFERENCES sidewalk.sidewalk_edge(sidewalk_edge_id);


--
-- Name: street_edge_assignment_count_street_edge_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.street_edge_assignment_count
    ADD CONSTRAINT street_edge_assignment_count_street_edge_id_fkey FOREIGN KEY (street_edge_id) REFERENCES sidewalk.street_edge(street_edge_id);


--
-- Name: street_edge_parent_edge_street_edge_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.street_edge_parent_edge
    ADD CONSTRAINT street_edge_parent_edge_street_edge_id_fkey FOREIGN KEY (street_edge_id) REFERENCES sidewalk.street_edge(street_edge_id);


--
-- Name: street_edge_street_node_street_edge_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.street_edge_street_node
    ADD CONSTRAINT street_edge_street_node_street_edge_id_fkey FOREIGN KEY (street_edge_id) REFERENCES sidewalk.street_edge(street_edge_id);


--
-- Name: street_edge_street_node_street_node_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.street_edge_street_node
    ADD CONSTRAINT street_edge_street_node_street_node_id_fkey FOREIGN KEY (street_node_id) REFERENCES sidewalk.street_node(street_node_id);


--
-- Name: survey_option_survey_category_option_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.survey_option
    ADD CONSTRAINT survey_option_survey_category_option_id_fkey FOREIGN KEY (survey_category_option_id) REFERENCES sidewalk.survey_category_option(survey_category_option_id);


--
-- Name: survey_question_survey_category_option_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.survey_question
    ADD CONSTRAINT survey_question_survey_category_option_id_fkey FOREIGN KEY (survey_category_option_id) REFERENCES sidewalk.survey_category_option(survey_category_option_id);


--
-- Name: user_survey_option_submission_survey_question_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_survey_option_submission
    ADD CONSTRAINT user_survey_option_submission_survey_question_id_fkey FOREIGN KEY (survey_question_id) REFERENCES sidewalk.survey_question(survey_question_id);


--
-- Name: user_survey_option_submission_user_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_survey_option_submission
    ADD CONSTRAINT user_survey_option_submission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk."user"(user_id);


--
-- Name: user_survey_text_submission_survey_question_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_survey_text_submission
    ADD CONSTRAINT user_survey_text_submission_survey_question_id_fkey FOREIGN KEY (survey_question_id) REFERENCES sidewalk.survey_question(survey_question_id);


--
-- Name: user_survey_text_submission_user_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_survey_text_submission
    ADD CONSTRAINT user_survey_text_submission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk."user"(user_id);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM postgres;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO PUBLIC;


--
-- Name: SCHEMA sidewalk; Type: ACL; Schema: -; Owner: sidewalk
--

REVOKE ALL ON SCHEMA sidewalk FROM PUBLIC;
REVOKE ALL ON SCHEMA sidewalk FROM sidewalk;
GRANT ALL ON SCHEMA sidewalk TO sidewalk;
GRANT ALL ON SCHEMA sidewalk TO postgres;


--
-- Name: TABLE accessibility_feature; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.accessibility_feature FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.accessibility_feature FROM sidewalk;
GRANT ALL ON TABLE sidewalk.accessibility_feature TO sidewalk;
GRANT ALL ON TABLE sidewalk.accessibility_feature TO postgres;


--
-- Name: TABLE amt_assignment; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.amt_assignment FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.amt_assignment FROM sidewalk;
GRANT ALL ON TABLE sidewalk.amt_assignment TO sidewalk;
GRANT ALL ON TABLE sidewalk.amt_assignment TO postgres;


--
-- Name: SEQUENCE amt_assignment_amt_assignment_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.amt_assignment_amt_assignment_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.amt_assignment_amt_assignment_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.amt_assignment_amt_assignment_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.amt_assignment_amt_assignment_id_seq TO postgres;


--
-- Name: TABLE audit_task; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.audit_task FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.audit_task FROM sidewalk;
GRANT ALL ON TABLE sidewalk.audit_task TO sidewalk;
GRANT ALL ON TABLE sidewalk.audit_task TO postgres;


--
-- Name: SEQUENCE audit_task_audit_task_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.audit_task_audit_task_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.audit_task_audit_task_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.audit_task_audit_task_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.audit_task_audit_task_id_seq TO postgres;


--
-- Name: TABLE audit_task_comment; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.audit_task_comment FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.audit_task_comment FROM sidewalk;
GRANT ALL ON TABLE sidewalk.audit_task_comment TO sidewalk;


--
-- Name: SEQUENCE audit_task_comment_audit_task_comment_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.audit_task_comment_audit_task_comment_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.audit_task_comment_audit_task_comment_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.audit_task_comment_audit_task_comment_id_seq TO sidewalk;


--
-- Name: TABLE audit_task_environment; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.audit_task_environment FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.audit_task_environment FROM sidewalk;
GRANT ALL ON TABLE sidewalk.audit_task_environment TO sidewalk;
GRANT ALL ON TABLE sidewalk.audit_task_environment TO postgres;


--
-- Name: SEQUENCE audit_task_environment_audit_task_environment_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.audit_task_environment_audit_task_environment_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.audit_task_environment_audit_task_environment_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.audit_task_environment_audit_task_environment_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.audit_task_environment_audit_task_environment_id_seq TO postgres;


--
-- Name: SEQUENCE audit_task_incomplete_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.audit_task_incomplete_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.audit_task_incomplete_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.audit_task_incomplete_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.audit_task_incomplete_id_seq TO postgres;


--
-- Name: TABLE audit_task_incomplete; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.audit_task_incomplete FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.audit_task_incomplete FROM sidewalk;
GRANT ALL ON TABLE sidewalk.audit_task_incomplete TO sidewalk;
GRANT ALL ON TABLE sidewalk.audit_task_incomplete TO postgres;


--
-- Name: TABLE audit_task_interaction; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.audit_task_interaction FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.audit_task_interaction FROM sidewalk;
GRANT ALL ON TABLE sidewalk.audit_task_interaction TO sidewalk;
GRANT ALL ON TABLE sidewalk.audit_task_interaction TO postgres;


--
-- Name: SEQUENCE audit_task_interaction_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.audit_task_interaction_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.audit_task_interaction_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.audit_task_interaction_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.audit_task_interaction_id_seq TO postgres;


--
-- Name: TABLE gsv_data; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.gsv_data FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.gsv_data FROM sidewalk;
GRANT ALL ON TABLE sidewalk.gsv_data TO sidewalk;
GRANT ALL ON TABLE sidewalk.gsv_data TO postgres;


--
-- Name: TABLE gsv_link; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.gsv_link FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.gsv_link FROM sidewalk;
GRANT ALL ON TABLE sidewalk.gsv_link TO sidewalk;
GRANT ALL ON TABLE sidewalk.gsv_link TO postgres;


--
-- Name: SEQUENCE gsv_link_gsv_link_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.gsv_link_gsv_link_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.gsv_link_gsv_link_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.gsv_link_gsv_link_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.gsv_link_gsv_link_id_seq TO postgres;


--
-- Name: TABLE gsv_location; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.gsv_location FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.gsv_location FROM sidewalk;
GRANT ALL ON TABLE sidewalk.gsv_location TO sidewalk;
GRANT ALL ON TABLE sidewalk.gsv_location TO postgres;


--
-- Name: TABLE gsv_model; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.gsv_model FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.gsv_model FROM sidewalk;
GRANT ALL ON TABLE sidewalk.gsv_model TO sidewalk;
GRANT ALL ON TABLE sidewalk.gsv_model TO postgres;


--
-- Name: TABLE gsv_projection; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.gsv_projection FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.gsv_projection FROM sidewalk;
GRANT ALL ON TABLE sidewalk.gsv_projection TO sidewalk;
GRANT ALL ON TABLE sidewalk.gsv_projection TO postgres;


--
-- Name: TABLE label; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.label FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.label FROM sidewalk;
GRANT ALL ON TABLE sidewalk.label TO sidewalk;
GRANT ALL ON TABLE sidewalk.label TO postgres;


--
-- Name: SEQUENCE label_label_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.label_label_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.label_label_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.label_label_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.label_label_id_seq TO postgres;


--
-- Name: TABLE label_point; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.label_point FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.label_point FROM sidewalk;
GRANT ALL ON TABLE sidewalk.label_point TO sidewalk;
GRANT ALL ON TABLE sidewalk.label_point TO postgres;


--
-- Name: SEQUENCE label_point_label_point_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.label_point_label_point_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.label_point_label_point_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.label_point_label_point_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.label_point_label_point_id_seq TO postgres;


--
-- Name: TABLE label_type; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.label_type FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.label_type FROM sidewalk;
GRANT ALL ON TABLE sidewalk.label_type TO sidewalk;
GRANT ALL ON TABLE sidewalk.label_type TO postgres;


--
-- Name: SEQUENCE label_type_label_type_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.label_type_label_type_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.label_type_label_type_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.label_type_label_type_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.label_type_label_type_id_seq TO postgres;


--
-- Name: TABLE login_info; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.login_info FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.login_info FROM sidewalk;
GRANT ALL ON TABLE sidewalk.login_info TO sidewalk;
GRANT ALL ON TABLE sidewalk.login_info TO postgres;


--
-- Name: SEQUENCE logininfo_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.logininfo_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.logininfo_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.logininfo_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.logininfo_id_seq TO postgres;


--
-- Name: TABLE problem_description; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.problem_description FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.problem_description FROM sidewalk;
GRANT ALL ON TABLE sidewalk.problem_description TO sidewalk;


--
-- Name: SEQUENCE problem_description_problem_description_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.problem_description_problem_description_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.problem_description_problem_description_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.problem_description_problem_description_id_seq TO sidewalk;


--
-- Name: TABLE problem_severity; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.problem_severity FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.problem_severity FROM sidewalk;
GRANT ALL ON TABLE sidewalk.problem_severity TO sidewalk;


--
-- Name: TABLE problem_temporariness; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.problem_temporariness FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.problem_temporariness FROM sidewalk;
GRANT ALL ON TABLE sidewalk.problem_temporariness TO sidewalk;


--
-- Name: SEQUENCE problem_temporariness_problem_temporariness_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.problem_temporariness_problem_temporariness_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.problem_temporariness_problem_temporariness_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.problem_temporariness_problem_temporariness_id_seq TO sidewalk;


--
-- Name: TABLE region; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.region FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.region FROM sidewalk;
GRANT ALL ON TABLE sidewalk.region TO sidewalk;
GRANT ALL ON TABLE sidewalk.region TO postgres;


--
-- Name: TABLE region_type; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.region_type FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.region_type FROM sidewalk;
GRANT ALL ON TABLE sidewalk.region_type TO sidewalk;
GRANT ALL ON TABLE sidewalk.region_type TO postgres;


--
-- Name: TABLE sidewalk_edge; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.sidewalk_edge FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.sidewalk_edge FROM sidewalk;
GRANT ALL ON TABLE sidewalk.sidewalk_edge TO sidewalk;
GRANT ALL ON TABLE sidewalk.sidewalk_edge TO postgres;


--
-- Name: TABLE sidewalk_edge_accessibility_feature; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.sidewalk_edge_accessibility_feature FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.sidewalk_edge_accessibility_feature FROM sidewalk;
GRANT ALL ON TABLE sidewalk.sidewalk_edge_accessibility_feature TO sidewalk;
GRANT ALL ON TABLE sidewalk.sidewalk_edge_accessibility_feature TO postgres;


--
-- Name: SEQUENCE sidewalk_edge_accessibility_f_sidewalk_edge_accessibility_f_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.sidewalk_edge_accessibility_f_sidewalk_edge_accessibility_f_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.sidewalk_edge_accessibility_f_sidewalk_edge_accessibility_f_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.sidewalk_edge_accessibility_f_sidewalk_edge_accessibility_f_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.sidewalk_edge_accessibility_f_sidewalk_edge_accessibility_f_seq TO postgres;


--
-- Name: TABLE sidewalk_edge_parent_edge; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.sidewalk_edge_parent_edge FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.sidewalk_edge_parent_edge FROM sidewalk;
GRANT ALL ON TABLE sidewalk.sidewalk_edge_parent_edge TO sidewalk;
GRANT ALL ON TABLE sidewalk.sidewalk_edge_parent_edge TO postgres;


--
-- Name: TABLE sidewalk_edge_sidewalk_node; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.sidewalk_edge_sidewalk_node FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.sidewalk_edge_sidewalk_node FROM sidewalk;
GRANT ALL ON TABLE sidewalk.sidewalk_edge_sidewalk_node TO sidewalk;
GRANT ALL ON TABLE sidewalk.sidewalk_edge_sidewalk_node TO postgres;


--
-- Name: SEQUENCE sidewalk_edge_sidewalk_node_sidewalk_edge_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.sidewalk_edge_sidewalk_node_sidewalk_edge_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.sidewalk_edge_sidewalk_node_sidewalk_edge_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.sidewalk_edge_sidewalk_node_sidewalk_edge_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.sidewalk_edge_sidewalk_node_sidewalk_edge_id_seq TO postgres;


--
-- Name: SEQUENCE sidewalk_edges_sidewalk_edge_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.sidewalk_edges_sidewalk_edge_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.sidewalk_edges_sidewalk_edge_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.sidewalk_edges_sidewalk_edge_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.sidewalk_edges_sidewalk_edge_id_seq TO postgres;


--
-- Name: TABLE sidewalk_node; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.sidewalk_node FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.sidewalk_node FROM sidewalk;
GRANT ALL ON TABLE sidewalk.sidewalk_node TO sidewalk;
GRANT ALL ON TABLE sidewalk.sidewalk_node TO postgres;


--
-- Name: SEQUENCE sidewalk_nodes_id_0_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.sidewalk_nodes_id_0_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.sidewalk_nodes_id_0_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.sidewalk_nodes_id_0_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.sidewalk_nodes_id_0_seq TO postgres;


--
-- Name: TABLE street_edge; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.street_edge FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.street_edge FROM sidewalk;
GRANT ALL ON TABLE sidewalk.street_edge TO sidewalk;
GRANT ALL ON TABLE sidewalk.street_edge TO postgres;


--
-- Name: TABLE street_edge_assignment_count; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.street_edge_assignment_count FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.street_edge_assignment_count FROM sidewalk;
GRANT ALL ON TABLE sidewalk.street_edge_assignment_count TO sidewalk;
GRANT ALL ON TABLE sidewalk.street_edge_assignment_count TO postgres;


--
-- Name: SEQUENCE street_edge_assignment_count_street_edge_assignment_count_i_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.street_edge_assignment_count_street_edge_assignment_count_i_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.street_edge_assignment_count_street_edge_assignment_count_i_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.street_edge_assignment_count_street_edge_assignment_count_i_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.street_edge_assignment_count_street_edge_assignment_count_i_seq TO postgres;


--
-- Name: SEQUENCE street_edge_parent_edge_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.street_edge_parent_edge_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.street_edge_parent_edge_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.street_edge_parent_edge_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.street_edge_parent_edge_seq TO postgres;


--
-- Name: TABLE street_edge_parent_edge; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.street_edge_parent_edge FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.street_edge_parent_edge FROM sidewalk;
GRANT ALL ON TABLE sidewalk.street_edge_parent_edge TO sidewalk;
GRANT ALL ON TABLE sidewalk.street_edge_parent_edge TO postgres;


--
-- Name: SEQUENCE street_edge_parent_edge_street_edge_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.street_edge_parent_edge_street_edge_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.street_edge_parent_edge_street_edge_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.street_edge_parent_edge_street_edge_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.street_edge_parent_edge_street_edge_id_seq TO postgres;


--
-- Name: SEQUENCE street_edge_region_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.street_edge_region_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.street_edge_region_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.street_edge_region_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.street_edge_region_id_seq TO postgres;


--
-- Name: TABLE street_edge_region; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.street_edge_region FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.street_edge_region FROM sidewalk;
GRANT ALL ON TABLE sidewalk.street_edge_region TO sidewalk;
GRANT ALL ON TABLE sidewalk.street_edge_region TO postgres;


--
-- Name: SEQUENCE street_edge_street_edge_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.street_edge_street_edge_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.street_edge_street_edge_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.street_edge_street_edge_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.street_edge_street_edge_id_seq TO postgres;


--
-- Name: SEQUENCE street_edge_street_node_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.street_edge_street_node_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.street_edge_street_node_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.street_edge_street_node_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.street_edge_street_node_id_seq TO postgres;


--
-- Name: TABLE street_edge_street_node; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.street_edge_street_node FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.street_edge_street_node FROM sidewalk;
GRANT ALL ON TABLE sidewalk.street_edge_street_node TO sidewalk;
GRANT ALL ON TABLE sidewalk.street_edge_street_node TO postgres;


--
-- Name: SEQUENCE street_edge_street_node_street_edge_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.street_edge_street_node_street_edge_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.street_edge_street_node_street_edge_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.street_edge_street_node_street_edge_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.street_edge_street_node_street_edge_id_seq TO postgres;


--
-- Name: TABLE street_node; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.street_node FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.street_node FROM sidewalk;
GRANT ALL ON TABLE sidewalk.street_node TO sidewalk;
GRANT ALL ON TABLE sidewalk.street_node TO postgres;


--
-- Name: SEQUENCE street_node_street_node_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.street_node_street_node_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.street_node_street_node_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.street_node_street_node_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.street_node_street_node_id_seq TO postgres;


--
-- Name: TABLE "user"; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk."user" FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk."user" FROM sidewalk;
GRANT ALL ON TABLE sidewalk."user" TO sidewalk;
GRANT ALL ON TABLE sidewalk."user" TO postgres;


--
-- Name: SEQUENCE user_login_info_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.user_login_info_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.user_login_info_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.user_login_info_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.user_login_info_id_seq TO postgres;


--
-- Name: TABLE user_login_info; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.user_login_info FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.user_login_info FROM sidewalk;
GRANT ALL ON TABLE sidewalk.user_login_info TO sidewalk;
GRANT ALL ON TABLE sidewalk.user_login_info TO postgres;


--
-- Name: SEQUENCE user_password_info_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.user_password_info_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.user_password_info_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.user_password_info_id_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.user_password_info_id_seq TO postgres;


--
-- Name: TABLE user_password_info; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.user_password_info FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.user_password_info FROM sidewalk;
GRANT ALL ON TABLE sidewalk.user_password_info TO sidewalk;
GRANT ALL ON TABLE sidewalk.user_password_info TO postgres;


--
-- Name: SEQUENCE user_role_user_role_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.user_role_user_role_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.user_role_user_role_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.user_role_user_role_id_seq TO sidewalk;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: sidewalk; Owner: sidewalk
--

ALTER DEFAULT PRIVILEGES FOR ROLE sidewalk IN SCHEMA sidewalk REVOKE ALL ON SEQUENCES  FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sidewalk IN SCHEMA sidewalk REVOKE ALL ON SEQUENCES  FROM sidewalk;
ALTER DEFAULT PRIVILEGES FOR ROLE sidewalk IN SCHEMA sidewalk GRANT ALL ON SEQUENCES  TO sidewalk;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: sidewalk; Owner: sidewalk
--

ALTER DEFAULT PRIVILEGES FOR ROLE sidewalk IN SCHEMA sidewalk REVOKE ALL ON TABLES  FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE sidewalk IN SCHEMA sidewalk REVOKE ALL ON TABLES  FROM sidewalk;
ALTER DEFAULT PRIVILEGES FOR ROLE sidewalk IN SCHEMA sidewalk GRANT ALL ON TABLES  TO sidewalk;


--
-- PostgreSQL database dump complete
--
