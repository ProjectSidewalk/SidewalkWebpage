-- 58.sql inserted mission_type 6 with an explicit id, so the sequence still points at 5 and 68's sequence-assigned
-- insert collides (issue #4700). Prod's sequence had been advanced by app inserts in between; the sandbox's hasn't.
-- Same repair 129.sql later makes for tag/label_type.
SELECT setval('mission_type_mission_type_id_seq', (SELECT MAX(mission_type_id) FROM mission_type));
