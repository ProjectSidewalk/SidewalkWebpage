# --- !Ups
-- Convert the label_type lookup table into a `label_type` Postgres enum (#4103), retiring label_type_id everywhere
-- (label, cluster, mission, tag). This kills the hand-maintained id map in LabelTypeEnum that nothing validated, and
-- the join to label_type that most label queries carried.
--
-- The per-table conversions below map ids to names from a hardcoded CASE rather than from each schema's own table
-- (which is gone by then), so first assert that the table is exactly that map: nine rows, canonical ids and names
-- (the retired 'Problem' row, id 8, went in 357.sql along with its clusters). The second check exists because
-- mission.label_type_id is nullable, so a CASE miss there would silently null the column rather than trip NOT NULL as
-- it would on the other three tables.
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM label_type) <> 9
     OR EXISTS (SELECT 1 FROM label_type
                WHERE (label_type_id, label_type) NOT IN ((1, 'CurbRamp'), (2, 'NoCurbRamp'), (3, 'Obstacle'),
                                                          (4, 'SurfaceProblem'), (5, 'Other'), (6, 'Occlusion'),
                                                          (7, 'NoSidewalk'), (9, 'Crosswalk'), (10, 'Signal'))) THEN
    RAISE EXCEPTION 'label_type does not match the canonical label type id to name map, so 373.sql cannot run';;
  END IF;;
  IF EXISTS (SELECT 1 FROM label WHERE label_type_id NOT IN (1, 2, 3, 4, 5, 6, 7, 9, 10))
     OR EXISTS (SELECT 1 FROM cluster WHERE label_type_id NOT IN (1, 2, 3, 4, 5, 6, 7, 9, 10))
     OR EXISTS (SELECT 1 FROM mission WHERE label_type_id NOT IN (1, 2, 3, 4, 5, 6, 7, 9, 10))
     OR EXISTS (SELECT 1 FROM tag WHERE label_type_id NOT IN (1, 2, 3, 4, 5, 6, 7, 9, 10)) THEN
    RAISE EXCEPTION 'a row references a label_type_id outside the canonical set, so 373.sql cannot run';;
  END IF;;
  -- 245.sql added this UNIQUE unconditionally, so every schema should have it. Checked up front because the RENAME
  -- at the end has no IF EXISTS, and a miss there would abort with the four tables already rewritten.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'tag_label_type_id_tag_unique' AND conrelid = 'tag'::regclass) THEN
    RAISE EXCEPTION 'tag has no tag_label_type_id_tag_unique constraint to rename, so 373.sql cannot run';;
  END IF;;
END $$;

