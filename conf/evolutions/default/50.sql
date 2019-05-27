# --- !Ups
INSERT INTO mission_type (mission_type_id, mission_type) VALUES (6, 'rapidValidation' );

# --- !Downs
DELETE FROM mission_type WHERE mission_type = 'rapidValidation';