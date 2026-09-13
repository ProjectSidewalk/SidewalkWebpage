# --- !Ups
-- Validation feeds back into sidewalk presence (#5285). Validate now serves NoSidewalk labels per block face, so a
-- face's labels start carrying validator verdicts (label.correct) worth exposing and acting on:
--   validated_no_sidewalk_count: NoSidewalk labels on the face validators confirmed. The strongest evidence a face
--     can carry, and the API's new top confidence tier (minValidatedNoSidewalkLabels).
--   rejected_no_sidewalk_count: NoSidewalk labels validators rejected. A rejected call is not evidence, so these
--     leave every other NoSidewalk count, the dates, and the other-side tag test, and a face whose every NoSidewalk
--     label was rejected falls through to the next rule -- usually audited_no_labels, so present. They still count in
--     label_count. No new enum value is needed for that, which matters because ALTER TYPE ... ADD VALUE cannot be
--     used in the same transaction that populates with it.
-- Every CHECK from 383.sql keeps holding, since the counts that feed them are all filtered the same way. The new one
-- pins the validated count inside the counted NoSidewalk labels.
--
-- The derivation below supersedes 383.sql's and is the same one SidewalkPresenceTable.derivationSql holds, so the
-- nightly rebuild reproduces these rows exactly (SidewalkPresenceTableSpec checks that). The table is repopulated
-- outright rather than diffed: it is a derived cache, and a full pass is seconds per schema at prod scale (one pass
-- over label hash-joined to label_point, a hash aggregate to ~55k faces).
ALTER TABLE sidewalk_presence
  ADD COLUMN validated_no_sidewalk_count INTEGER NOT NULL DEFAULT 0 CHECK (validated_no_sidewalk_count >= 0),
  ADD COLUMN rejected_no_sidewalk_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_no_sidewalk_count >= 0),
  ADD CONSTRAINT sidewalk_presence_validated_within_labels_check
    CHECK (validated_no_sidewalk_count <= no_sidewalk_label_count);

DELETE FROM sidewalk_presence;

WITH face AS (
    SELECT street_edge.street_edge_id, sides.street_side
    FROM street_edge
    CROSS JOIN (VALUES ('left'::street_side), ('right'::street_side)) AS sides(street_side)
),
sided_label AS (
    SELECT label.street_edge_id, label_point.street_side, label.label_type, label.user_id, label.time_created,
           label.tags,
           label.label_type = 'NoSidewalk' AND label.correct IS DISTINCT FROM FALSE AS counted_no_sidewalk,
           label.label_type = 'NoSidewalk' AND label.correct AS validated_no_sidewalk,
           label.label_type = 'NoSidewalk' AND NOT label.correct AS rejected_no_sidewalk
    FROM label
    INNER JOIN label_point ON label.label_id = label_point.label_id
    LEFT JOIN user_stat ON label.user_id = user_stat.user_id
    WHERE NOT label.deleted AND NOT label.tutorial AND label_point.street_side IS NOT NULL
      AND NOT COALESCE(user_stat.excluded, FALSE)
),
face_label AS (
    SELECT street_edge_id, street_side,
           COUNT(*) AS label_count,
           COUNT(*) FILTER (WHERE counted_no_sidewalk) AS no_sidewalk_label_count,
           COUNT(DISTINCT user_id) FILTER (WHERE counted_no_sidewalk) AS no_sidewalk_user_count,
           COUNT(*) FILTER (WHERE validated_no_sidewalk) AS validated_no_sidewalk_count,
           COUNT(*) FILTER (WHERE rejected_no_sidewalk) AS rejected_no_sidewalk_count,
           COUNT(*) FILTER (WHERE counted_no_sidewalk AND 'street has no sidewalks' = ANY(tags))
               AS no_sidewalks_tag_count,
           MIN(time_created) FILTER (WHERE counted_no_sidewalk) AS first_no_sidewalk_label_at,
           MAX(time_created) FILTER (WHERE counted_no_sidewalk) AS last_no_sidewalk_label_at
    FROM sided_label
    GROUP BY street_edge_id, street_side
),
street_audit AS (
    SELECT audit_task.street_edge_id, COUNT(*) AS audit_count
    FROM audit_task
    LEFT JOIN user_stat ON audit_task.user_id = user_stat.user_id
    WHERE audit_task.completed AND NOT COALESCE(user_stat.excluded, FALSE)
    GROUP BY audit_task.street_edge_id
),
face_basis AS (
    SELECT face.street_edge_id, face.street_side,
           CASE WHEN COALESCE(this_face.no_sidewalk_label_count, 0) >= 1 THEN 'no_sidewalk_labels'
                WHEN COALESCE(other_face.no_sidewalks_tag_count, 0) >= 1 THEN 'other_side_tag'
                WHEN COALESCE(street_audit.audit_count, 0) >= 1 THEN 'audited_no_labels'
                ELSE 'unaudited' END AS presence_basis,
           COALESCE(this_face.no_sidewalk_label_count, 0)::INTEGER AS no_sidewalk_label_count,
           COALESCE(this_face.no_sidewalk_user_count, 0)::INTEGER AS no_sidewalk_user_count,
           COALESCE(this_face.validated_no_sidewalk_count, 0)::INTEGER AS validated_no_sidewalk_count,
           COALESCE(this_face.rejected_no_sidewalk_count, 0)::INTEGER AS rejected_no_sidewalk_count,
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
           no_sidewalk_label_count, no_sidewalk_user_count, validated_no_sidewalk_count,
           rejected_no_sidewalk_count, label_count, audit_count, first_no_sidewalk_label_at,
           last_no_sidewalk_label_at
    FROM face_basis
)
INSERT INTO sidewalk_presence (street_edge_id, street_side, presence, presence_basis, no_sidewalk_label_count,
                               no_sidewalk_user_count, validated_no_sidewalk_count, rejected_no_sidewalk_count,
                               label_count, audit_count, first_no_sidewalk_label_at, last_no_sidewalk_label_at)
SELECT street_edge_id, street_side, presence, presence_basis, no_sidewalk_label_count, no_sidewalk_user_count,
       validated_no_sidewalk_count, rejected_no_sidewalk_count, label_count, audit_count, first_no_sidewalk_label_at,
       last_no_sidewalk_label_at
FROM derived_face;

# --- !Downs
-- The rows must agree with the code about to read them, which counts rejected labels as evidence again: drop the
-- columns, then re-derive every face the 383.sql way.
ALTER TABLE sidewalk_presence
  DROP CONSTRAINT IF EXISTS sidewalk_presence_validated_within_labels_check,
  DROP COLUMN IF EXISTS validated_no_sidewalk_count,
  DROP COLUMN IF EXISTS rejected_no_sidewalk_count;

DELETE FROM sidewalk_presence;

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
    LEFT JOIN user_stat ON label.user_id = user_stat.user_id
    WHERE NOT label.deleted AND NOT label.tutorial AND label_point.street_side IS NOT NULL
      AND NOT COALESCE(user_stat.excluded, FALSE)
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
    SELECT audit_task.street_edge_id, COUNT(*) AS audit_count
    FROM audit_task
    LEFT JOIN user_stat ON audit_task.user_id = user_stat.user_id
    WHERE audit_task.completed AND NOT COALESCE(user_stat.excluded, FALSE)
    GROUP BY audit_task.street_edge_id
),
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
