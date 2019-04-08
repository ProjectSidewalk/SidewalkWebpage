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

