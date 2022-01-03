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


SET default_tablespace = '';

SET default_with_oids = false;

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
    lng double precision NOT NULL,
    audit_task_id integer NOT NULL,
    mission_id integer NOT NULL
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
    ip_address text,
    mission_id integer NOT NULL
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
    audit_task_id integer NOT NULL,
    mission_id integer NOT NULL
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
    temporary_label_id integer,
    mission_id integer NOT NULL
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
-- Name: global_attribute; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.global_attribute (
    global_attribute_id integer NOT NULL,
    global_clustering_session_id integer NOT NULL,
    clustering_threshold double precision NOT NULL,
    label_type_id integer NOT NULL,
    region_id integer NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    severity integer,
    temporary boolean NOT NULL
);


ALTER TABLE sidewalk.global_attribute OWNER TO sidewalk;

--
-- Name: global_attribute_global_attribute_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.global_attribute_global_attribute_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.global_attribute_global_attribute_id_seq OWNER TO sidewalk;

--
-- Name: global_attribute_global_attribute_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.global_attribute_global_attribute_id_seq OWNED BY sidewalk.global_attribute.global_attribute_id;


--
-- Name: global_attribute_user_attribute; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.global_attribute_user_attribute (
    global_attribute_user_attribute_id integer NOT NULL,
    global_attribute_id integer NOT NULL,
    user_attribute_id integer NOT NULL
);


ALTER TABLE sidewalk.global_attribute_user_attribute OWNER TO sidewalk;

--
-- Name: global_attribute_user_attribu_global_attribute_user_attribu_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.global_attribute_user_attribu_global_attribute_user_attribu_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.global_attribute_user_attribu_global_attribute_user_attribu_seq OWNER TO sidewalk;

--
-- Name: global_attribute_user_attribu_global_attribute_user_attribu_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.global_attribute_user_attribu_global_attribute_user_attribu_seq OWNED BY sidewalk.global_attribute_user_attribute.global_attribute_user_attribute_id;


--
-- Name: global_clustering_session; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.global_clustering_session (
    global_clustering_session_id integer NOT NULL,
    region_id integer NOT NULL,
    time_created timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE sidewalk.global_clustering_session OWNER TO sidewalk;

--
-- Name: global_clustering_session_global_clustering_session_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.global_clustering_session_global_clustering_session_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.global_clustering_session_global_clustering_session_id_seq OWNER TO sidewalk;

--
-- Name: global_clustering_session_global_clustering_session_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.global_clustering_session_global_clustering_session_id_seq OWNED BY sidewalk.global_clustering_session.global_clustering_session_id;


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
    copyright character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    expired boolean DEFAULT false NOT NULL,
    last_viewed timestamp with time zone
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
    time_created timestamp without time zone,
    mission_id integer NOT NULL,
    tutorial boolean DEFAULT false NOT NULL
);


ALTER TABLE sidewalk.label OWNER TO sidewalk;

--
-- Name: label_description; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.label_description (
    label_description_id integer NOT NULL,
    label_id integer NOT NULL,
    description text NOT NULL
);


ALTER TABLE sidewalk.label_description OWNER TO sidewalk;

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
-- Name: label_severity; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.label_severity (
    label_severity_id integer NOT NULL,
    label_id integer NOT NULL,
    severity integer NOT NULL
);


ALTER TABLE sidewalk.label_severity OWNER TO sidewalk;

--
-- Name: label_tag; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.label_tag (
    label_tag_id integer NOT NULL,
    label_id integer NOT NULL,
    tag_id integer NOT NULL
);


ALTER TABLE sidewalk.label_tag OWNER TO sidewalk;

--
-- Name: label_tag_label_tag_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.label_tag_label_tag_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.label_tag_label_tag_id_seq OWNER TO sidewalk;

--
-- Name: label_tag_label_tag_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.label_tag_label_tag_id_seq OWNED BY sidewalk.label_tag.label_tag_id;


--
-- Name: label_temporariness; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.label_temporariness (
    label_temporariness_id integer NOT NULL,
    label_id integer NOT NULL,
    temporary boolean NOT NULL
);


ALTER TABLE sidewalk.label_temporariness OWNER TO sidewalk;

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


--
-- Name: label_validation; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.label_validation (
    label_validation_id integer NOT NULL,
    label_id integer NOT NULL,
    validation_result integer NOT NULL,
    user_id text NOT NULL,
    mission_id integer NOT NULL,
    canvas_x integer NOT NULL,
    canvas_y integer NOT NULL,
    heading double precision NOT NULL,
    pitch double precision NOT NULL,
    zoom double precision NOT NULL,
    canvas_height integer NOT NULL,
    canvas_width integer NOT NULL,
    start_timestamp timestamp with time zone,
    end_timestamp timestamp with time zone
);


ALTER TABLE sidewalk.label_validation OWNER TO sidewalk;

--
-- Name: label_validation_label_validation_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.label_validation_label_validation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.label_validation_label_validation_id_seq OWNER TO sidewalk;

--
-- Name: label_validation_label_validation_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.label_validation_label_validation_id_seq OWNED BY sidewalk.label_validation.label_validation_id;


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
    mission_type_id integer NOT NULL,
    user_id text NOT NULL,
    mission_start timestamp without time zone NOT NULL,
    mission_end timestamp without time zone NOT NULL,
    completed boolean NOT NULL,
    pay real DEFAULT 0.0 NOT NULL,
    paid boolean NOT NULL,
    distance_meters double precision,
    distance_progress double precision,
    region_id integer,
    labels_validated integer,
    labels_progress integer,
    skipped boolean NOT NULL
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
-- Name: mission_type; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.mission_type (
    mission_type_id integer NOT NULL,
    mission_type text NOT NULL
);


ALTER TABLE sidewalk.mission_type OWNER TO sidewalk;

--
-- Name: mission_type_mission_type_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.mission_type_mission_type_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.mission_type_mission_type_id_seq OWNER TO sidewalk;

--
-- Name: mission_type_mission_type_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.mission_type_mission_type_id_seq OWNED BY sidewalk.mission_type.mission_type_id;


--
-- Name: osm_way_street_edge; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.osm_way_street_edge (
    osm_way_street_edge_id integer NOT NULL,
    osm_way_id integer NOT NULL,
    street_edge_id integer NOT NULL
);


ALTER TABLE sidewalk.osm_way_street_edge OWNER TO sidewalk;

--
-- Name: osm_way_street_edge_osm_way_street_edge_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.osm_way_street_edge_osm_way_street_edge_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.osm_way_street_edge_osm_way_street_edge_id_seq OWNER TO sidewalk;

--
-- Name: osm_way_street_edge_osm_way_street_edge_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.osm_way_street_edge_osm_way_street_edge_id_seq OWNED BY sidewalk.osm_way_street_edge.osm_way_street_edge_id;


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

ALTER SEQUENCE sidewalk.problem_description_problem_description_id_seq OWNED BY sidewalk.label_description.label_description_id;


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

ALTER SEQUENCE sidewalk.problem_severity_problem_severity_id_seq OWNED BY sidewalk.label_severity.label_severity_id;


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

ALTER SEQUENCE sidewalk.problem_temporariness_problem_temporariness_id_seq OWNED BY sidewalk.label_temporariness.label_temporariness_id;


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
-- Name: sidewalk_user; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.sidewalk_user (
    user_id text NOT NULL,
    username text NOT NULL,
    email text NOT NULL
);


ALTER TABLE sidewalk.sidewalk_user OWNER TO sidewalk;

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
    deleted boolean NOT NULL,
    "timestamp" timestamp with time zone DEFAULT timezone('utc'::text, now())
);


ALTER TABLE sidewalk.street_edge OWNER TO sidewalk;

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
-- Name: street_edge_priority; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.street_edge_priority (
    street_edge_priority_id integer NOT NULL,
    street_edge_id integer NOT NULL,
    priority double precision DEFAULT 0.0 NOT NULL
);


ALTER TABLE sidewalk.street_edge_priority OWNER TO sidewalk;

--
-- Name: street_edge_priority_street_edge_priority_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.street_edge_priority_street_edge_priority_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.street_edge_priority_street_edge_priority_id_seq OWNER TO sidewalk;

--
-- Name: street_edge_priority_street_edge_priority_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.street_edge_priority_street_edge_priority_id_seq OWNED BY sidewalk.street_edge_priority.street_edge_priority_id;


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
-- Name: tag; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.tag (
    tag_id integer NOT NULL,
    label_type_id integer NOT NULL,
    tag text NOT NULL
);


ALTER TABLE sidewalk.tag OWNER TO sidewalk;

--
-- Name: tag_tag_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.tag_tag_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.tag_tag_id_seq OWNER TO sidewalk;

--
-- Name: tag_tag_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.tag_tag_id_seq OWNED BY sidewalk.tag.tag_id;


--
-- Name: teaser; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.teaser (
    email character varying(2044) NOT NULL
);


ALTER TABLE sidewalk.teaser OWNER TO sidewalk;

--
-- Name: user_attribute; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.user_attribute (
    user_attribute_id integer NOT NULL,
    user_clustering_session_id integer NOT NULL,
    clustering_threshold double precision NOT NULL,
    label_type_id integer NOT NULL,
    region_id integer NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    severity integer,
    temporary boolean NOT NULL
);


ALTER TABLE sidewalk.user_attribute OWNER TO sidewalk;

--
-- Name: user_attribute_label; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.user_attribute_label (
    user_attribute_label_id integer NOT NULL,
    user_attribute_id integer NOT NULL,
    label_id integer NOT NULL
);


ALTER TABLE sidewalk.user_attribute_label OWNER TO sidewalk;

--
-- Name: user_attribute_label_user_attribute_label_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.user_attribute_label_user_attribute_label_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.user_attribute_label_user_attribute_label_id_seq OWNER TO sidewalk;

--
-- Name: user_attribute_label_user_attribute_label_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.user_attribute_label_user_attribute_label_id_seq OWNED BY sidewalk.user_attribute_label.user_attribute_label_id;


--
-- Name: user_attribute_user_attribute_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.user_attribute_user_attribute_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.user_attribute_user_attribute_id_seq OWNER TO sidewalk;

--
-- Name: user_attribute_user_attribute_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.user_attribute_user_attribute_id_seq OWNED BY sidewalk.user_attribute.user_attribute_id;


