# --- !Ups
DELETE FROM region WHERE region_type_id = 1;

ALTER TABLE region DROP COLUMN region_type_id;

DROP TABLE region_type;

UPDATE region
    SET description = (
        SELECT value
        FROM region_property
        WHERE region_property.region_id = region.region_id
          AND key = 'Neighborhood Name'
        LIMIT 1
    );

DROP TABLE region_property;

DROP TABLE gsv_location;

DROP TABLE gsv_model;

DROP TABLE gsv_projection;

# --- !Downs
CREATE TABLE gsv_projection (
    gsv_panorama_id CHARACTER VARYING(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    projection_type CHARACTER VARYING(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    pano_yaw_deg DOUBLE PRECISION NOT NULL,
    tilt_yaw_deg DOUBLE PRECISION NOT NULL,
    tilt_pitch_deg DOUBLE PRECISION NOT NULL,
    CONSTRAINT gsv_panorama_projection_pkey PRIMARY KEY (gsv_panorama_id)
);

CREATE TABLE gsv_model (
    gsv_panorama_id CHARACTER VARYING(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    depth_map TEXT COLLATE pg_catalog."POSIX" NOT NULL,
    pano_map TEXT COLLATE pg_catalog."POSIX" NOT NULL,
    CONSTRAINT gsv_model_pkey PRIMARY KEY (gsv_panorama_id)
);

CREATE TABLE gsv_location (
    gsv_panorama_id CHARACTER VARYING(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    zoom_levels INTEGER NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    original_lat DOUBLE PRECISION NOT NULL,
    original_lng DOUBLE PRECISION NOT NULL,
    elevation_wgs84_m DOUBLE PRECISION NOT NULL,
    description CHARACTER VARYING(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    street_range INTEGER,
    region CHARACTER VARYING(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    country CHARACTER VARYING(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    elevation_egm96_m DOUBLE PRECISION NOT NULL,
    CONSTRAINT gsv_location_pkey PRIMARY KEY (gsv_panorama_id)
);

CREATE TABLE region_property (
    region_property_id SERIAL NOT NULL,
    region_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (region_property_id),
    FOREIGN KEY (region_id) REFERENCES region(region_id)
);
INSERT INTO region_property (region_id, key, value)
SELECT region_id, 'Neighborhood Name', description FROM region;

CREATE TABLE region_type (
    region_type_id SERIAL NOT NULL,
    region_type CHARACTER VARYING(2044) COLLATE pg_catalog."POSIX" NOT NULL,
    PRIMARY KEY (region_type_id)
);
INSERT INTO region_type (region_type) VALUES ('city');
INSERT INTO region_type (region_type) VALUES ('neighborhood');

ALTER TABLE region
    ADD COLUMN region_type_id INT;
UPDATE region
    SET region_type_id = 2;
ALTER TABLE region
    ALTER COLUMN region_type_id SET NOT NULL,
    ADD FOREIGN KEY (region_type_id) REFERENCES region_type(region_type_id);
