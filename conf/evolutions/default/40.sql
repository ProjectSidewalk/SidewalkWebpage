# --- !Ups
CREATE TABLE mission_progress_cvgroundtruth (
    item_id bigserial primary key,
    linked_mission_id integer REFERENCES mission(mission_id),
    panoid varchar(64),
    completed boolean,
    lat double precision,
    lng double precision
);

INSERT INTO "mission_type" ( "mission_type") VALUES ( 'cvGroundTruth' );

# --- !Downs
DROP TABLE mission_progress_cvgroundtruth;

DELETE
FROM audit_task_interaction
WHERE mission_id IN (
    SELECT mission_id
    FROM mission
    INNER JOIN mission_type ON mission.mission_type_id = mission_type.mission_type_id
    WHERE mission_type.mission_type = 'cvGroundTruth'
);

DELETE
FROM audit_task_environment
WHERE mission_id IN (
    SELECT mission_id
    FROM mission
    INNER JOIN mission_type ON mission.mission_type_id = mission_type.mission_type_id
    WHERE mission_type.mission_type = 'cvGroundTruth'
);

DELETE
FROM label
WHERE mission_id IN (
    SELECT mission_id
    FROM mission
    INNER JOIN mission_type ON mission.mission_type_id = mission_type.mission_type_id
    WHERE mission_type.mission_type = 'cvGroundTruth'
);

DELETE
FROM mission
WHERE mission_type_id IN (
    SELECT mission_type_id
    FROM mission_type
    WHERE mission_type = 'cvGroundTruth'
);

DELETE
FROM "sidewalk"."mission_type"
WHERE "mission_type" = 'cvGroundTruth'