--
-- Name: user_clustering_session; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.user_clustering_session (
    user_clustering_session_id integer NOT NULL,
    user_id text NOT NULL,
    time_created timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE sidewalk.user_clustering_session OWNER TO sidewalk;

--
-- Name: user_clustering_session_user_clustering_session_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.user_clustering_session_user_clustering_session_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.user_clustering_session_user_clustering_session_id_seq OWNER TO sidewalk;

--
-- Name: user_clustering_session_user_clustering_session_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.user_clustering_session_user_clustering_session_id_seq OWNED BY sidewalk.user_clustering_session.user_clustering_session_id;


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
-- Name: validation_options; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.validation_options (
    validation_option_id integer NOT NULL,
    text text NOT NULL
);


ALTER TABLE sidewalk.validation_options OWNER TO sidewalk;

--
-- Name: validation_task_comment; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.validation_task_comment (
    validation_task_comment_id integer NOT NULL,
    mission_id integer NOT NULL,
    label_id integer NOT NULL,
    user_id text NOT NULL,
    ip_address text NOT NULL,
    gsv_panorama_id text NOT NULL,
    heading double precision NOT NULL,
    pitch double precision NOT NULL,
    zoom integer NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    "timestamp" timestamp with time zone,
    comment text NOT NULL
);


ALTER TABLE sidewalk.validation_task_comment OWNER TO sidewalk;

--
-- Name: validation_task_comment_validation_task_comment_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.validation_task_comment_validation_task_comment_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.validation_task_comment_validation_task_comment_id_seq OWNER TO sidewalk;

--
-- Name: validation_task_comment_validation_task_comment_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.validation_task_comment_validation_task_comment_id_seq OWNED BY sidewalk.validation_task_comment.validation_task_comment_id;


--
-- Name: validation_task_interaction; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.validation_task_interaction (
    validation_task_interaction_id integer NOT NULL,
    action text NOT NULL,
    gsv_panorama_id character varying(64),
    lat double precision,
    lng double precision,
    heading double precision,
    pitch double precision,
    zoom double precision,
    note text,
    "timestamp" timestamp with time zone,
    mission_id integer
);


ALTER TABLE sidewalk.validation_task_interaction OWNER TO sidewalk;

--
-- Name: validation_task_interaction_validation_task_interaction_id_seq; Type: SEQUENCE; Schema: sidewalk; Owner: sidewalk
--

CREATE SEQUENCE sidewalk.validation_task_interaction_validation_task_interaction_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE sidewalk.validation_task_interaction_validation_task_interaction_id_seq OWNER TO sidewalk;

--
-- Name: validation_task_interaction_validation_task_interaction_id_seq; Type: SEQUENCE OWNED BY; Schema: sidewalk; Owner: sidewalk
--

ALTER SEQUENCE sidewalk.validation_task_interaction_validation_task_interaction_id_seq OWNED BY sidewalk.validation_task_interaction.validation_task_interaction_id;


--
-- Name: version; Type: TABLE; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE TABLE sidewalk.version (
    version_id text NOT NULL,
    version_start_time timestamp without time zone NOT NULL,
    description text
);


ALTER TABLE sidewalk.version OWNER TO sidewalk;

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
-- Name: global_attribute_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.global_attribute ALTER COLUMN global_attribute_id SET DEFAULT nextval('sidewalk.global_attribute_global_attribute_id_seq'::regclass);


--
-- Name: global_attribute_user_attribute_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.global_attribute_user_attribute ALTER COLUMN global_attribute_user_attribute_id SET DEFAULT nextval('sidewalk.global_attribute_user_attribu_global_attribute_user_attribu_seq'::regclass);


--
-- Name: global_clustering_session_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.global_clustering_session ALTER COLUMN global_clustering_session_id SET DEFAULT nextval('sidewalk.global_clustering_session_global_clustering_session_id_seq'::regclass);


--
-- Name: label_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label ALTER COLUMN label_id SET DEFAULT nextval('sidewalk.label_label_id_seq'::regclass);


--
-- Name: label_description_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label_description ALTER COLUMN label_description_id SET DEFAULT nextval('sidewalk.problem_description_problem_description_id_seq'::regclass);


--
-- Name: label_point_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label_point ALTER COLUMN label_point_id SET DEFAULT nextval('sidewalk.label_point_label_point_id_seq'::regclass);


--
-- Name: label_severity_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label_severity ALTER COLUMN label_severity_id SET DEFAULT nextval('sidewalk.problem_severity_problem_severity_id_seq'::regclass);


--
-- Name: label_tag_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label_tag ALTER COLUMN label_tag_id SET DEFAULT nextval('sidewalk.label_tag_label_tag_id_seq'::regclass);


--
-- Name: label_temporariness_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label_temporariness ALTER COLUMN label_temporariness_id SET DEFAULT nextval('sidewalk.problem_temporariness_problem_temporariness_id_seq'::regclass);


--
-- Name: label_type_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label_type ALTER COLUMN label_type_id SET DEFAULT nextval('sidewalk.label_type_label_type_id_seq'::regclass);


--
-- Name: label_validation_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label_validation ALTER COLUMN label_validation_id SET DEFAULT nextval('sidewalk.label_validation_label_validation_id_seq'::regclass);


--
-- Name: login_info_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.login_info ALTER COLUMN login_info_id SET DEFAULT nextval('sidewalk.logininfo_id_seq'::regclass);


--
-- Name: mission_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.mission ALTER COLUMN mission_id SET DEFAULT nextval('sidewalk.mission_mission_id_seq'::regclass);


--
-- Name: mission_type_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.mission_type ALTER COLUMN mission_type_id SET DEFAULT nextval('sidewalk.mission_type_mission_type_id_seq'::regclass);


--
-- Name: osm_way_street_edge_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.osm_way_street_edge ALTER COLUMN osm_way_street_edge_id SET DEFAULT nextval('sidewalk.osm_way_street_edge_osm_way_street_edge_id_seq'::regclass);


--
-- Name: region_property_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.region_property ALTER COLUMN region_property_id SET DEFAULT nextval('sidewalk.region_property_region_property_id_seq'::regclass);


--
-- Name: role_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.role ALTER COLUMN role_id SET DEFAULT nextval('sidewalk.role_role_id_seq'::regclass);


--
-- Name: street_edge_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.street_edge ALTER COLUMN street_edge_id SET DEFAULT nextval('sidewalk.street_edge_street_edge_id_seq'::regclass);


--
-- Name: street_edge_issue_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.street_edge_issue ALTER COLUMN street_edge_issue_id SET DEFAULT nextval('sidewalk.street_edge_issue_street_edge_issue_id_seq'::regclass);


--
-- Name: street_edge_priority_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.street_edge_priority ALTER COLUMN street_edge_priority_id SET DEFAULT nextval('sidewalk.street_edge_priority_street_edge_priority_id_seq'::regclass);


--
-- Name: survey_category_option_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.survey_category_option ALTER COLUMN survey_category_option_id SET DEFAULT nextval('sidewalk.survey_category_option_survey_category_option_id_seq'::regclass);


--
-- Name: survey_question_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.survey_question ALTER COLUMN survey_question_id SET DEFAULT nextval('sidewalk.survey_question_survey_question_id_seq'::regclass);


--
-- Name: tag_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.tag ALTER COLUMN tag_id SET DEFAULT nextval('sidewalk.tag_tag_id_seq'::regclass);


--
-- Name: user_attribute_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_attribute ALTER COLUMN user_attribute_id SET DEFAULT nextval('sidewalk.user_attribute_user_attribute_id_seq'::regclass);


--
-- Name: user_attribute_label_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_attribute_label ALTER COLUMN user_attribute_label_id SET DEFAULT nextval('sidewalk.user_attribute_label_user_attribute_label_id_seq'::regclass);


--
-- Name: user_clustering_session_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_clustering_session ALTER COLUMN user_clustering_session_id SET DEFAULT nextval('sidewalk.user_clustering_session_user_clustering_session_id_seq'::regclass);


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
-- Name: validation_task_comment_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.validation_task_comment ALTER COLUMN validation_task_comment_id SET DEFAULT nextval('sidewalk.validation_task_comment_validation_task_comment_id_seq'::regclass);


--
-- Name: validation_task_interaction_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.validation_task_interaction ALTER COLUMN validation_task_interaction_id SET DEFAULT nextval('sidewalk.validation_task_interaction_validation_task_interaction_id_seq'::regclass);


--
-- Name: webpage_activity_id; Type: DEFAULT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.webpage_activity ALTER COLUMN webpage_activity_id SET DEFAULT nextval('sidewalk.webpage_activity_webpage_activity_id_seq'::regclass);


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
-- Name: global_attribute_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.global_attribute
    ADD CONSTRAINT global_attribute_pkey PRIMARY KEY (global_attribute_id);


--
-- Name: global_attribute_user_attribute_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.global_attribute_user_attribute
    ADD CONSTRAINT global_attribute_user_attribute_pkey PRIMARY KEY (global_attribute_user_attribute_id);


--
-- Name: global_clustering_session_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.global_clustering_session
    ADD CONSTRAINT global_clustering_session_pkey PRIMARY KEY (global_clustering_session_id);


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
-- Name: label_tag_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.label_tag
    ADD CONSTRAINT label_tag_pkey PRIMARY KEY (label_tag_id);


--
-- Name: label_type_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.label_type
    ADD CONSTRAINT label_type_pkey PRIMARY KEY (label_type_id);


--
-- Name: label_validation_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.label_validation
    ADD CONSTRAINT label_validation_pkey PRIMARY KEY (label_validation_id);


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
-- Name: mission_type_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.mission_type
    ADD CONSTRAINT mission_type_pkey PRIMARY KEY (mission_type_id);


--
-- Name: osm_way_street_edge_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.osm_way_street_edge
    ADD CONSTRAINT osm_way_street_edge_pkey PRIMARY KEY (osm_way_street_edge_id);


--
-- Name: play_evolutions_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.play_evolutions
    ADD CONSTRAINT play_evolutions_pkey PRIMARY KEY (id);


--
-- Name: problem_description_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.label_description
    ADD CONSTRAINT problem_description_pkey PRIMARY KEY (label_description_id);


--
-- Name: problem_severity_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.label_severity
    ADD CONSTRAINT problem_severity_pkey PRIMARY KEY (label_severity_id);


--
-- Name: problem_temporariness_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.label_temporariness
    ADD CONSTRAINT problem_temporariness_pkey PRIMARY KEY (label_temporariness_id);


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
-- Name: street_edge_issue_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.street_edge_issue
    ADD CONSTRAINT street_edge_issue_pkey PRIMARY KEY (street_edge_issue_id);


--
-- Name: street_edge_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.street_edge
    ADD CONSTRAINT street_edge_pkey PRIMARY KEY (street_edge_id);


--
-- Name: street_edge_priority_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.street_edge_priority
    ADD CONSTRAINT street_edge_priority_pkey PRIMARY KEY (street_edge_priority_id);


--
-- Name: street_edge_region_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.street_edge_region
    ADD CONSTRAINT street_edge_region_pkey PRIMARY KEY (street_edge_region_id);


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
-- Name: tag_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.tag
    ADD CONSTRAINT tag_pkey PRIMARY KEY (tag_id);


--
-- Name: unique_email; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.teaser
    ADD CONSTRAINT unique_email UNIQUE (email);


--
-- Name: user_attribute_label_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.user_attribute_label
    ADD CONSTRAINT user_attribute_label_pkey PRIMARY KEY (user_attribute_label_id);


--
-- Name: user_attribute_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.user_attribute
    ADD CONSTRAINT user_attribute_pkey PRIMARY KEY (user_attribute_id);


--
-- Name: user_clustering_session_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.user_clustering_session
    ADD CONSTRAINT user_clustering_session_pkey PRIMARY KEY (user_clustering_session_id);


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

ALTER TABLE ONLY sidewalk.sidewalk_user
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

ALTER TABLE ONLY sidewalk.sidewalk_user
    ADD CONSTRAINT user_username_key UNIQUE (username);


--
-- Name: validation_options_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.validation_options
    ADD CONSTRAINT validation_options_pkey PRIMARY KEY (validation_option_id);


--
-- Name: validation_task_comment_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.validation_task_comment
    ADD CONSTRAINT validation_task_comment_pkey PRIMARY KEY (validation_task_comment_id);


--
-- Name: version_pkey; Type: CONSTRAINT; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

ALTER TABLE ONLY sidewalk.version
    ADD CONSTRAINT version_pkey PRIMARY KEY (version_id);


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
-- Name: region_property_region_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX region_property_region_id_idx ON sidewalk.region_property USING btree (region_id);


--
-- Name: region_region_type_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX region_region_type_id_idx ON sidewalk.region USING btree (region_type_id);


--
-- Name: street_edge_issue_street_edge_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX street_edge_issue_street_edge_id_idx ON sidewalk.street_edge_issue USING btree (street_edge_id);


--
-- Name: street_edge_region_region_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX street_edge_region_region_id_idx ON sidewalk.street_edge_region USING btree (region_id);


--
-- Name: street_edge_region_street_edge_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX street_edge_region_street_edge_id_idx ON sidewalk.street_edge_region USING btree (street_edge_id);


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

CREATE INDEX user_email_idx ON sidewalk.sidewalk_user USING btree (email);


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
-- Name: webpage_activity_user_id_idx; Type: INDEX; Schema: sidewalk; Owner: sidewalk; Tablespace:
--

CREATE INDEX webpage_activity_user_id_idx ON sidewalk.webpage_activity USING btree (user_id);


--
-- Name: audit_task_comment_audit_task_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.audit_task_comment
    ADD CONSTRAINT audit_task_comment_audit_task_id_fkey FOREIGN KEY (audit_task_id) REFERENCES sidewalk.audit_task(audit_task_id);


--
-- Name: audit_task_comment_mission_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.audit_task_comment
    ADD CONSTRAINT audit_task_comment_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES sidewalk.mission(mission_id);


--
-- Name: audit_task_environment_audit_task_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.audit_task_environment
    ADD CONSTRAINT audit_task_environment_audit_task_id_fkey FOREIGN KEY (audit_task_id) REFERENCES sidewalk.audit_task(audit_task_id);


--
-- Name: audit_task_environment_mission_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.audit_task_environment
    ADD CONSTRAINT audit_task_environment_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES sidewalk.mission(mission_id);


--
-- Name: audit_task_incomplete_mission_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.audit_task_incomplete
    ADD CONSTRAINT audit_task_incomplete_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES sidewalk.mission(mission_id);


--
-- Name: audit_task_interaction_audit_task_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.audit_task_interaction
    ADD CONSTRAINT audit_task_interaction_audit_task_id_fkey FOREIGN KEY (audit_task_id) REFERENCES sidewalk.audit_task(audit_task_id);


--
-- Name: audit_task_interaction_mission_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.audit_task_interaction
    ADD CONSTRAINT audit_task_interaction_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES sidewalk.mission(mission_id);


--
-- Name: audit_task_street_edge_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.audit_task
    ADD CONSTRAINT audit_task_street_edge_id_fkey FOREIGN KEY (street_edge_id) REFERENCES sidewalk.street_edge(street_edge_id);


--
-- Name: audit_task_user_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.audit_task
    ADD CONSTRAINT audit_task_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk.sidewalk_user(user_id);


--
-- Name: global_attribute_global_clustering_session_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.global_attribute
    ADD CONSTRAINT global_attribute_global_clustering_session_id_fkey FOREIGN KEY (global_clustering_session_id) REFERENCES sidewalk.global_clustering_session(global_clustering_session_id);


--
-- Name: global_attribute_label_type_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.global_attribute
    ADD CONSTRAINT global_attribute_label_type_id_fkey FOREIGN KEY (label_type_id) REFERENCES sidewalk.label_type(label_type_id);


--
-- Name: global_attribute_region_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.global_attribute
    ADD CONSTRAINT global_attribute_region_id_fkey FOREIGN KEY (region_id) REFERENCES sidewalk.region(region_id);


--
-- Name: global_attribute_user_attribute_global_attribute_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.global_attribute_user_attribute
    ADD CONSTRAINT global_attribute_user_attribute_global_attribute_id_fkey FOREIGN KEY (global_attribute_id) REFERENCES sidewalk.global_attribute(global_attribute_id);


--
-- Name: global_attribute_user_attribute_user_attribute_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.global_attribute_user_attribute
    ADD CONSTRAINT global_attribute_user_attribute_user_attribute_id_fkey FOREIGN KEY (user_attribute_id) REFERENCES sidewalk.user_attribute(user_attribute_id);


--
-- Name: global_clustering_session_region_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.global_clustering_session
    ADD CONSTRAINT global_clustering_session_region_id_fkey FOREIGN KEY (region_id) REFERENCES sidewalk.region(region_id);


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
-- Name: label_mission_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label
    ADD CONSTRAINT label_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES sidewalk.mission(mission_id);


--
-- Name: label_tag_label_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label_tag
    ADD CONSTRAINT label_tag_label_id_fkey FOREIGN KEY (label_id) REFERENCES sidewalk.label(label_id);


--
-- Name: label_tag_tag_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label_tag
    ADD CONSTRAINT label_tag_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES sidewalk.tag(tag_id);


--
-- Name: label_validation_label_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label_validation
    ADD CONSTRAINT label_validation_label_id_fkey FOREIGN KEY (label_id) REFERENCES sidewalk.label(label_id);


--
-- Name: label_validation_mission_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label_validation
    ADD CONSTRAINT label_validation_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES sidewalk.mission(mission_id);


--
-- Name: label_validation_user_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label_validation
    ADD CONSTRAINT label_validation_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk.sidewalk_user(user_id);


--
-- Name: label_validation_validation_result_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.label_validation
    ADD CONSTRAINT label_validation_validation_result_fkey FOREIGN KEY (validation_result) REFERENCES sidewalk.validation_options(validation_option_id);


--
-- Name: mission_mission_type_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.mission
    ADD CONSTRAINT mission_mission_type_id_fkey FOREIGN KEY (mission_type_id) REFERENCES sidewalk.mission_type(mission_type_id);


--
-- Name: mission_region_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.mission
    ADD CONSTRAINT mission_region_id_fkey FOREIGN KEY (region_id) REFERENCES sidewalk.region(region_id);


--
-- Name: mission_user_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.mission
    ADD CONSTRAINT mission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk.sidewalk_user(user_id);


--
-- Name: osm_way_street_edge_street_edge_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.osm_way_street_edge
    ADD CONSTRAINT osm_way_street_edge_street_edge_id_fkey FOREIGN KEY (street_edge_id) REFERENCES sidewalk.street_edge(street_edge_id);


--
-- Name: street_edge_priority_street_edge_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.street_edge_priority
    ADD CONSTRAINT street_edge_priority_street_edge_id_fkey FOREIGN KEY (street_edge_id) REFERENCES sidewalk.street_edge(street_edge_id);


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
-- Name: tag_label_type_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.tag
    ADD CONSTRAINT tag_label_type_id_fkey FOREIGN KEY (label_type_id) REFERENCES sidewalk.label_type(label_type_id);


--
-- Name: user_attribute_label_label_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_attribute_label
    ADD CONSTRAINT user_attribute_label_label_id_fkey FOREIGN KEY (label_id) REFERENCES sidewalk.label(label_id);


--
-- Name: user_attribute_label_type_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_attribute
    ADD CONSTRAINT user_attribute_label_type_id_fkey FOREIGN KEY (label_type_id) REFERENCES sidewalk.label_type(label_type_id);


--
-- Name: user_attribute_label_user_attribute_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_attribute_label
    ADD CONSTRAINT user_attribute_label_user_attribute_id_fkey FOREIGN KEY (user_attribute_id) REFERENCES sidewalk.user_attribute(user_attribute_id);


--
-- Name: user_attribute_region_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_attribute
    ADD CONSTRAINT user_attribute_region_id_fkey FOREIGN KEY (region_id) REFERENCES sidewalk.region(region_id);


--
-- Name: user_attribute_user_clustering_session_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_attribute
    ADD CONSTRAINT user_attribute_user_clustering_session_id_fkey FOREIGN KEY (user_clustering_session_id) REFERENCES sidewalk.user_clustering_session(user_clustering_session_id);


--
-- Name: user_clustering_session_user_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_clustering_session
    ADD CONSTRAINT user_clustering_session_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk.sidewalk_user(user_id);


--
-- Name: user_survey_option_submission_survey_question_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_survey_option_submission
    ADD CONSTRAINT user_survey_option_submission_survey_question_id_fkey FOREIGN KEY (survey_question_id) REFERENCES sidewalk.survey_question(survey_question_id);


--
-- Name: user_survey_option_submission_user_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_survey_option_submission
    ADD CONSTRAINT user_survey_option_submission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk.sidewalk_user(user_id);


--
-- Name: user_survey_text_submission_survey_question_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_survey_text_submission
    ADD CONSTRAINT user_survey_text_submission_survey_question_id_fkey FOREIGN KEY (survey_question_id) REFERENCES sidewalk.survey_question(survey_question_id);


--
-- Name: user_survey_text_submission_user_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.user_survey_text_submission
    ADD CONSTRAINT user_survey_text_submission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk.sidewalk_user(user_id);


--
-- Name: validation_task_comment_label_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.validation_task_comment
    ADD CONSTRAINT validation_task_comment_label_id_fkey FOREIGN KEY (label_id) REFERENCES sidewalk.label(label_id);


--
-- Name: validation_task_comment_mission_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.validation_task_comment
    ADD CONSTRAINT validation_task_comment_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES sidewalk.mission(mission_id);


--
-- Name: validation_task_comment_user_id_fkey; Type: FK CONSTRAINT; Schema: sidewalk; Owner: sidewalk
--

ALTER TABLE ONLY sidewalk.validation_task_comment
    ADD CONSTRAINT validation_task_comment_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk.sidewalk_user(user_id);


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
-- Name: TABLE label_description; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.label_description FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.label_description FROM sidewalk;
GRANT ALL ON TABLE sidewalk.label_description TO sidewalk;


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
-- Name: TABLE label_severity; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.label_severity FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.label_severity FROM sidewalk;
GRANT ALL ON TABLE sidewalk.label_severity TO sidewalk;


--
-- Name: TABLE label_temporariness; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.label_temporariness FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.label_temporariness FROM sidewalk;
GRANT ALL ON TABLE sidewalk.label_temporariness TO sidewalk;


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
-- Name: SEQUENCE problem_description_problem_description_id_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.problem_description_problem_description_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.problem_description_problem_description_id_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.problem_description_problem_description_id_seq TO sidewalk;


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
-- Name: TABLE sidewalk_user; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.sidewalk_user FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.sidewalk_user FROM sidewalk;
GRANT ALL ON TABLE sidewalk.sidewalk_user TO sidewalk;
GRANT ALL ON TABLE sidewalk.sidewalk_user TO postgres;


--
-- Name: TABLE street_edge; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON TABLE sidewalk.street_edge FROM PUBLIC;
REVOKE ALL ON TABLE sidewalk.street_edge FROM sidewalk;
GRANT ALL ON TABLE sidewalk.street_edge TO sidewalk;
GRANT ALL ON TABLE sidewalk.street_edge TO postgres;


--
-- Name: SEQUENCE street_edge_parent_edge_seq; Type: ACL; Schema: sidewalk; Owner: sidewalk
--

REVOKE ALL ON SEQUENCE sidewalk.street_edge_parent_edge_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE sidewalk.street_edge_parent_edge_seq FROM sidewalk;
GRANT ALL ON SEQUENCE sidewalk.street_edge_parent_edge_seq TO sidewalk;
GRANT ALL ON SEQUENCE sidewalk.street_edge_parent_edge_seq TO postgres;


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
-- Inserts
--

INSERT INTO sidewalk.label_type (label_type_id, label_type, description) VALUES (1, 'CurbRamp', 'Curb Ramp');
INSERT INTO sidewalk.label_type (label_type_id, label_type, description) VALUES (2, 'NoCurbRamp', 'Missing Curb Ramp');
INSERT INTO sidewalk.label_type (label_type_id, label_type, description) VALUES (3, 'Obstacle', 'Obstacle in a Path');
INSERT INTO sidewalk.label_type (label_type_id, label_type, description) VALUES (4, 'SurfaceProblem', 'Surface Problem');
INSERT INTO sidewalk.label_type (label_type_id, label_type, description) VALUES (5, 'Other', '');
INSERT INTO sidewalk.label_type (label_type_id, label_type, description) VALUES (6, 'Occlusion', 'Can''t see the sidewalk');
INSERT INTO sidewalk.label_type (label_type_id, label_type, description) VALUES (7, 'NoSidewalk', 'No Sidewalk');
INSERT INTO sidewalk.label_type (label_type_id, label_type, description) VALUES (8, 'Problem', 'Composite type: represents cluster of NoCurbRamp, Obstacle, and/or SurfaceProblem labels');

INSERT INTO sidewalk.mission_type (mission_type_id, mission_type) VALUES (1, 'auditOnboarding');
INSERT INTO sidewalk.mission_type (mission_type_id, mission_type) VALUES (2, 'audit');
INSERT INTO sidewalk.mission_type (mission_type_id, mission_type) VALUES (3, 'validationOnboarding');
INSERT INTO sidewalk.mission_type (mission_type_id, mission_type) VALUES (4, 'validation');

INSERT INTO sidewalk.region_type (region_type_id, region_type) VALUES (1, 'city');
INSERT INTO sidewalk.region_type (region_type_id, region_type) VALUES (2, 'neighborhood');

INSERT INTO sidewalk.role (role_id, role) VALUES (3, 'Researcher');
INSERT INTO sidewalk.role (role_id, role) VALUES (5, 'Owner');
INSERT INTO sidewalk.role (role_id, role) VALUES (2, 'Turker');
INSERT INTO sidewalk.role (role_id, role) VALUES (4, 'Administrator');
INSERT INTO sidewalk.role (role_id, role) VALUES (1, 'Registered');
INSERT INTO sidewalk.role (role_id, role) VALUES (6, 'Anonymous');

INSERT INTO sidewalk.survey_category_option (survey_category_option_id, survey_category_option_text) VALUES (1, 'enjoyment');
INSERT INTO sidewalk.survey_category_option (survey_category_option_id, survey_category_option_text) VALUES (2, 'difficulty');
INSERT INTO sidewalk.survey_category_option (survey_category_option_id, survey_category_option_text) VALUES (3, 'self-efficacy');
INSERT INTO sidewalk.survey_category_option (survey_category_option_id, survey_category_option_text) VALUES (4, 'motivation');

INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (1, 1, 'Very boring', 1);
INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (2, 1, 'Boring', 2);
INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (3, 1, 'Neutral', 3);
INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (4, 1, 'Enjoyable', 4);
INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (5, 1, 'Very enjoyable', 5);
INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (6, 2, 'Very difficult', 1);
INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (7, 2, 'Difficult', 2);
INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (8, 2, 'Neutral', 3);
INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (9, 2, 'Easy', 4);
INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (10, 2, 'Very easy', 5);
INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (11, 3, 'Poor', 1);
INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (12, 3, 'Fair', 2);
INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (13, 3, 'Good', 3);
INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (14, 3, 'Very Good', 4);
INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (15, 3, 'Excellent', 5);
INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (16, 4, 'It''s fun.', 1);
INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (17, 4, 'For the money.', 2);
INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (18, 4, 'To help people.', 3);
INSERT INTO sidewalk.survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (19, 4, 'Accessibility is an important cause', 4);

INSERT INTO sidewalk.survey_question (survey_question_id, survey_question_text, survey_input_type, survey_category_option_id, survey_display_rank, deleted, survey_user_role_id, required) VALUES (1, 'How much did you enjoy this task?', 'radio', 1, 1, false, 1, true);
INSERT INTO sidewalk.survey_question (survey_question_id, survey_question_text, survey_input_type, survey_category_option_id, survey_display_rank, deleted, survey_user_role_id, required) VALUES (2, 'How difficult did you find this task?', 'radio', 2, 2, false, 1, true);
INSERT INTO sidewalk.survey_question (survey_question_id, survey_question_text, survey_input_type, survey_category_option_id, survey_display_rank, deleted, survey_user_role_id, required) VALUES (3, 'How well do you think you did on this task?', 'radio', 3, 3, false, 1, true);
INSERT INTO sidewalk.survey_question (survey_question_id, survey_question_text, survey_input_type, survey_category_option_id, survey_display_rank, deleted, survey_user_role_id, required) VALUES (4, 'Why did you choose to contribute to Project Sidewalk?', 'free-text-feedback', NULL, 5, false, 1, true);
INSERT INTO sidewalk.survey_question (survey_question_id, survey_question_text, survey_input_type, survey_category_option_id, survey_display_rank, deleted, survey_user_role_id, required) VALUES (5, 'Do you have any feedback for us?', 'free-text-feedback', NULL, 4, false, 1, false);

INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (1, 1, 'narrow');
INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (2, 1, 'points into traffic');
INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (3, 1, 'missing friction strip');
INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (4, 1, 'steep');
INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (5, 2, 'alternate route present');
INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (6, 2, 'no alternate route');
INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (7, 2, 'unclear if needed');
INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (8, 3, 'trash can');
INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (9, 3, 'fire hydrant');
INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (10, 3, 'pole');
INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (11, 3, 'tree');
INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (12, 3, 'vegetation');
INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (13, 4, 'bumpy');
INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (14, 4, 'uneven');
INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (15, 4, 'cracks');
INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (16, 4, 'grass');
INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (17, 4, 'narrow sidewalk');
INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (18, 5, 'missing crosswalk');
INSERT INTO sidewalk.tag (tag_id, label_type_id, tag) VALUES (19, 5, 'no bus stop access');

INSERT INTO sidewalk."sidewalk_user" (user_id, username, email) VALUES
('97760883-8ef0-4309-9a5e-0c086ef27573', 'anonymous', 'anonymous@cs.umd.edu')
;

INSERT INTO sidewalk.version VALUES ('5.0.0', now(), 'Overhaul mission infrastructure and anonymous user ids.');

INSERT INTO sidewalk.validation_options (validation_option_id, text) VALUES (1, 'agree');
INSERT INTO sidewalk.validation_options (validation_option_id, text) VALUES (2, 'disagree');
INSERT INTO sidewalk.validation_options (validation_option_id, text) VALUES (3, 'unclear');

--
-- play_evolutions inserts
--

INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (1, '0f96d4b56af6f7da969295acebbc1108a19bc2c5', '2017-07-09 00:00:00', 'CREATE TABLE region_completion
(
region_id INTEGER NOT NULL,
total_distance REAL,
audited_distance REAL,
PRIMARY KEY (region_id)
);', 'DROP TABLE region_completion;', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (2, '9c40a16b98eff86b8e7f2ca580fd2effb5372d1f', '2017-07-09 00:00:00', 'INSERT INTO role (role_id, role) VALUES (3, ''Researcher'');

INSERT INTO user_role (user_id, role_id) VALUES
(''49787727-e427-4835-a153-9af6a83d1ed1'', 3), (''9efaca05-53bb-492e-83ab-2b47219ee863'', 3),
(''25b85b51-574b-436e-a9c4-339eef879e78'', 3), (''9c828571-eb9d-4723-9e8d-2c00289a6f6a'', 3),
(''5473abc6-38fc-4807-a515-e44cdfb92ca2'', 3), (''0c6cb637-05b7-4759-afb2-b0a25b615597'', 3),
(''6acde11f-d9a2-4415-b73e-137f28eaa4ab'', 3), (''0082be2e-c664-4c05-9881-447924880e2e'', 3),
(''ae8fc440-b465-4a45-ab49-1964a7f1dcee'', 3), (''c4ba8834-4722-4ee1-8f71-4e3fe9af38eb'', 3),
(''41804389-8f0e-46b1-882c-477e060dbe95'', 3), (''d8862038-e4dd-48a4-a6d0-69042d9e247a'', 3),
(''43bd82ab-bc7d-4be7-a637-99c92f566ba5'', 3), (''0bfed786-ce24-43f9-9c58-084ae82ad175'', 3),
(''b65c0864-7c3a-4ba7-953b-50743a2634f6'', 3), (''b6049113-7e7a-4421-a966-887266200d72'', 3),
(''395abc5a-14ea-443c-92f8-85e87fa002be'', 3), (''a6611125-51d0-41d1-9868-befcf523e131'', 3),
(''1dc2f78e-f722-4450-b14e-b21b232ecdef'', 3), (''ee570f03-7bca-471e-a0dc-e7924dac95a4'', 3),
(''23fce322-9f64-4e95-90fc-7141f755b2a1'', 3), (''c846ef76-39c1-4a53-841c-6588edaac09b'', 3),
(''74b56671-c9b0-4052-956e-02083cbb5091'', 3), (''fe724938-797a-48af-84e9-66b6b86b6245'', 3);', 'DELETE FROM role WHERE (role_id = 3 AND role = ''Researcher'');

DELETE FROM user_role WHERE role_id = 3;', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (3, '30cb26ac6382beee539ee07822ffe952c5fb634b', '2017-07-09 00:00:00', 'UPDATE region_property SET value = ''16th Street Heights (South)'' WHERE region_id = 286 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''16th Street Heights (North)'' WHERE region_id = 323 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Bellevue (North)'' WHERE region_id = 282 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Bellevue (East)'' WHERE region_id = 365 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Bellevue (South)'' WHERE region_id = 370 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Adams Morgan (West)'' WHERE region_id = 197 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Adams Morgan (East)'' WHERE region_id = 215 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Benning Ridge (South)'' WHERE region_id = 295 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Benning Ridge (North)'' WHERE region_id = 314 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Bloomingdale (South)'' WHERE region_id = 272 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Brentwood (North)'' WHERE region_id = 329 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Brightwood (West)'' WHERE region_id = 267 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Brightwood (East)'' WHERE region_id = 269 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Burleith/Hillandale (South)'' WHERE region_id = 222 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Capitol Hill (North)'' WHERE region_id = 253 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Capitol Hill (South)'' WHERE region_id = 259 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Cardozo/Shaw (West)'' WHERE region_id = 202 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Chevy Chase (North)'' WHERE region_id = 208 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Columbia Heights (North)'' WHERE region_id = 304 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Columbia Heights (West)'' WHERE region_id = 303 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Columbia Heights (South)'' WHERE region_id = 213 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Columbia Heights (Southwest)'' WHERE region_id = 214 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Congress Heights (North)'' WHERE region_id = 319 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Congress Heights (South)'' WHERE region_id = 362 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Deanwood (South)'' WHERE region_id = 347 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Douglass (North)'' WHERE region_id = 230 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Dupont Circle (North)'' WHERE region_id = 200 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Dupont Circle (West)'' WHERE region_id = 201 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Dupont Circle (East)'' WHERE region_id = 245 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Eckington (West)'' WHERE region_id = 358 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Edgewood (South)'' WHERE region_id = 280 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Fairlawn (South)'' WHERE region_id = 293 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Forest Hills (South)'' WHERE region_id = 207 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Fort Stanton (South)'' WHERE region_id = 232 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Georgetown (West)'' WHERE region_id = 223 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Grant Park (South)'' WHERE region_id = 311 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Hill East (South)'' WHERE region_id = 256 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Hill East (East)'' WHERE region_id = 257 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Hill East (West)'' WHERE region_id = 260 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Howard University (West)'' WHERE region_id = 212 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Kingman Park (South)'' WHERE region_id = 351 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Kingman Park (East)'' WHERE region_id = 349 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Lincoln Park (South)'' WHERE region_id = 258 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Logan Circle/Shaw (North)'' WHERE region_id = 243 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Logan Circle/Shaw (East)'' WHERE region_id = 242 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Logan Circle/Shaw (Northeast)'' WHERE region_id = 241 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Manor Park (South)'' WHERE region_id = 326 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Marshall Heights (East)'' WHERE region_id = 313 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Mount Pleasant (East)'' WHERE region_id = 302 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Mount Pleasant (South)'' WHERE region_id = 301 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Near Northeast (South)'' WHERE region_id = 354 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Near Capitol Street (South)'' WHERE region_id = 238 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Petworth (North)'' WHERE region_id = 327 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Petworth (East)'' WHERE region_id = 283 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Petworth (West)'' WHERE region_id = 287 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Queens Chapel (North)'' WHERE region_id = 335 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Shipley (North)'' WHERE region_id = 229 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Stanton Park (North)'' WHERE region_id = 357 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Stanton Park (East)'' WHERE region_id = 350 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Stanton Park (South)'' WHERE region_id = 352 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Stanton Park (West)'' WHERE region_id = 353 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Stanton Park (Southwest)'' WHERE region_id = 355 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Stronghold (South)'' WHERE region_id = 279 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Takoma (West)'' WHERE region_id = 318 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Trinidad (South)'' WHERE region_id = 360 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Washington Highlands (North)'' WHERE region_id = 343 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Washington Highlands (East)'' WHERE region_id = 342 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Washington Highlands (South)'' WHERE region_id = 308 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Woodley Park (West)'' WHERE region_id = 210 AND key = ''Neighborhood Name'';', 'UPDATE region_property SET value = ''16th Street Heights'' WHERE region_id = 286 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''16th Street Heights'' WHERE region_id = 323 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Bellevue'' WHERE region_id = 282 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Bellevue'' WHERE region_id = 365 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Bellevue'' WHERE region_id = 370 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Adams Morgan'' WHERE region_id = 197 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Adams Morgan'' WHERE region_id = 215 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Benning Ridge'' WHERE region_id = 295 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Benning Ridge'' WHERE region_id = 314 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Bloomingdale'' WHERE region_id = 272 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Brentwood'' WHERE region_id = 329 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Brightwood'' WHERE region_id = 267 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Brightwood'' WHERE region_id = 269 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Burleith/Hillandale'' WHERE region_id = 222 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Capitol Hill'' WHERE region_id = 253 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Capitol Hill'' WHERE region_id = 259 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Cardozo/Shaw'' WHERE region_id = 202 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Chevy Chase'' WHERE region_id = 208 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Columbia Heights'' WHERE region_id = 304 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Columbia Heights'' WHERE region_id = 303 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Columbia Heights'' WHERE region_id = 213 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Columbia Heights'' WHERE region_id = 214 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Congress Heights'' WHERE region_id = 319 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Congress Heights'' WHERE region_id = 362 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Deanwood'' WHERE region_id = 347 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Douglass'' WHERE region_id = 230 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Dupont Circle'' WHERE region_id = 200 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Dupont Circle'' WHERE region_id = 201 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Dupont Circle'' WHERE region_id = 245 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Eckington'' WHERE region_id = 358 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Edgewood'' WHERE region_id = 280 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Fairlawn'' WHERE region_id = 293 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Forest Hills'' WHERE region_id = 207 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Fort Stanton'' WHERE region_id = 232 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Georgetown'' WHERE region_id = 223 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Grant Park'' WHERE region_id = 311 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Hill East'' WHERE region_id = 256 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Hill East'' WHERE region_id = 257 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Hill East'' WHERE region_id = 260 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Howard University'' WHERE region_id = 212 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Kingman Park'' WHERE region_id = 351 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Kingman Park'' WHERE region_id = 349 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Lincoln Park'' WHERE region_id = 258 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Logan Circle/Shaw'' WHERE region_id = 243 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Logan Circle/Shaw'' WHERE region_id = 242 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Logan Circle/Shaw'' WHERE region_id = 241 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Manor Park'' WHERE region_id = 326 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Marshall Heights'' WHERE region_id = 313 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Mount Pleasant'' WHERE region_id = 302 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Mount Pleasant'' WHERE region_id = 301 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Near Northeast'' WHERE region_id = 354 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Near Capitol Street'' WHERE region_id = 238 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Petworth'' WHERE region_id = 327 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Petworth'' WHERE region_id = 283 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Petworth'' WHERE region_id = 287 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Queens Chapel'' WHERE region_id = 335 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Shipley'' WHERE region_id = 229 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Stanton Park'' WHERE region_id = 357 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Stanton Park'' WHERE region_id = 350 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Stanton Park'' WHERE region_id = 352 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Stanton Park'' WHERE region_id = 353 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Stanton Park'' WHERE region_id = 355 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Stronghold'' WHERE region_id = 279 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Takoma'' WHERE region_id = 318 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Trinidad'' WHERE region_id = 360 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Washington Highlands'' WHERE region_id = 343 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Washington Highlands'' WHERE region_id = 342 AND key = ''Neighborhood Name'';
UPDATE region_property SET value = ''Washington Highlands'' WHERE region_id = 308 AND key = ''Neighborhood Name'';

UPDATE region_property SET value = ''Woodley Park'' WHERE region_id = 210 AND key = ''Neighborhood Name'';', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (4, '5799fd78b7e4f8e43c23e67bf3c5ad8a93063701', '2017-08-11 00:00:00', 'INSERT INTO mission (region_id, label, level, deleted, coverage, distance, distance_ft, distance_mi)
SELECT region_id, label, level, deleted, coverage, distance/2, distance_ft/2, distance_mi/2
FROM mission
WHERE deleted = ''f'' and distance_ft = 1000;

INSERT INTO mission (region_id, label, level, deleted, coverage, distance, distance_ft, distance_mi)
SELECT region_id, label, level, deleted, coverage/2, distance, distance_ft, distance_mi
FROM (
SELECT m1.region_id, m1.label, m1.level, m1.deleted, m2.coverage, m1.distance, m1.distance_ft, m1.distance_mi
FROM mission m1 INNER JOIN mission m2 ON m1.region_id = m2.region_id
WHERE m1.deleted = ''f'' AND m2.deleted = ''f'' AND m1.distance_ft = 1000 AND m2.distance_ft = 2000
) m3;', 'DELETE FROM mission
WHERE deleted = ''f'' AND distance_ft = 500;

DELETE FROM mission
WHERE deleted = ''f'' AND distance_ft = 1000 AND coverage IS NOT NULL', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (5, '602d14472aaa425c094d77d2bd33553644552906', '2017-08-11 00:00:00', 'ALTER TABLE label
ADD time_created TIMESTAMP;', 'ALTER TABLE label
DROP time_created;', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (6, '04421cab316013ba4b61351bfaaf6b52ff3c2473', '2017-09-26 00:00:00', 'INSERT INTO role (role_id, role) VALUES (4, ''Turker'');

ALTER TABLE amt_assignment
ADD turker_id TEXT NOT NULL,
ADD confirmation_code TEXT,
ADD completed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE mission_user
ADD paid BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE survey_category_option
(
survey_category_option_id SERIAL NOT NULL,
survey_category_option_text TEXT NOT NULL,
PRIMARY KEY (survey_category_option_id)
);

CREATE TABLE survey_question
(
survey_question_id SERIAL NOT NULL,
survey_question_text TEXT NOT NULL,
survey_input_type TEXT NOT NULL,
survey_category_option_id INT,
survey_display_rank INT,
deleted BOOLEAN NOT NULL DEFAULT FALSE,
survey_user_role_id INT NOT NULL DEFAULT 1,
required BOOLEAN NOT NULL DEFAULT FALSE,
PRIMARY KEY (survey_question_id),
FOREIGN KEY (survey_category_option_id) REFERENCES survey_category_option(survey_category_option_id)
);

CREATE TABLE survey_option(
survey_option_id INT NOT NULL,
survey_category_option_id INT NOT NULL,
survey_option_text TEXT NOT NULL,
survey_display_rank INT,
PRIMARY KEY (survey_option_id),
FOREIGN KEY (survey_category_option_id) REFERENCES survey_category_option(survey_category_option_id)
);

INSERT INTO survey_category_option VALUES (1, ''enjoyment'');
INSERT INTO survey_category_option VALUES (2, ''difficulty'');
INSERT INTO survey_category_option VALUES (3, ''self-efficacy'');
INSERT INTO survey_category_option VALUES (4, ''motivation'');

INSERT INTO survey_option VALUES (1, 1, ''Very boring'', 1);
INSERT INTO survey_option VALUES (2, 1, ''Boring'', 2);
INSERT INTO survey_option VALUES (3, 1, ''Neutral'', 3);
INSERT INTO survey_option VALUES (4, 1, ''Enjoyable'', 4);
INSERT INTO survey_option VALUES (5, 1, ''Very enjoyable'', 5);
INSERT INTO survey_option VALUES (6, 2, ''Very difficult'', 1);
INSERT INTO survey_option VALUES (7, 2, ''Difficult'', 2);
INSERT INTO survey_option VALUES (8, 2, ''Neutral'', 3);
INSERT INTO survey_option VALUES (9, 2, ''Easy'', 4);
INSERT INTO survey_option VALUES (10, 2, ''Very easy'', 5);
INSERT INTO survey_option VALUES (11, 3, ''Poor'', 1);
INSERT INTO survey_option VALUES (12, 3, ''Fair'', 2);
INSERT INTO survey_option VALUES (13, 3, ''Good'', 3);
INSERT INTO survey_option VALUES (14, 3, ''Very Good'', 4);
INSERT INTO survey_option VALUES (15, 3, ''Excellent'', 5);
INSERT INTO survey_option VALUES (16, 4, ''It''''s fun.'', 1);
INSERT INTO survey_option VALUES (17, 4, ''For the money.'', 2);
INSERT INTO survey_option VALUES (18, 4, ''To help people.'', 3);
INSERT INTO survey_option VALUES (19, 4, ''Accessibility is an important cause'', 4);

INSERT INTO survey_question VALUES (1, ''How much did you enjoy this task?'', ''radio'', 1, 1, false, 1,true);
INSERT INTO survey_question VALUES (2, ''How difficult did you find this task?'', ''radio'', 2, 2, false, 1, true);
INSERT INTO survey_question VALUES (3, ''How well do you think you did on this task?'', ''radio'', 3, 3, false, 1, true);
INSERT INTO survey_question VALUES (4, ''Why did you choose to contribute to Project Sidewalk?'', ''free-text-feedback'', NULL, 5, false, 1, true);
INSERT INTO survey_question VALUES (5, ''Do you have any feedback for us?'', ''free-text-feedback'', NULL, 4, false, 1, false);


create TABLE user_survey_text_submission
(
user_survey_text_submission_id SERIAL NOT NULL,
user_id TEXT NOT NULL,
survey_question_id INT NOT NULL,
survey_text_submission TEXT,
time_submitted TIMESTAMP,
num_missions_completed INT,
PRIMARY KEY (user_survey_text_submission_id),
FOREIGN KEY (user_id) REFERENCES "user"(user_id),
FOREIGN key (survey_question_id) REFERENCES  survey_question(survey_question_id)
);

CREATE TABLE user_survey_option_submission
(
user_survey_option_submission_id SERIAL NOT NULL,
user_id TEXT NOT NULL,
survey_question_id INT NOT NULL,
survey_option_id INT,
time_submitted TIMESTAMP,
num_missions_completed INT,
PRIMARY KEY (user_survey_option_submission_id),
FOREIGN KEY (user_id) REFERENCES "user"(user_id),
FOREIGN key (survey_question_id) REFERENCES  survey_question(survey_question_id)
);', 'ALTER TABLE mission_user
DROP paid;

ALTER TABLE amt_assignment
DROP turker_id,
DROP confirmation_code,
DROP completed;

DELETE FROM role WHERE (role_id = 4 AND role = ''Turker'');
DELETE FROM user_role WHERE role_id = 4;

ALTER TABLE user_survey_option_submission
DROP CONSTRAINT IF EXISTS user_survey_option_submission_user_id_fkey,
DROP CONSTRAINT IF EXISTS user_survey_option_submission_survey_question_id_fkey;

ALTER TABLE user_survey_text_submission
DROP CONSTRAINT IF EXISTS user_survey_text_submission_user_id_fkey,
DROP CONSTRAINT IF EXISTS user_survey_text_submission_survey_question_id_fkey;

ALTER TABLE survey_option
DROP CONSTRAINT IF EXISTS survey_option_survey_category_option_id_fkey;

ALTER TABLE survey_question
DROP CONSTRAINT IF EXISTS survey_question_survey_category_option_id_fkey;


DROP TABLE user_survey_option_submission;
DROP TABLE user_survey_text_submission;

DROP TABLE survey_option;
DROP TABLE survey_question;
DROP TABLE survey_category_option;', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (7, 'ec1ebb362fd62387fd62f5aa3c8bcd36651c9903', '2017-10-12 00:00:00', 'CREATE TABLE gsv_onboarding_pano
(
gsv_panorama_id TEXT NOT NULL,
has_labels BOOLEAN NOT NULL,
PRIMARY KEY (gsv_panorama_id)
);

INSERT INTO gsv_onboarding_pano VALUES (''stxXyCKAbd73DmkM2vsIHA'', TRUE);
INSERT INTO gsv_onboarding_pano VALUES (''PTHUzZqpLdS1nTixJMoDSw'', FALSE);
INSERT INTO gsv_onboarding_pano VALUES (''bdmGHJkiSgmO7_80SnbzXw'', TRUE);
INSERT INTO gsv_onboarding_pano VALUES (''OgLbmLAuC4urfE5o7GP_JQ'', TRUE);', 'DROP TABLE gsv_onboarding_pano;', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (8, 'ffb62e3b6ff1969d24d110264c653423358d1fc4', '2019-01-28 00:00:00', 'INSERT INTO role (role_id, role) VALUES (5, ''Owner'');
INSERT INTO user_role (user_id, role_id) VALUES
(''49787727-e427-4835-a153-9af6a83d1ed1'', 5);

UPDATE role SET role = ''Turker'' WHERE role_id = 2;
UPDATE role SET role = ''Administrator'' WHERE role_id = 4;

UPDATE user_role SET role_id = 0 WHERE role_id = 2;
UPDATE user_role SET role_id = 2 WHERE role_id = 4;
UPDATE user_role SET role_id = 4 WHERE role_id = 0;

DELETE FROM user_role WHERE user_id IN (
SELECT user_id FROM user_role WHERE role_id = 5
) AND role_id < 5;
DELETE FROM user_role WHERE user_id IN (
SELECT user_id FROM user_role WHERE role_id = 4
) AND role_id < 4;
DELETE FROM user_role WHERE user_id IN (
SELECT user_id FROM user_role WHERE role_id = 3
) AND role_id < 3;
DELETE FROM user_role WHERE user_id IN (
SELECT user_id FROM user_role WHERE role_id = 2
) AND role_id < 2;', 'INSERT INTO user_role (user_id, role_id)
SELECT user_id, 1
FROM (
SELECT user_id, role_id
FROM user_role
WHERE role_id > 2
) researchers_to_owner;
INSERT INTO user_role (user_id, role_id)
SELECT user_id, 3
FROM (
SELECT user_id, role_id
FROM user_role
WHERE role_id > 3
) admins_and_owner;
INSERT INTO user_role (user_id, role_id)
SELECT user_id, 4
FROM (
SELECT user_id, role_id
FROM user_role
WHERE role_id > 4
) owner;

DELETE FROM user_role WHERE role_id = 5;

UPDATE user_role SET role_id = 0 WHERE role_id = 2;
UPDATE user_role SET role_id = 2 WHERE role_id = 4;
UPDATE user_role SET role_id = 4 WHERE role_id = 0;

UPDATE role SET role = ''Administrator'' WHERE role_id = 2;
UPDATE role SET role = ''Turker'' WHERE role_id = 4;
DELETE FROM role WHERE role_id = 5;', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (9, '2d8b53ec4bf3a308253dea9fbd549f1774de290e', '2019-01-28 00:00:00', 'INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27047 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27048 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27049 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27089 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27053 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27054 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27055 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27056 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27057 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27058 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27061 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27062 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27063 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27064 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27066 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27069 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27070 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27071 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27073 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27074 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27084 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27085 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27086 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27088 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27091 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27092 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27093 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27094 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27095 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27096 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27097 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27098 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27099 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27102 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27103 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27104 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27105 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27106 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27107 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27108 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27109 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27110 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27111 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27112 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27113 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27114 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27115 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27116 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27117 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27118 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27119 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27120 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27123 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27124 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27127 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27128 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27129 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27130 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27100 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27131 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27132 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27133 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27134 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27135 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27136 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27137 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27138 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27139 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27140 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27141 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27143 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27144 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27145 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27146 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27147 );
INSERT INTO street_edge_assignment_count (street_edge_id) VALUES ( 27101 );', 'DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27047;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27048;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27049;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27089;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27053;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27054;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27055;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27056;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27057;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27058;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27061;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27062;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27063;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27064;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27066;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27069;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27070;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27071;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27073;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27074;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27084;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27085;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27086;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27088;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27091;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27092;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27093;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27094;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27095;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27096;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27097;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27098;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27099;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27102;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27103;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27104;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27105;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27106;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27107;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27108;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27109;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27110;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27111;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27112;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27113;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27114;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27115;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27116;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27117;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27118;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27119;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27120;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27123;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27124;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27127;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27128;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27129;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27130;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27100;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27131;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27132;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27133;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27134;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27135;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27136;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27137;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27138;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27139;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27140;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27141;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27143;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27144;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27145;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27146;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27147;
DELETE FROM street_edge_assignment_count WHERE street_edge_id = 27101;', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (10, '3665d53cca49c0c89f9925ac831fcdbdb1c51820', '2019-01-28 00:00:00', 'ALTER TABLE mission_user
ADD pay_per_mile REAL NOT NULL DEFAULT 0.0;', 'ALTER TABLE mission_user
DROP pay_per_mile;', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (11, '8bc3e0323734fe001794f029abfdd9ae95df6d0a', '2019-01-28 00:00:00', 'UPDATE street_edge SET deleted = TRUE WHERE street_edge_id IN (
26762, 23790, 7738, 23705, 23845, 25214, 22855, 19178, 22918, 23785, 26758, 26763, 26773, 24838, 24431, 3919, 23850,
22846, 22946, 11224, 20517, 22931, 26765, 26764, 4710, 20564, 26769, 7430, 22775, 25543, 22711, 24692, 23801, 22972,
23802, 23792, 11223, 20526, 23851, 19177, 22971, 20525, 22772, 26772, 25171, 23386, 25332, 26770, 25213, 20520, 26774,
25325, 23841, 20562, 27027, 22822, 22768, 20523, 22851, 26767, 25331, 22920, 26777, 22930, 22911, 22820, 10615, 23385,
26757, 26766, 22767, 23846, 26778, 24691, 22847, 22845, 26761, 20866, 26785, 26930, 25538
);', 'UPDATE street_edge SET deleted = FALSE WHERE street_edge_id IN (
26762, 23790, 7738, 23705, 23845, 25214, 22855, 19178, 22918, 23785, 26758, 26763, 26773, 24838, 24431, 3919, 23850,
22846, 22946, 11224, 20517, 22931, 26765, 26764, 4710, 20564, 26769, 7430, 22775, 25543, 22711, 24692, 23801, 22972,
23802, 23792, 11223, 20526, 23851, 19177, 22971, 20525, 22772, 26772, 25171, 23386, 25332, 26770, 25213, 20520, 26774,
25325, 23841, 20562, 27027, 22822, 22768, 20523, 22851, 26767, 25331, 22920, 26777, 22930, 22911, 22820, 10615, 23385,
26757, 26766, 22767, 23846, 26778, 24691, 22847, 22845, 26761, 20866, 26785, 26930, 25538
);', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (12, 'bf0c3c7ca359bc9d9d02e32740d77d4848dcbda9', '2019-01-28 00:00:00', 'CREATE TABLE street_edge_priority
(
street_edge_priority_id SERIAL NOT NULL,
street_edge_id INT NOT NULL,
priority DOUBLE PRECISION NOT NULL DEFAULT 0.0,
PRIMARY KEY (street_edge_priority_id),
FOREIGN KEY (street_edge_id) REFERENCES street_edge(street_edge_id)
);

INSERT INTO street_edge_priority (street_edge_id)
SELECT street_edge_id FROM street_edge WHERE deleted = FALSE;', 'DROP TABLE street_edge_priority;', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (20, '55ab87806c6225a0299f72d9c0a14408a3cabfc5', '2019-01-28 00:00:00', 'CREATE TABLE version
(
version_id TEXT NOT NULL,
version_start_time TIMESTAMP NOT NULL,
description TEXT,
PRIMARY KEY (version_id)
);', 'DROP TABLE version;', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (13, '9b90fbe01031639e37efb5c1ab8a8bd80634bb9d', '2019-01-28 00:00:00', 'DROP TABLE sidewalk_edge_accessibility_feature;

DROP TABLE accessibility_feature;

INSERT INTO label_type VALUES (8, ''Problem'', ''Composite type: represents cluster of NoCurbRamp, Obstacle, and/or SurfaceProblem labels'');

CREATE TABLE user_clustering_session
(
user_clustering_session_id SERIAL NOT NULL,
is_anonymous BOOLEAN NOT NULL,
user_id TEXT,
ip_address TEXT,
time_created timestamp default current_timestamp NOT NULL,
PRIMARY KEY (user_clustering_session_id),
FOREIGN KEY (user_id) REFERENCES "user" (user_id)
);

CREATE TABLE user_attribute
(
user_attribute_id SERIAL NOT NULL,
user_clustering_session_id INT NOT NULL,
clustering_threshold DOUBLE PRECISION NOT NULL,
label_type_id INT NOT NULL,
region_id INT NOT NULL,
lat DOUBLE PRECISION NOT NULL,
lng DOUBLE PRECISION NOT NULL,
severity INT,
temporary BOOLEAN NOT NULL,
PRIMARY KEY (user_attribute_id),
FOREIGN KEY (user_clustering_session_id) REFERENCES user_clustering_session(user_clustering_session_id),
FOREIGN KEY (label_type_id) REFERENCES label_type(label_type_id),
FOREIGN KEY (region_id) REFERENCES region(region_id)
);

CREATE TABLE user_attribute_label
(
user_attribute_label_id SERIAL NOT NULL,
user_attribute_id INT NOT NULL,
label_id INT NOT NULL,
PRIMARY KEY (user_attribute_label_id),
FOREIGN KEY (user_attribute_id) REFERENCES user_attribute(user_attribute_id),
FOREIGN KEY (label_id) REFERENCES label(label_id)
);

CREATE TABLE global_clustering_session
(
global_clustering_session_id SERIAL NOT NULL,
region_id INT NOT NULL,
time_created timestamp default current_timestamp NOT NULL,
PRIMARY KEY (global_clustering_session_id),
FOREIGN KEY (region_id) REFERENCES region(region_id)
);

CREATE TABLE global_attribute
(
global_attribute_id SERIAL NOT NULL,
global_clustering_session_id INT NOT NULL,
clustering_threshold DOUBLE PRECISION NOT NULL,
label_type_id INT NOT NULL,
region_id INT NOT NULL,
lat DOUBLE PRECISION NOT NULL,
lng DOUBLE PRECISION NOT NULL,
severity INT,
temporary BOOLEAN NOT NULL,
PRIMARY KEY (global_attribute_id),
FOREIGN KEY (global_clustering_session_id) REFERENCES global_clustering_session(global_clustering_session_id),
FOREIGN KEY (label_type_id) REFERENCES label_type(label_type_id),
FOREIGN KEY (region_id) REFERENCES region(region_id)
);

CREATE TABLE global_attribute_user_attribute
(
global_attribute_user_attribute_id SERIAL NOT NULL,
global_attribute_id INT NOT NULL,
user_attribute_id INT NOT NULL,
PRIMARY KEY (global_attribute_user_attribute_id),
FOREIGN KEY (user_attribute_id) REFERENCES user_attribute(user_attribute_id),
FOREIGN KEY (global_attribute_id) REFERENCES global_attribute(global_attribute_id)
);', 'DROP TABLE global_attribute_user_attribute;

DROP TABLE global_attribute;

DROP TABLE global_clustering_session;

DROP TABLE user_attribute_label;

DROP TABLE user_attribute;

DROP TABLE user_clustering_session;

DELETE FROM label_type WHERE label_type.label_type = ''Problem'';

CREATE TABLE accessibility_feature
(
accessibility_feature_id SERIAL NOT NULL,
geom public.geometry,
label_type_id INTEGER,
x DOUBLE PRECISION,
y DOUBLE PRECISION,
PRIMARY KEY (accessibility_feature_id),
FOREIGN KEY (label_type_id) REFERENCES label_type (label_type_id)
);

CREATE TABLE sidewalk_edge_accessibility_feature
(
sidewalk_edge_accessibility_feature_id SERIAL NOT NULL,
sidewalk_edge_id INTEGER,
accessibility_feature_id INTEGER,
PRIMARY KEY (accessibility_feature_id),
FOREIGN KEY (sidewalk_edge_id) REFERENCES sidewalk_edge (sidewalk_edge_id),
FOREIGN KEY (accessibility_feature_id) REFERENCES accessibility_feature (accessibility_feature_id)
);', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (14, '681faf9f4d33ee8fc8a4282ff504b3a2f8946834', '2019-01-28 00:00:00', 'CREATE TABLE tag
(
tag_id SERIAL NOT NULL,
label_type_id INT NOT NULL,
tag TEXT NOT NULL,
FOREIGN KEY (label_type_id) REFERENCES label_type(label_type_id),
PRIMARY KEY (tag_id)
);

CREATE TABLE label_tag
(
label_tag_id SERIAL NOT NULL,
label_id INT NOT NULL,
tag_id INT NOT NULL,
PRIMARY KEY (label_tag_id),
FOREIGN KEY (label_id) REFERENCES label(label_id),
FOREIGN KEY (tag_id) REFERENCES tag(tag_id)
);

INSERT INTO tag (label_type_id, tag) VALUES ( 1, ''narrow'' );
INSERT INTO tag (label_type_id, tag) VALUES ( 1, ''points into traffic'' );
INSERT INTO tag (label_type_id, tag) VALUES ( 1, ''missing friction strip'' );
INSERT INTO tag (label_type_id, tag) VALUES ( 1, ''steep'' );
INSERT INTO tag (label_type_id, tag) VALUES ( 2, ''alternate route present'' );
INSERT INTO tag (label_type_id, tag) VALUES ( 2, ''no alternate route'' );
INSERT INTO tag (label_type_id, tag) VALUES ( 2, ''unclear if needed'' );
INSERT INTO tag (label_type_id, tag) VALUES ( 3, ''trash can'' );
INSERT INTO tag (label_type_id, tag) VALUES ( 3, ''fire hydrant'' );
INSERT INTO tag (label_type_id, tag) VALUES ( 3, ''pole'' );
INSERT INTO tag (label_type_id, tag) VALUES ( 3, ''tree'' );
INSERT INTO tag (label_type_id, tag) VALUES ( 3, ''vegetation'' );
INSERT INTO tag (label_type_id, tag) VALUES ( 4, ''bumpy'' );
INSERT INTO tag (label_type_id, tag) VALUES ( 4, ''uneven'' );
INSERT INTO tag (label_type_id, tag) VALUES ( 4, ''cracks'' );
INSERT INTO tag (label_type_id, tag) VALUES ( 4, ''grass'' );
INSERT INTO tag (label_type_id, tag) VALUES ( 4, ''narrow sidewalk'' );
INSERT INTO tag (label_type_id, tag) VALUES ( 5, ''missing crosswalk'' );
INSERT INTO tag (label_type_id, tag) VALUES ( 5, ''no bus stop access'' );', 'DROP TABLE label_tag;

DROP TABLE tag;', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (15, '053ee8053696bf242f3328d46ab0b6ac037bfb8e', '2019-01-28 00:00:00', 'UPDATE role SET role = ''Registered'' WHERE role = ''User'';

INSERT INTO role VALUES ( 6, ''Anonymous'' );

TRUNCATE TABLE user_clustering_session CASCADE;
ALTER TABLE user_clustering_session
DROP COLUMN is_anonymous,
DROP COLUMN ip_address,
ALTER COLUMN user_id SET NOT NULL;', 'TRUNCATE TABLE user_clustering_session CASCADE;
ALTER TABLE user_clustering_session
ADD COLUMN is_anonymous BOOLEAN NOT NULL,
ADD COLUMN ip_address TEXT,
ALTER COLUMN user_id DROP NOT NULL;

UPDATE user_role SET role_id = 1 WHERE role_id = 6;
DELETE FROM role WHERE role = ''Anonymous'';

UPDATE role SET role = ''User'' WHERE role = ''Registered'';', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (16, '8ba76a53808779f9345fd40edcd5ce5cb77b325b', '2019-01-28 00:00:00', 'DROP TABLE mission_user;
DROP TABLE mission;

CREATE TABLE mission_type
(
mission_type_id SERIAL NOT NULL,
mission_type TEXT NOT NULL,
PRIMARY KEY (mission_type_id)
);

INSERT INTO "mission_type" ( "mission_type") VALUES ( ''auditOnboarding'' );
INSERT INTO "mission_type" ( "mission_type") VALUES ( ''audit'' );
INSERT INTO "mission_type" ( "mission_type") VALUES ( ''validationOnboarding'' );
INSERT INTO "mission_type" ( "mission_type") VALUES ( ''validation'' );

CREATE TABLE mission
(
mission_id SERIAL NOT NULL,
mission_type_id INT NOT NULL,
user_id TEXT NOT NULL,
mission_start TIMESTAMP NOT NULL,
mission_end TIMESTAMP NOT NULL,
completed BOOLEAN NOT NULL,
pay REAL NOT NULL DEFAULT 0.0,
paid BOOLEAN NOT NULL,
distance_meters DOUBLE PRECISION,
distance_progress DOUBLE PRECISION,
region_id INT,
labels_validated INT,
labels_progress INT,
skipped BOOLEAN NOT NULL,
PRIMARY KEY (mission_id),
FOREIGN KEY (mission_type_id) REFERENCES mission_type(mission_type_id),
FOREIGN KEY (user_id) REFERENCES sidewalk.user(user_id),
FOREIGN KEY (region_id) REFERENCES region(region_id)
);

TRUNCATE TABLE audit_task_comment;
TRUNCATE TABLE audit_task_interaction;
TRUNCATE TABLE audit_task_environment;
TRUNCATE TABLE audit_task_incomplete;

TRUNCATE TABLE user_attribute_label, label_tag, label;

ALTER TABLE audit_task_comment
ADD COLUMN audit_task_id INT NOT NULL,
ADD COLUMN mission_id INT NOT NULL,
ADD FOREIGN KEY (audit_task_id) REFERENCES audit_task(audit_task_id),
ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);

ALTER TABLE audit_task_interaction
ADD COLUMN mission_id INT NOT NULL,
ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);

ALTER TABLE audit_task_environment
ADD COLUMN mission_id INT NOT NULL,
ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);

ALTER TABLE audit_task_incomplete
ADD COLUMN mission_id INT NOT NULL,
ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);

ALTER TABLE label
ADD COLUMN mission_id INT NOT NULL,
ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);', 'ALTER TABLE label
DROP COLUMN mission_id;

ALTER TABLE audit_task_incomplete
DROP COLUMN mission_id;

ALTER TABLE audit_task_environment
DROP COLUMN mission_id;

ALTER TABLE audit_task_interaction
DROP COLUMN mission_id;

ALTER TABLE audit_task_comment
DROP COLUMN mission_id,
DROP COLUMN audit_task_id;

DROP TABLE mission;
DROP TABLE mission_type;

CREATE TABLE mission
(
mission_id SERIAL NOT NULL,
region_id INT,
label TEXT NOT NULL,
level INT NOT NULL,
deleted BOOLEAN DEFAULT false NOT NULL,
coverage DOUBLE PRECISION,
distance DOUBLE PRECISION,
distance_ft DOUBLE PRECISION,
distance_mi DOUBLE PRECISION,
PRIMARY KEY (mission_id)
);

CREATE TABLE mission_user
(
mission_user_id SERIAL NOT NULL,
mission_id INT NOT NULL,
user_id TEXT NOT NULL,
paid BOOLEAN NOT NULL DEFAULT FALSE,
pay_per_mile REAL NOT NULL DEFAULT 0.0,
PRIMARY KEY (mission_user_id),
FOREIGN KEY (mission_id) REFERENCES mission (mission_id),
FOREIGN KEY (user_id) REFERENCES sidewalk.user (user_id)
);', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (17, 'a2c12a7c7e8c8edc9c333ddefa40a6025103f0aa', '2019-01-28 00:00:00', 'ALTER TABLE problem_description RENAME COLUMN problem_description_id TO label_description_id;
ALTER TABLE problem_description RENAME TO label_description;

ALTER TABLE problem_severity RENAME COLUMN problem_severity_id TO label_severity_id;
ALTER TABLE problem_severity RENAME TO label_severity;

ALTER TABLE problem_temporariness RENAME COLUMN problem_temporariness_id TO label_temporariness_id;
ALTER TABLE problem_temporariness RENAME COLUMN temporary_problem TO temporary;
ALTER TABLE problem_temporariness RENAME TO label_temporariness;', 'ALTER TABLE label_temporariness RENAME TO problem_temporariness;
ALTER TABLE problem_temporariness RENAME COLUMN label_temporariness_id TO problem_temporariness_id;
ALTER TABLE problem_temporariness RENAME COLUMN temporary TO temporary_problem;

ALTER TABLE label_severity RENAME TO problem_severity;
ALTER TABLE problem_severity RENAME COLUMN label_severity_id TO problem_severity_id;

ALTER TABLE label_description RENAME TO problem_description;
ALTER TABLE problem_description RENAME COLUMN label_description_id TO problem_description_id;', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (18, '260e919c6be702266f1a0e421e92e0c863ce200c', '2019-01-28 00:00:00', 'DROP TABLE street_edge_assignment_count;', 'CREATE TABLE street_edge_assignment_count
(
street_edge_assignment_count_id SERIAL NOT NULL,
street_edge_id INT NOT NULL,
assignment_count INT NOT NULL,
completion_count INT NOT NULL,
FOREIGN KEY (street_edge_id) REFERENCES street_edge(street_edge_id),
PRIMARY KEY (street_edge_assignment_count_id)
);

INSERT INTO street_edge_assignment_count (street_edge_id, assignment_count, completion_count)
SELECT street_edge_id, 0, 0 FROM street_edge WHERE deleted = FALSE;', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (19, '489553004b15fb0b1d7e5d07983dd0cef5e2b606', '2019-01-28 00:00:00', 'ALTER TABLE "user" RENAME TO sidewalk_user;', 'ALTER TABLE sidewalk_user RENAME TO "user";', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (21, '3af579236282e92c1988b602c652167a2402b130', '2019-01-28 00:00:00', 'INSERT INTO version VALUES (''5.0.0'', now(), ''Overhaul mission infrastructure and anonymous user ids.'');', 'DELETE FROM version WHERE version_id = ''5.0.0'';', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (22, 'bcba55c26c6e5c47a0f7a01f8f0ee38c89657f9f', '2019-01-28 00:00:00', 'ALTER TABLE label ADD COLUMN tutorial BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE label SET tutorial = TRUE WHERE gsv_panorama_id IN (SELECT gsv_panorama_id FROM gsv_onboarding_pano WHERE has_labels = TRUE);

DROP TABLE gsv_onboarding_pano;', 'CREATE TABLE gsv_onboarding_pano
(
gsv_panorama_id TEXT NOT NULL,
has_labels BOOLEAN NOT NULL,
PRIMARY KEY (gsv_panorama_id)
);
INSERT INTO gsv_onboarding_pano VALUES (''stxXyCKAbd73DmkM2vsIHA'', TRUE);
INSERT INTO gsv_onboarding_pano VALUES (''PTHUzZqpLdS1nTixJMoDSw'', FALSE);
INSERT INTO gsv_onboarding_pano VALUES (''bdmGHJkiSgmO7_80SnbzXw'', TRUE);
INSERT INTO gsv_onboarding_pano VALUES (''OgLbmLAuC4urfE5o7GP_JQ'', TRUE);

ALTER TABLE label DROP COLUMN tutorial;', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (23, 'aca434d4738ca1ea3c37805a2b6e67a897785998', '2019-01-28 00:00:00', 'UPDATE survey_question
SET survey_question_text = ''How much have you been enjoying using Project Sidewalk?''
WHERE survey_question_id = 1;

UPDATE survey_question
SET survey_question_text = ''How easy or difficult is it to use Project Sidewalk?''
WHERE survey_question_id = 2;

UPDATE survey_question
SET survey_question_text = ''How well do you think you are performing on the labeling tasks?''
WHERE survey_question_id = 3;

UPDATE survey_question
SET survey_question_text = ''Why did you choose to contribute to Project Sidewalk?''
WHERE survey_question_id = 4;

UPDATE survey_question
SET survey_question_text = ''Do you have any feedback, design ideas, or questions?''
WHERE survey_question_id = 5;', 'UPDATE survey_question
SET survey_question_text = ''How much did you enjoy this task?''
WHERE survey_question_id = 1;

UPDATE survey_question
SET survey_question_text = ''How difficult did you find this task?''
WHERE survey_question_id = 2;

UPDATE survey_question
SET survey_question_text = ''How well do you think you did on this task?''
WHERE survey_question_id = 3;

UPDATE survey_question
SET survey_question_text = ''Why did you choose to contribute to Project Sidewalk?''
WHERE survey_question_id = 4;

UPDATE survey_question
SET survey_question_text = ''Do you have any feedback for us?''
WHERE survey_question_id = 5;', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (24, 'feec3f8bd2d04b30094ce6762a3fa807e732440a', '2019-01-28 00:00:00', 'ALTER TABLE street_edge DROP COLUMN source;
ALTER TABLE street_edge DROP COLUMN target;

DROP TABLE sidewalk_edge_sidewalk_node;
DROP TABLE sidewalk_edge_parent_edge;
DROP TABLE sidewalk_edge;
DROP TABLE sidewalk_node;
DROP TABLE street_edge_street_node;
DROP TABLE street_node;
DROP TABLE street_edge_parent_edge;

CREATE TABLE osm_way_street_edge (
osm_way_street_edge_id SERIAL NOT NULL,
osm_way_id INT NOT NULL,
street_edge_id INT NOT NULL,
FOREIGN KEY (street_edge_id) REFERENCES street_edge(street_edge_id),
PRIMARY KEY (osm_way_street_edge_id)
);', 'DROP TABLE osm_way_street_edge;

CREATE TABLE street_edge_parent_edge (
street_edge_parent_edge_id SERIAL NOT NULL,
street_edge_id INT NOT NULL,
parent_edge_id INT NOT NULL,
PRIMARY KEY (street_edge_parent_edge_id),
FOREIGN KEY (street_edge_id) REFERENCES street_edge(street_edge_id),
FOREIGN KEY (parent_edge_id) REFERENCES street_edge(street_edge_id)
);

CREATE TABLE street_node (
street_node_id integer NOT NULL,
geom public.geometry(Point,4326) NOT NULL,
lat double precision NOT NULL,
lng double precision NOT NULL,
PRIMARY KEY (street_node_id)
);

CREATE TABLE street_edge_street_node (
street_edge_id bigint NOT NULL,
street_node_id bigint NOT NULL,
street_edge_street_node_id integer DEFAULT nextval(''street_edge_street_node_id_seq''::regclass) NOT NULL,
PRIMARY KEY (street_edge_street_node_id),
FOREIGN KEY (street_edge_id) REFERENCES street_edge(street_edge_id),
FOREIGN KEY (street_node_id) REFERENCES street_node(street_node_id)
);

CREATE TABLE sidewalk_node (
id_0 integer NOT NULL,
geom public.geometry(Point, 4326),
lat double precision,
way_ids character varying,
lng double precision,
sidewalk_node_id character varying,
PRIMARY KEY (id_0)
);

CREATE TABLE sidewalk_edge (
geom public.geometry(LineString, 4326),
y1 double precision,
x2 double precision,
x1 double precision,
sidewalk_edge_id integer NOT NULL,
y2 double precision,
way_type character varying,
source integer,
target integer,
deleted boolean DEFAULT false,
"timestamp" timestamp with time zone DEFAULT timezone(''utc''::text, now()),
PRIMARY KEY (sidewalk_edge_id),
FOREIGN KEY (source) REFERENCES sidewalk_node(id_0),
FOREIGN KEY (target) REFERENCES sidewalk_node(id_0)
);

CREATE TABLE sidewalk_edge_parent_edge (
sidewalk_edge_id bigint NOT NULL,
parent_edge_id bigint,
FOREIGN KEY (sidewalk_edge_id) REFERENCES sidewalk_edge(sidewalk_edge_id),
FOREIGN KEY (parent_edge_id) REFERENCES sidewalk_edge(sidewalk_edge_id)
);

CREATE TABLE sidewalk_edge_sidewalk_node (
sidewalk_edge_id bigint NOT NULL,
sidewalk_node_id bigint,
FOREIGN KEY (sidewalk_edge_id) REFERENCES sidewalk_edge(sidewalk_edge_id),
FOREIGN KEY (sidewalk_node_id) REFERENCES sidewalk_node(id_0)
);

ALTER TABLE street_edge
ADD COLUMN source INT,
ADD COLUMN target INT,
ADD CONSTRAINT street_edge_source_idx FOREIGN KEY (source) REFERENCES street_node(street_node_id),
ADD CONSTRAINT street_edge_target_idx FOREIGN KEY (target) REFERENCES street_node(street_node_id);', 'applied', '');
INSERT INTO sidewalk.play_evolutions (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (25, 'd816fdf88a4c1bfcb1e6335cddb28ebf27ee7cf0', '2019-01-28 00:00:00', 'CREATE TABLE validation_options (
validation_option_id INT NOT NULL,
text TEXT NOT NULL,
PRIMARY KEY (validation_option_id)
);

CREATE TABLE validation_task_interaction (
validation_task_interaction_id SERIAL,
action TEXT NOT NULL,
gsv_panorama_id VARCHAR(64),
lat DOUBLE PRECISION,
lng DOUBLE PRECISION,
heading DOUBLE PRECISION,
pitch DOUBLE PRECISION,
zoom DOUBLE PRECISION,
note TEXT,
timestamp TIMESTAMPTZ,
mission_id INT
);

CREATE TABLE label_validation (
label_validation_id SERIAL,
label_id INT NOT NULL,
validation_result INT NOT NULL,
user_id TEXT NOT NULL,
mission_id INT NOT NULL,
canvas_x INT NOT NULL,
canvas_y INT NOT NULL,
heading DOUBLE PRECISION NOT NULL,
pitch DOUBLE PRECISION NOT NULL,
zoom DOUBLE PRECISION NOT NULL,
canvas_height INT NOT NULL,
canvas_width INT NOT NULL,
start_timestamp TIMESTAMPTZ,
end_timestamp TIMESTAMPTZ,
PRIMARY KEY (label_validation_id),
FOREIGN KEY (label_id) REFERENCES label(label_id),
FOREIGN KEY (validation_result) REFERENCES validation_options(validation_option_id),
FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id),
FOREIGN KEY (mission_id) REFERENCES mission(mission_id)
);

CREATE TABLE validation_task_comment (
validation_task_comment_id SERIAL,
mission_id INT NOT NULL,
label_id INT NOT NULL,
user_id TEXT NOT NULL,
ip_address TEXT NOT NULL,
gsv_panorama_id TEXT NOT NULL,
heading DOUBLE PRECISION NOT NULL,
pitch DOUBLE PRECISION NOT NULL,
zoom INT NOT NULL,
lat DOUBLE PRECISION NOT NULL,
lng DOUBLE PRECISION NOT NULL,
timestamp TIMESTAMPTZ,
comment TEXT NOT NULL,
PRIMARY KEY (validation_task_comment_id),
FOREIGN KEY (mission_id) REFERENCES mission(mission_id),
FOREIGN KEY (label_id) REFERENCES label(label_id),
FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id)
);

INSERT INTO validation_options (validation_option_id, text) VALUES (1, ''agree'');
INSERT INTO validation_options (validation_option_id, text) VALUES (2, ''disagree'');
INSERT INTO validation_options (validation_option_id, text) VALUES (3, ''unclear'');

ALTER TABLE gsv_data
ADD COLUMN expired BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN last_viewed TIMESTAMPTZ;', 'DROP TABLE label_validation;
DROP TABLE validation_options;
DROP TABLE validation_task_interaction;
DROP TABLE validation_task_comment;

ALTER TABLE gsv_data
DROP COLUMN expired,
DROP COLUMN last_viewed;', 'applied', '');

--
-- updates
--

UPDATE sidewalk.survey_question
SET survey_question_text = 'How much have you been enjoying using Project Sidewalk?'
WHERE survey_question_id = 1;

UPDATE sidewalk.survey_question
SET survey_question_text = 'How easy or difficult is it to use Project Sidewalk?'
WHERE survey_question_id = 2;

UPDATE sidewalk.survey_question
SET survey_question_text = 'How well do you think you are performing on the labeling tasks?'
WHERE survey_question_id = 3;

UPDATE sidewalk.survey_question
SET survey_question_text = 'Why did you choose to contribute to Project Sidewalk?'
WHERE survey_question_id = 4;

UPDATE sidewalk.survey_question
SET survey_question_text = 'Do you have any feedback, design ideas, or questions?'
WHERE survey_question_id = 5;

--
-- PostgreSQL database dump complete
--
