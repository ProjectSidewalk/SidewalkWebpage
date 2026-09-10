# --- !Ups
-- Sidewalk presence per block face (#5279). One row per (street, side): what the labels say about whether that side
-- of that street has a sidewalk. The #5222 study (Planning PR #20) measured the rule below against Seattle's
-- per-face sidewalk inventory: a face with one NoSidewalk label lacks a sidewalk 69% of the time, with two 80%,
-- with three or more 84%, and an audited face with none has a sidewalk 96% of the time. Pooling NoSidewalk labels per
-- street instead of per face, as AccessScore does, is right on only 56% of its "no sidewalk" calls, because most
-- streets that lack a sidewalk lack it on one side.
--
-- The side is label_point.street_side (377.sql): left or right of the street's digitized direction, NULL within a
-- meter of the centerline. Only sided labels count. Obstacle and SurfaceProblem labels never veto a NoSidewalk call:
-- a third of the faces the inventory marks unimproved carry them, and their tags (parked car, gravel, bins) describe
-- the roadway people walk in. CurbRamp and NoCurbRamp are corner features whose face is ambiguous, and they are not
-- evidence either way.
--
-- The derivation below is the same one SidewalkPresenceTable.derivationSql holds, so the nightly rebuild reproduces
-- these rows exactly (SidewalkPresenceTableSpec checks that). Both faces of every street get a row, whatever the
-- street's status, so an unaudited face can answer "unknown" rather than be missing.
CREATE TYPE sidewalk_presence_status AS ENUM ('present', 'absent', 'unknown');
CREATE TYPE sidewalk_presence_basis AS ENUM ('no_sidewalk_labels', 'other_side_tag', 'audited_no_labels', 'unaudited');

CREATE TABLE sidewalk_presence (
    street_edge_id INTEGER NOT NULL REFERENCES street_edge(street_edge_id) ON DELETE CASCADE,
    street_side street_side NOT NULL,
    presence sidewalk_presence_status NOT NULL,
    presence_basis sidewalk_presence_basis NOT NULL,
    no_sidewalk_label_count INTEGER NOT NULL CHECK (no_sidewalk_label_count >= 0),
    no_sidewalk_user_count INTEGER NOT NULL CHECK (no_sidewalk_user_count >= 0),
    label_count INTEGER NOT NULL CHECK (label_count >= 0),
    audit_count INTEGER NOT NULL CHECK (audit_count >= 0),
    first_no_sidewalk_label_at TIMESTAMPTZ,
    last_no_sidewalk_label_at TIMESTAMPTZ,
    PRIMARY KEY (street_edge_id, street_side),
    -- The verdict is a function of the basis, and the basis of the counts. Pinned so a rebuild bug cannot store a row
    -- that contradicts itself. Named by what they assert, since Postgres already takes <table>_<column>_check for
    -- the inline column checks above.
    CONSTRAINT sidewalk_presence_verdict_matches_basis_check CHECK (
        (presence = 'absent' AND presence_basis IN ('no_sidewalk_labels', 'other_side_tag'))
        OR (presence = 'present' AND presence_basis = 'audited_no_labels')
        OR (presence = 'unknown' AND presence_basis = 'unaudited')
    ),
    CONSTRAINT sidewalk_presence_basis_matches_count_check CHECK (
        (presence_basis = 'no_sidewalk_labels') = (no_sidewalk_label_count >= 1)
    ),
    CONSTRAINT sidewalk_presence_unaudited_means_no_audits_check CHECK (presence_basis <> 'unaudited' OR audit_count = 0),
    CONSTRAINT sidewalk_presence_count_ordering_check CHECK (
        no_sidewalk_user_count <= no_sidewalk_label_count AND no_sidewalk_label_count <= label_count
    ),
    CONSTRAINT sidewalk_presence_dates_match_count_check CHECK (
        ((first_no_sidewalk_label_at IS NULL) = (no_sidewalk_label_count = 0))
        AND ((last_no_sidewalk_label_at IS NULL) = (no_sidewalk_label_count = 0))
        AND first_no_sidewalk_label_at <= last_no_sidewalk_label_at
    )
);
ALTER TABLE sidewalk_presence OWNER TO sidewalk;

-- Derive every existing city's faces. Prod scale: one pass over label hash-joined to label_point on its primary key,
-- a hash aggregate to ~55k faces, one filtered pass over audit_task, and hash joins on the aggregates, taking
-- seconds per schema. The label counts are cast to INTEGER so a later comparison against the stored row is type-for-type.
WITH face AS (
    SELECT street_edge.street_edge_id, sides.street_side
    FROM street_edge
    CROSS JOIN (VALUES ('left'::street_side), ('right'::street_side)) AS sides(street_side)
),
sided_label AS (
    SELECT label.street_edge_id, label_point.street_side, label.label_type, label.user_id, label.time_created,
           label.tags
    FROM label
    INNER JOIN label_point ON label.label_id = label_point.label_id
    WHERE NOT label.deleted AND NOT label.tutorial AND label_point.street_side IS NOT NULL
),
face_label AS (
    SELECT street_edge_id, street_side,
           COUNT(*) AS label_count,
           COUNT(*) FILTER (WHERE label_type = 'NoSidewalk') AS no_sidewalk_label_count,
           COUNT(DISTINCT user_id) FILTER (WHERE label_type = 'NoSidewalk') AS no_sidewalk_user_count,
           COUNT(*) FILTER (WHERE label_type = 'NoSidewalk' AND 'street has no sidewalks' = ANY(tags))
               AS no_sidewalks_tag_count,
           MIN(time_created) FILTER (WHERE label_type = 'NoSidewalk') AS first_no_sidewalk_label_at,
           MAX(time_created) FILTER (WHERE label_type = 'NoSidewalk') AS last_no_sidewalk_label_at
    FROM sided_label
    GROUP BY street_edge_id, street_side
),
street_audit AS (
    SELECT street_edge_id, COUNT(*) AS audit_count
    FROM audit_task
    WHERE completed
    GROUP BY street_edge_id
),
-- Precedence is the study's tiering: the face's own NoSidewalk labels, then a "street has no sidewalks" tag on the
-- other face (78% when the face itself is unlabeled), then audited-without-labels means present.
face_basis AS (
    SELECT face.street_edge_id, face.street_side,
           CASE WHEN COALESCE(this_face.no_sidewalk_label_count, 0) >= 1 THEN 'no_sidewalk_labels'
                WHEN COALESCE(other_face.no_sidewalks_tag_count, 0) >= 1 THEN 'other_side_tag'
                WHEN COALESCE(street_audit.audit_count, 0) >= 1 THEN 'audited_no_labels'
                ELSE 'unaudited' END AS presence_basis,
           COALESCE(this_face.no_sidewalk_label_count, 0)::INTEGER AS no_sidewalk_label_count,
           COALESCE(this_face.no_sidewalk_user_count, 0)::INTEGER AS no_sidewalk_user_count,
           COALESCE(this_face.label_count, 0)::INTEGER AS label_count,
           COALESCE(street_audit.audit_count, 0)::INTEGER AS audit_count,
           this_face.first_no_sidewalk_label_at,
           this_face.last_no_sidewalk_label_at
    FROM face
    LEFT JOIN face_label this_face
        ON face.street_edge_id = this_face.street_edge_id AND face.street_side = this_face.street_side
    LEFT JOIN face_label other_face
        ON face.street_edge_id = other_face.street_edge_id AND face.street_side <> other_face.street_side
    LEFT JOIN street_audit ON face.street_edge_id = street_audit.street_edge_id
),
derived_face AS (
    SELECT street_edge_id, street_side,
           CASE presence_basis
                WHEN 'audited_no_labels' THEN 'present'
                WHEN 'unaudited' THEN 'unknown'
                ELSE 'absent' END::sidewalk_presence_status AS presence,
           presence_basis::sidewalk_presence_basis AS presence_basis,
           no_sidewalk_label_count, no_sidewalk_user_count, label_count, audit_count,
           first_no_sidewalk_label_at, last_no_sidewalk_label_at
    FROM face_basis
)
INSERT INTO sidewalk_presence (street_edge_id, street_side, presence, presence_basis, no_sidewalk_label_count,
                               no_sidewalk_user_count, label_count, audit_count, first_no_sidewalk_label_at,
                               last_no_sidewalk_label_at)
SELECT street_edge_id, street_side, presence, presence_basis, no_sidewalk_label_count, no_sidewalk_user_count,
       label_count, audit_count, first_no_sidewalk_label_at, last_no_sidewalk_label_at
FROM derived_face;

# --- !Downs
DROP TABLE IF EXISTS sidewalk_presence;
DROP TYPE IF EXISTS sidewalk_presence_basis;
DROP TYPE IF EXISTS sidewalk_presence_status;
