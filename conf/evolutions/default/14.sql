
# --- !Ups
INSERT INTO label_type VALUES (8, 'Problem', 'Composite type: represents cluster of NoCurbRamp, Obstacle, and/or SurfaceProblem labels');


# --- !Downs
DELETE FROM label_type WHERE label_type.label_type = 'Problem';
