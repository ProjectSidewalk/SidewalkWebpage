# --- !Ups
ALTER TABLE gsv_data
    DROP COLUMN center_heading,
    DROP COLUMN origin_heading,
    DROP COLUMN origin_pitch;

ALTER TABLE label
    ADD COLUMN severity INT,
    ADD COLUMN temporary BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN description TEXT;

UPDATE label SET severity = label_severity.severity FROM label_severity WHERE label.label_id = label_severity.label_id;
DROP TABLE label_severity;

UPDATE label SET temporary = label_temporariness.temporary FROM label_temporariness WHERE label.label_id = label_temporariness.label_id;
DROP TABLE label_temporariness;

UPDATE label SET description = label_description.description
FROM label_description
WHERE label.label_id = label_description.label_id
    AND label_description.description <> '';
DROP TABLE label_description;

# --- !Downs
CREATE TABLE label_description (
       label_description_id SERIAL NOT NULL,
       label_id INT NOT NULL,
       description TEXT NOT NULL,
       PRIMARY KEY (label_description_id),
       FOREIGN KEY (label_id) REFERENCES label(label_id)
);
INSERT INTO label_description (label_id, description) SELECT label_id, description FROM label WHERE description IS NOT NULL;

CREATE TABLE label_temporariness (
         label_temporariness_id SERIAL NOT NULL,
         label_id INT NOT NULL,
         temporary BOOLEAN NOT NULL,
         PRIMARY KEY (label_temporariness_id),
         FOREIGN KEY (label_id) REFERENCES label(label_id)
);
INSERT INTO label_temporariness (label_id, temporary) SELECT label_id, temporary FROM label WHERE temporary = TRUE;

CREATE TABLE label_severity (
    label_severity_id SERIAL NOT NULL,
    label_id INT NOT NULL,
    severity INT NOT NULL,
    PRIMARY KEY (label_severity_id),
    FOREIGN KEY (label_id) REFERENCES label(label_id)
);
INSERT INTO label_severity (label_id, severity) SELECT label_id, severity FROM label WHERE severity IS NOT NULL;

ALTER TABLE label
    DROP COLUMN severity,
    DROP COLUMN temporary,
    DROP COLUMN description;

ALTER TABLE gsv_data
    ADD COLUMN center_heading FLOAT,
    ADD COLUMN origin_heading FLOAT,
    ADD COLUMN origin_pitch FLOAT;
