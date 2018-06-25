
# --- !Ups
INSERT INTO label_type VALUES (8, 'Problem', 'Composite type: represents cluster of NoCurbRamp, Obstacle, and/or SurfaceProblem labels');


# --- !Downs
DELETE FROM global_attribute_user_attribute
WHERE global_attribute_id IN ( SELECT global_attribute_id FROM global_attribute WHERE label_type_id = 8 )
    OR user_attribute_id IN ( SELECT user_attribute_id FROM user_attribute WHERE label_type_id = 8 );

DELETE FROM global_attribute WHERE label_type_id = 8;

DELETE FROM user_attribute_label
WHERE user_attribute_id IN ( SELECT user_attribute_id FROM user_attribute WHERE label_type_id = 8 );

DELETE FROM user_attribute WHERE label_type_id = 8;

DELETE FROM label_type WHERE label_type.label_type = 'Problem';
