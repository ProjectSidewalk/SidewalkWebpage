
# --- !Ups
INSERT INTO mission (region_id, label, level, deleted, coverage, distance, distance_ft, distance_mi)
SELECT region_id, label, level, deleted, coverage, distance/2, distance_ft/2, distance_mi/2
FROM mission
WHERE deleted = 'f' and distance_ft = 1000;

INSERT INTO mission (region_id, label, level, deleted, coverage, distance, distance_ft, distance_mi)
SELECT region_id, label, level, deleted, coverage/2, distance, distance_ft, distance_mi
FROM (
  SELECT m1.region_id, m1.label, m1.level, m1.deleted, m2.coverage, m1.distance, m1.distance_ft, m1.distance_mi
  FROM mission m1 INNER JOIN mission m2 ON m1.region_id = m2.region_id
  WHERE m1.deleted = 'f' AND m2.deleted = 'f' AND m1.distance_ft = 1000 AND m2.distance_ft = 2000 
) m3;

# --- !Downs
DELETE FROM mission
WHERE deleted = 'f' AND distance_ft = 500;

DELETE FROM mission
WHERE deleted = 'f' AND distance_ft = 1000 AND coverage IS NOT NULL
