# --- !Ups

-- Add 'painted sidewalk' and 'utility panel' tag for surface problems.
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 61, label_type_id, 'painted sidewalk' FROM label_type WHERE label_type.label_type = 'SurfaceProblem';
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 62, label_type_id, 'utility panel' FROM label_type WHERE label_type.label_type = 'SurfaceProblem';

-- Add 'too close to traffic' tag for crosswalks.
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 63, label_type_id, 'too close to traffic' FROM label_type WHERE label_type.label_type = 'Crosswalk';

-- Add 'pedestrian arcade' tag for obstacles.
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 64, label_type_id, 'pedestrian arcade' FROM label_type WHERE label_type.label_type = 'Obstacle';


# --- !Downs

-- Remove 'pedestrian arcade' tag for obstacles.
DELETE FROM label_tag
    USING tag, label_type
WHERE label_tag.tag_id = tag.tag_id
  AND tag.label_type_id = label_type.label_type_id
  AND label_type.label_type = 'Obstacle'
  AND tag.tag IN ('pedestrian arcade');

DELETE FROM tag
    USING label_type
WHERE tag.label_type_id = label_type.label_type_id
  AND label_type.label_type = 'Obstacle'
  AND tag.tag IN ('pedestrian arcade');

-- Remove 'too close to traffic' tag for crosswalks.
DELETE FROM label_tag
    USING tag, label_type
WHERE label_tag.tag_id = tag.tag_id
  AND tag.label_type_id = label_type.label_type_id
  AND label_type.label_type = 'Crosswalk'
  AND tag.tag IN ('too close to traffic');

DELETE FROM tag
    USING label_type
WHERE tag.label_type_id = label_type.label_type_id
  AND label_type.label_type = 'Crosswalk'
  AND tag.tag IN ('too close to traffic');

-- Remove 'painted sidewalk' and 'utility panel' tags for surface problems.
DELETE FROM label_tag
    USING tag, label_type
WHERE label_tag.tag_id = tag.tag_id
  AND tag.label_type_id = label_type.label_type_id
  AND label_type.label_type = 'SurfaceProblem'
  AND tag.tag IN ('painted sidewalk', 'utility panel');

DELETE FROM tag
    USING label_type
WHERE tag.label_type_id = label_type.label_type_id
  AND label_type.label_type = 'SurfaceProblem'
  AND tag.tag IN ('painted sidewalk', 'utility panel');
