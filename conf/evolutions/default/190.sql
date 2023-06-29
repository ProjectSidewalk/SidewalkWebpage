# --- !Ups
-- Mark all labels with 'painted sidewalk' or 'pedestrian arcade' as deleted.
UPDATE label
SET deleted = TRUE
FROM label_tag
INNER JOIN tag ON label_tag.tag_id = tag.tag_id
INNER JOIN label_type ON tag.label_type_id = label_type.label_type_id
WHERE label.label_id = label_tag.label_id
    AND (
        label_type.label_type = 'SurfaceProblem' AND tag.tag = 'painted sidewalk'
        OR label_type.label_type = 'Obstacle' AND tag.tag = 'pedestrian arcade'
    );

-- Delete all label_tag entries for 'painted sidewalk' or 'pedestrian arcade'.
DELETE FROM label_tag
USING tag
INNER JOIN label_type ON tag.label_type_id = label_type.label_type_id
WHERE label_tag.tag_id = tag.tag_id
    AND (
        label_type.label_type = 'SurfaceProblem' AND tag.tag = 'painted sidewalk'
        OR label_type.label_type = 'Obstacle' AND tag.tag = 'pedestrian arcade'
    );

-- Rename tags to 'pedestrian lane marking' and 'covered walkway', change label_type for both to 'NoSidewalk'.
UPDATE tag
SET label_type_id = (SELECT label_type_id FROM label_type WHERE label_type = 'NoSidewalk'),
    tag = 'pedestrian lane marking'
WHERE tag = 'painted sidewalk'
    AND label_type_id = (SELECT label_type_id FROM label_type WHERE label_type = 'SurfaceProblem');

UPDATE tag
SET label_type_id = (SELECT label_type_id FROM label_type WHERE label_type = 'NoSidewalk'),
    tag = 'covered walkway'
WHERE tag = 'pedestrian arcade'
    AND label_type_id = (SELECT label_type_id FROM label_type WHERE label_type = 'Obstacle');

# --- !Downs
UPDATE label
SET deleted = TRUE
FROM label_tag
INNER JOIN tag ON label_tag.tag_id = tag.tag_id
INNER JOIN label_type ON tag.label_type_id = label_type.label_type_id
WHERE label.label_id = label_tag.label_id
  AND label_type.label_type = 'NoSidewalk'
  AND tag.tag IN ('pedestrian lane marking', 'covered walkway');

DELETE FROM label_tag
USING tag
INNER JOIN label_type ON tag.label_type_id = label_type.label_type_id
WHERE label_tag.tag_id = tag.tag_id
  AND label_type.label_type = 'NoSidewalk'
  AND tag.tag IN ('pedestrian lane marking', 'covered walkway');

UPDATE tag
SET label_type_id = (SELECT label_type_id FROM label_type WHERE label_type = 'SurfaceProblem'),
    tag = 'painted sidewalk'
WHERE tag = 'pedestrian lane marking'
  AND label_type_id = (SELECT label_type_id FROM label_type WHERE label_type = 'NoSidewalk');

UPDATE tag
SET label_type_id = (SELECT label_type_id FROM label_type WHERE label_type = 'Obstacle'),
    tag = 'pedestrian arcade'
WHERE tag = 'covered walkway'
  AND label_type_id = (SELECT label_type_id FROM label_type WHERE label_type = 'NoSidewalk');
