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

# --- !Downs
CREATE TABLE region_property (
    region_property_id SERIAL NOT NULL,
    region_id integer NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    PRIMARY KEY (region_property_id),
    FOREIGN KEY (region_id) REFERENCES region(region_id)
);
INSERT INTO region_property (region_id, key, value)
    SELECT region_id, 'Neighborhood Name', description FROM region;

CREATE TABLE region_type (
    region_type_id SERIAL NOT NULL,
    region_type character varying(2044) COLLATE pg_catalog."POSIX" NOT NULL,
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
