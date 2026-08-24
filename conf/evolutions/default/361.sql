# --- !Ups
-- #2575: label_edit is the source of truth for every change to a label's severity or tags after its creation -- who,
-- from what, to what, and where -- whether submitted with a vote (label_validation_id set, so the vote's undo unwinds
-- it) or made on its own from the label popup. label_history stays the derived state log, linked by label_edit_id.
CREATE TABLE label_edit (
  label_edit_id SERIAL NOT NULL,
  label_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  old_severity INTEGER,
  new_severity INTEGER,
  old_tags TEXT[] NOT NULL,
  new_tags TEXT[] NOT NULL,
  source ui_source NOT NULL,
  edit_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  label_validation_id INTEGER,
  -- Bookkeeping for the backfill below, dropped once label_history has been linked.
  migrated_from_history_id INTEGER,
  PRIMARY KEY (label_edit_id),
  FOREIGN KEY (label_id) REFERENCES label (label_id),
  FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id),
  -- A vote carries at most one edit: the change submitted with it.
  CONSTRAINT label_edit_label_validation_id_key UNIQUE (label_validation_id),
  FOREIGN KEY (label_validation_id) REFERENCES label_validation (label_validation_id),
  CONSTRAINT label_edit_old_severity_check CHECK (old_severity IS NULL OR old_severity BETWEEN 1 AND 3),
  CONSTRAINT label_edit_new_severity_check CHECK (new_severity IS NULL OR new_severity BETWEEN 1 AND 3),
  -- An edit must change something, with tags compared as sets because their stored order is client-driven. The app
  -- keeps this true by folding a user's consecutive edits to a label into one row and deleting the row if they net
  -- out.
  CONSTRAINT label_edit_not_noop_check
    CHECK (old_severity IS DISTINCT FROM new_severity OR NOT (old_tags <@ new_tags AND new_tags <@ old_tags))
);
ALTER TABLE label_edit OWNER TO sidewalk;
CREATE INDEX label_edit_label_id_idx ON label_edit (label_id);
CREATE INDEX label_edit_user_id_idx ON label_edit (user_id);
CREATE INDEX label_edit_edit_time_idx ON label_edit (edit_time);

-- Backfill: every label_history row after a label's creation row is an edit from the previous row's state to its own.
-- The previous row, not the vote's old_* columns, supplies the old state: a vote's old_* is whatever the client had
-- loaded, stale whenever someone else edited the label in between. Rows recording no change get no edit and are
-- removed below, as the consistency passes in 298/304/355 did.
INSERT INTO label_edit (label_id, user_id, old_severity, new_severity, old_tags, new_tags, source, edit_time,
                        label_validation_id, migrated_from_history_id)
SELECT label_id, edited_by, prev_severity, severity, prev_tags, tags, source, edit_time, label_validation_id,
       label_history_id
FROM (
  SELECT label_history_id, label_id, severity, tags, edited_by, edit_time, source, label_validation_id,
         row_number() OVER per_label AS position,
         LAG(severity) OVER per_label AS prev_severity,
         LAG(tags) OVER per_label AS prev_tags
  FROM label_history
  WINDOW per_label AS (PARTITION BY label_id ORDER BY edit_time, label_history_id)
) AS ordered
WHERE position > 1
  AND (prev_severity IS DISTINCT FROM severity OR NOT (prev_tags <@ tags AND tags <@ prev_tags));

ALTER TABLE label_history ADD COLUMN label_edit_id INTEGER;

UPDATE label_history
SET label_edit_id = label_edit.label_edit_id
FROM label_edit
WHERE label_edit.migrated_from_history_id = label_history.label_history_id;

-- The no-op rows: past the creation row and not linked to an edit by the backfill.
DELETE FROM label_history
USING (
  SELECT label_history_id,
         row_number() OVER (PARTITION BY label_id ORDER BY edit_time, label_history_id) AS position
  FROM label_history
) AS ordered
WHERE ordered.label_history_id = label_history.label_history_id
  AND ordered.position > 1
  AND label_history.label_edit_id IS NULL;

ALTER TABLE label_edit DROP COLUMN migrated_from_history_id;

ALTER TABLE label_history
  ADD CONSTRAINT label_history_label_edit_id_fkey FOREIGN KEY (label_edit_id) REFERENCES label_edit (label_edit_id),
  ADD CONSTRAINT label_history_label_edit_id_key UNIQUE (label_edit_id);

ALTER TABLE label_history DROP COLUMN label_validation_id;

ALTER TABLE label_validation
  DROP COLUMN old_severity,
  DROP COLUMN new_severity,
  DROP COLUMN old_tags,
  DROP COLUMN new_tags;

# --- !Downs
ALTER TABLE label_validation
  ADD COLUMN old_severity INTEGER,
  ADD COLUMN new_severity INTEGER,
  ADD COLUMN old_tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN new_tags TEXT[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT label_validation_old_severity_check CHECK (old_severity IS NULL OR old_severity BETWEEN 1 AND 3),
  ADD CONSTRAINT label_validation_new_severity_check CHECK (new_severity IS NULL OR new_severity BETWEEN 1 AND 3);

-- A vote that carried no edit recorded the label's then-current values on both sides, for which the label's current
-- values are the closest available stand-in. Votes that did carry an edit are then overwritten with the exact
-- old/new state.
UPDATE label_validation
SET old_severity = label.severity,
    new_severity = label.severity,
    old_tags     = label.tags,
    new_tags     = label.tags
FROM label
WHERE label.label_id = label_validation.label_id;

UPDATE label_validation
SET old_severity = label_edit.old_severity,
    new_severity = label_edit.new_severity,
    old_tags     = label_edit.old_tags,
    new_tags     = label_edit.new_tags
FROM label_edit
WHERE label_edit.label_validation_id = label_validation.label_validation_id;

ALTER TABLE label_history ADD COLUMN label_validation_id INTEGER;

UPDATE label_history
SET label_validation_id = label_edit.label_validation_id
FROM label_edit
WHERE label_edit.label_edit_id = label_history.label_edit_id;

ALTER TABLE label_history
  ADD CONSTRAINT label_history_label_validation_id_fkey
    FOREIGN KEY (label_validation_id) REFERENCES label_validation (label_validation_id);
CREATE INDEX label_history_label_validation_id_idx ON label_history (label_validation_id);

ALTER TABLE label_history DROP COLUMN label_edit_id;

DROP TABLE label_edit;
