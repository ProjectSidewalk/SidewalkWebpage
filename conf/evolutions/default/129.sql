# --- !Ups
SELECT setval('label_type_label_type_id_seq', (SELECT MAX(label_type_id) from "label_type"));
INSERT INTO label_type (label_type, description) VALUES ('Crosswalk', 'Crosswalk');
INSERT INTO label_type (label_type, description) VALUES ('Signal', 'Pedestrian Signal');

SELECT setval('tag_tag_id_seq', (SELECT MAX(tag_id) from "tag"));
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'paint fading' FROM label_type WHERE label_type.label_type = 'Crosswalk';
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'paint not fading' FROM label_type WHERE label_type.label_type = 'Crosswalk';
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'has button' FROM label_type WHERE label_type.label_type = 'Signal';
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'button waist height' FROM label_type WHERE label_type.label_type = 'Signal';

# --- !Downs
DELETE FROM label_tag
USING tag, label_type
WHERE label_tag.tag_id = tag.tag_id
    AND tag.label_type_id = label_type.label_type_id
    AND label_type.label_type IN ('Crosswalk', 'Signal');

DELETE FROM tag
USING label_type
WHERE tag.label_type_id = label_type.label_type_id
    AND label_type.label_type IN ('Crosswalk', 'Signal');

-- Delete everything else that can be associated with the labels created with the label types we remove here.
TRUNCATE TABLE global_clustering_session CASCADE;
TRUNCATE TABLE user_clustering_session CASCADE;

DELETE FROM validation_task_comment
USING mission, label_type
WHERE validation_task_comment.mission_id = mission.mission_id
    AND mission.label_type_id = label_type.label_type_id
    AND label_type.label_type IN ('Crosswalk', 'Signal');

DELETE FROM validation_task_environment
USING mission, label_type
WHERE validation_task_environment.mission_id = mission.mission_id
    AND mission.label_type_id = label_type.label_type_id
    AND label_type.label_type IN ('Crosswalk', 'Signal');

DELETE FROM validation_task_interaction
USING mission, label_type
WHERE validation_task_interaction.mission_id = mission.mission_id
  AND mission.label_type_id = label_type.label_type_id
  AND label_type.label_type IN ('Crosswalk', 'Signal');

DELETE FROM label_validation
USING mission, label_type
WHERE label_validation.mission_id = mission.mission_id
  AND mission.label_type_id = label_type.label_type_id
  AND label_type.label_type IN ('Crosswalk', 'Signal');

DELETE FROM mission
USING label_type
WHERE mission.label_type_id = label_type.label_type_id
  AND label_type.label_type IN ('Crosswalk', 'Signal');

DELETE FROM label_temporariness
USING label, label_type
WHERE label_temporariness.label_id = label.label_id
    AND label.label_type_id = label_type.label_type_id
    AND label_type.label_type IN ('Crosswalk', 'Signal');

DELETE FROM label_description
USING label, label_type
WHERE label_description.label_id = label.label_id
  AND label.label_type_id = label_type.label_type_id
  AND label_type.label_type IN ('Crosswalk', 'Signal');

DELETE FROM label_severity
USING label, label_type
WHERE label_severity.label_id = label.label_id
  AND label.label_type_id = label_type.label_type_id
  AND label_type.label_type IN ('Crosswalk', 'Signal');

DELETE FROM label_point
USING label, label_type
WHERE label_point.label_id = label.label_id
  AND label.label_type_id = label_type.label_type_id
  AND label_type.label_type IN ('Crosswalk', 'Signal');

DELETE FROM label
USING label_type
WHERE label.label_type_id = label_type.label_type_id
  AND label_type.label_type IN ('Crosswalk', 'Signal');

DELETE FROM label_type WHERE label_type.label_type IN ('Crosswalk', 'Signal');