-- IF EXISTS because the FKs were added unevenly across deployments (#3574, #4589). The lookup table must be dropped
-- before CREATE TYPE, since tables and types share a namespace.
ALTER TABLE label DROP CONSTRAINT IF EXISTS label_label_type_id_fkey;
ALTER TABLE cluster DROP CONSTRAINT IF EXISTS cluster_label_type_id_fkey;
ALTER TABLE mission DROP CONSTRAINT IF EXISTS mission_label_type_id_fkey;
ALTER TABLE tag DROP CONSTRAINT IF EXISTS tag_label_type_id_fkey;
DROP TABLE label_type;
-- Declared in LabelTypeEnum.ordered's order (by prominence, not by the old ids), because an enum's declaration order
-- is its sort order and can't be changed later without another rewrite of every table that uses it.
CREATE TYPE label_type AS ENUM
  ('CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'Crosswalk', 'Signal', 'NoSidewalk', 'Occlusion', 'Other');

-- Each ALTER COLUMN TYPE rewrites its table once, so the cost is one pass over label (hundreds of thousands of rows
-- on the biggest schemas) plus its index rebuilds. The CASE has no ELSE on purpose: an id the assertion above missed
-- lands as NULL and trips NOT NULL instead of being silently relabeled.
ALTER TABLE label
  ALTER COLUMN label_type_id TYPE label_type
  USING (CASE label_type_id
    WHEN 1 THEN 'CurbRamp'
    WHEN 2 THEN 'NoCurbRamp'
    WHEN 3 THEN 'Obstacle'
    WHEN 4 THEN 'SurfaceProblem'
    WHEN 5 THEN 'Other'
    WHEN 6 THEN 'Occlusion'
    WHEN 7 THEN 'NoSidewalk'
    WHEN 9 THEN 'Crosswalk'
    WHEN 10 THEN 'Signal'
  END)::label_type;
ALTER TABLE label RENAME COLUMN label_type_id TO label_type;
ALTER INDEX IF EXISTS label_label_type_id_idx RENAME TO label_label_type_idx;

ALTER TABLE cluster
  ALTER COLUMN label_type_id TYPE label_type
  USING (CASE label_type_id
    WHEN 1 THEN 'CurbRamp'
    WHEN 2 THEN 'NoCurbRamp'
    WHEN 3 THEN 'Obstacle'
    WHEN 4 THEN 'SurfaceProblem'
    WHEN 5 THEN 'Other'
    WHEN 6 THEN 'Occlusion'
    WHEN 7 THEN 'NoSidewalk'
    WHEN 9 THEN 'Crosswalk'
    WHEN 10 THEN 'Signal'
  END)::label_type;
ALTER TABLE cluster RENAME COLUMN label_type_id TO label_type;
ALTER INDEX IF EXISTS cluster_label_type_id_idx RENAME TO cluster_label_type_idx;

-- Stays nullable: only validation missions carry a label type.
ALTER TABLE mission
  ALTER COLUMN label_type_id TYPE label_type
  USING (CASE label_type_id
    WHEN 1 THEN 'CurbRamp'
    WHEN 2 THEN 'NoCurbRamp'
    WHEN 3 THEN 'Obstacle'
    WHEN 4 THEN 'SurfaceProblem'
    WHEN 5 THEN 'Other'
    WHEN 6 THEN 'Occlusion'
    WHEN 7 THEN 'NoSidewalk'
    WHEN 9 THEN 'Crosswalk'
    WHEN 10 THEN 'Signal'
  END)::label_type;
ALTER TABLE mission RENAME COLUMN label_type_id TO label_type;
ALTER INDEX IF EXISTS mission_label_type_id_idx RENAME TO mission_label_type_idx;

ALTER TABLE tag
  ALTER COLUMN label_type_id TYPE label_type
  USING (CASE label_type_id
    WHEN 1 THEN 'CurbRamp'
    WHEN 2 THEN 'NoCurbRamp'
    WHEN 3 THEN 'Obstacle'
    WHEN 4 THEN 'SurfaceProblem'
    WHEN 5 THEN 'Other'
    WHEN 6 THEN 'Occlusion'
    WHEN 7 THEN 'NoSidewalk'
    WHEN 9 THEN 'Crosswalk'
    WHEN 10 THEN 'Signal'
  END)::label_type;
ALTER TABLE tag RENAME COLUMN label_type_id TO label_type;
-- Renaming the UNIQUE constraint renames its backing index with it.
ALTER TABLE tag RENAME CONSTRAINT tag_label_type_id_tag_unique TO tag_label_type_tag_unique;

# --- !Downs
ALTER TABLE tag RENAME CONSTRAINT tag_label_type_tag_unique TO tag_label_type_id_tag_unique;
ALTER TABLE tag RENAME COLUMN label_type TO label_type_id;
ALTER TABLE tag
  ALTER COLUMN label_type_id TYPE INT
  USING (CASE label_type_id
    WHEN 'CurbRamp' THEN 1
    WHEN 'NoCurbRamp' THEN 2
    WHEN 'Obstacle' THEN 3
    WHEN 'SurfaceProblem' THEN 4
    WHEN 'Other' THEN 5
    WHEN 'Occlusion' THEN 6
    WHEN 'NoSidewalk' THEN 7
    WHEN 'Crosswalk' THEN 9
    WHEN 'Signal' THEN 10
  END);

ALTER INDEX IF EXISTS mission_label_type_idx RENAME TO mission_label_type_id_idx;
ALTER TABLE mission RENAME COLUMN label_type TO label_type_id;
ALTER TABLE mission
  ALTER COLUMN label_type_id TYPE INT
  USING (CASE label_type_id
    WHEN 'CurbRamp' THEN 1
    WHEN 'NoCurbRamp' THEN 2
    WHEN 'Obstacle' THEN 3
    WHEN 'SurfaceProblem' THEN 4
    WHEN 'Other' THEN 5
    WHEN 'Occlusion' THEN 6
    WHEN 'NoSidewalk' THEN 7
    WHEN 'Crosswalk' THEN 9
    WHEN 'Signal' THEN 10
  END);

ALTER INDEX IF EXISTS cluster_label_type_idx RENAME TO cluster_label_type_id_idx;
ALTER TABLE cluster RENAME COLUMN label_type TO label_type_id;
ALTER TABLE cluster
  ALTER COLUMN label_type_id TYPE INT
  USING (CASE label_type_id
    WHEN 'CurbRamp' THEN 1
    WHEN 'NoCurbRamp' THEN 2
    WHEN 'Obstacle' THEN 3
    WHEN 'SurfaceProblem' THEN 4
    WHEN 'Other' THEN 5
    WHEN 'Occlusion' THEN 6
    WHEN 'NoSidewalk' THEN 7
    WHEN 'Crosswalk' THEN 9
    WHEN 'Signal' THEN 10
  END);

ALTER INDEX IF EXISTS label_label_type_idx RENAME TO label_label_type_id_idx;
ALTER TABLE label RENAME COLUMN label_type TO label_type_id;
ALTER TABLE label
  ALTER COLUMN label_type_id TYPE INT
  USING (CASE label_type_id
    WHEN 'CurbRamp' THEN 1
    WHEN 'NoCurbRamp' THEN 2
    WHEN 'Obstacle' THEN 3
    WHEN 'SurfaceProblem' THEN 4
    WHEN 'Other' THEN 5
    WHEN 'Occlusion' THEN 6
    WHEN 'NoSidewalk' THEN 7
    WHEN 'Crosswalk' THEN 9
    WHEN 'Signal' THEN 10
  END);

DROP TYPE label_type;
-- Rebuilt at the ids the Ups asserted, so a Down followed by a fresh Up round-trips exactly.
CREATE TABLE label_type (
  label_type_id SERIAL PRIMARY KEY,
  label_type TEXT NOT NULL
);
ALTER TABLE label_type OWNER TO sidewalk;
INSERT INTO label_type (label_type_id, label_type)
VALUES (1, 'CurbRamp'), (2, 'NoCurbRamp'), (3, 'Obstacle'), (4, 'SurfaceProblem'), (5, 'Other'), (6, 'Occlusion'),
  (7, 'NoSidewalk'), (9, 'Crosswalk'), (10, 'Signal');
SELECT setval('label_type_label_type_id_seq', 10);
ALTER TABLE label ADD CONSTRAINT label_label_type_id_fkey
  FOREIGN KEY (label_type_id) REFERENCES label_type (label_type_id);
ALTER TABLE cluster ADD CONSTRAINT cluster_label_type_id_fkey
  FOREIGN KEY (label_type_id) REFERENCES label_type (label_type_id);
ALTER TABLE mission ADD CONSTRAINT mission_label_type_id_fkey
  FOREIGN KEY (label_type_id) REFERENCES label_type (label_type_id);
ALTER TABLE tag ADD CONSTRAINT tag_label_type_id_fkey
  FOREIGN KEY (label_type_id) REFERENCES label_type (label_type_id);
