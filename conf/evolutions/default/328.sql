# --- !Ups
-- Rename the JSONB key label_type_id to label_type inside clustering_session.thresholds so the Slick reader and writer
-- agree on one key name (#4364). Before this fix the writer emitted label_type_id while the reader expected label_type,
-- so any read path threw JsResultException on existing rows. The stored value was always a label-type name string
-- (CurbRamp, Obstacle, ...), never a numeric id, so label_type_id was a misnomer -- this aligns on the correct name.
-- Each array element gets the key renamed in place with its value preserved.
UPDATE clustering_session
SET thresholds = (
    SELECT jsonb_agg((elem - 'label_type_id') || jsonb_build_object('label_type', elem -> 'label_type_id'))
    FROM jsonb_array_elements(thresholds) AS elem
)
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(thresholds) AS elem WHERE elem ? 'label_type_id');

# --- !Downs
UPDATE clustering_session
SET thresholds = (
    SELECT jsonb_agg((elem - 'label_type') || jsonb_build_object('label_type_id', elem -> 'label_type'))
    FROM jsonb_array_elements(thresholds) AS elem
)
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(thresholds) AS elem WHERE elem ? 'label_type');
