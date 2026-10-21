# --- !Ups
-- #5076: validator comment text is destroyed rather than versioned, on three paths. Saving a comment is a
-- delete-then-insert, which is how validation_task_comment_label_id_user_id_unique (359.sql) is enforced, so fixing a
-- typo overwrites the earlier wording. Clearing or changing a vote drops the comment that rode in with it. The label
-- card's Delete control (#5015) removes it outright. webpage_activity keeps only the fact of the change, never a
-- character of the text, so a validator's own words are the part that cannot be reconstructed.
--
-- A history table rather than a `deleted` flag. A flag has nothing to say about text replaced in place, the
-- highest-volume loss of the three, and a soft-deleted row would still occupy the (label_id, user_id) pair 359.sql
-- made UNIQUE, forcing that constraint into a partial index three evolutions after it was added. label_history is
-- the precedent: a user-authored value whose earlier states are research data.
--
-- Append-only. Even an explicit Delete removes the comment from every read path in the tool and adds a row here
-- rather than erasing it. If a contributor ever asks for their words to be gone, that is a hand-run cleanup.

-- edit: superseded by new text from the same user, typed on the label card or carried in with a new vote.
-- delete: the user asked for it to be removed, via the label card's Delete control.
-- validation_change: the user's vote was cleared or replaced with no new comment. Kept distinct from delete because
-- it is not a request to erase anything, and which of the two happened is what a later reader cannot recover.
CREATE TYPE validation_comment_change_type AS ENUM ('edit', 'delete', 'validation_change');

-- Mirrors the validation_task_comment row it supersedes, pano and pose included, so a version can still be shown
-- where it was written.
CREATE TABLE validation_task_comment_history (
  validation_task_comment_history_id SERIAL PRIMARY KEY,
  -- Deliberately no FK: the row it names is gone, which is the event this table records. Kept because it is the id
  -- the comment was known by, including in the response to the POST that created it.
  validation_task_comment_id INT NOT NULL,
  mission_id INT NOT NULL REFERENCES mission (mission_id),
  label_id INT NOT NULL REFERENCES label (label_id),
  user_id TEXT NOT NULL REFERENCES sidewalk_user (user_id),
  ip_address TEXT NOT NULL,
  pano_id TEXT NOT NULL REFERENCES pano_data (pano_id),
  heading DOUBLE PRECISION NOT NULL,
  pitch DOUBLE PRECISION NOT NULL,
  zoom DOUBLE PRECISION NOT NULL,
  -- Deliberately no lat/lng CHECK, though the bounded domain would earn one on a table taking fresh input: an
  -- archive may never be stricter than its source. validation_task_comment has no such CHECK, so a row failing one
  -- here is a row that can never be archived, leaving that user's edit and delete on the label failing forever.
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  -- Copied from the row, and client-supplied on the Validate path, so it is the validator's clock while
  -- superseded_at is the database's -- compare the two across rows, not within one.
  timestamp TIMESTAMPTZ NOT NULL,
  comment TEXT NOT NULL,
  superseded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_type validation_comment_change_type NOT NULL
);
ALTER TABLE validation_task_comment_history OWNER TO sidewalk;

-- Every read is one user's comment history on one label, the pair validation_task_comment is keyed by, so the live
-- row joins on it too. Ordering within a pair is left to a sort of the handful of rows one pair has.
CREATE INDEX validation_task_comment_history_label_id_user_id_idx
  ON validation_task_comment_history (label_id, user_id);

# --- !Downs
DROP TABLE validation_task_comment_history;
-- Tables and types share a namespace, so the type can only go once nothing references it.
DROP TYPE validation_comment_change_type;
