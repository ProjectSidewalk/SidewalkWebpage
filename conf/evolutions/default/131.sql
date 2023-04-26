# --- !Ups
SELECT setval('tag_tag_id_seq', (SELECT MAX(tag_id) from "tag"));

-- Remove 'paint not fading' tag for crosswalks.
DELETE FROM label_tag
USING tag, label_type
WHERE label_tag.tag_id = tag.tag_id
    AND tag.label_type_id = label_type.label_type_id
    AND label_type.label_type = 'Crosswalk'
    AND tag.tag = 'paint not fading';

DELETE FROM tag
USING label_type
WHERE tag.label_type_id = label_type.label_type_id
    AND label_type.label_type = 'Crosswalk'
    AND tag.tag = 'paint not fading';

-- Add 'rail/tram track', 'painted sidewalk' and 'utility panel' tag for surface problems.
-- Note: do not remove 'utility panel' as in every city
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'rail/tram track' FROM label_type WHERE label_type.label_type = 'SurfaceProblem';
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'painted sidewalk' FROM label_type WHERE label_type.label_type = 'SurfaceProblem';
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'utility panel' FROM label_type WHERE label_type.label_type = 'SurfaceProblem';

-- Add 'broken surface', 'uneven surface' and 'too close to traffic' tags for crosswalks.
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'broken surface' FROM label_type WHERE label_type.label_type = 'Crosswalk';
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'uneven surface' FROM label_type WHERE label_type.label_type = 'Crosswalk';
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'too close to traffic' FROM label_type WHERE label_type.label_type = 'Crosswalk';

-- Add 'litter/garbage', 'parked scooter/motorcycle' and 'pedestrian arcade' tags for obstacles.
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'litter/garbage' FROM label_type WHERE label_type.label_type = 'Obstacle';
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'parked scooter/motorcycle' FROM label_type WHERE label_type.label_type = 'Obstacle';
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'pedestrian arcade' FROM label_type WHERE label_type.label_type = 'Obstacle';


# --- !Downs
SELECT setval('tag_tag_id_seq', (SELECT MAX(tag_id) from "tag"));

-- Remove 'litter/garbage', 'parked scooter/motorcycle' and 'pedestrian arcade' tags for obstacles.
DELETE FROM label_tag
USING tag, label_type
WHERE label_tag.tag_id = tag.tag_id
    AND tag.label_type_id = label_type.label_type_id
    AND label_type.label_type = 'Obstacle'
    AND tag.tag IN ('litter/garbage', 'parked scooter/motorcycle', 'pedestrian arcade');

DELETE FROM tag
USING label_type
WHERE tag.label_type_id = label_type.label_type_id
    AND label_type.label_type = 'Obstacle'
    AND tag.tag IN ('litter/garbage', 'parked scooter/motorcycle', 'pedestrian arcade');

-- Remove 'broken surface', 'uneven surface' and 'too close to traffic' tags for crosswalks.
DELETE FROM label_tag
USING tag, label_type
WHERE label_tag.tag_id = tag.tag_id
    AND tag.label_type_id = label_type.label_type_id
    AND label_type.label_type = 'Crosswalk'
    AND tag.tag IN ('broken surface', 'uneven surface', 'too close to traffic');

DELETE FROM tag
USING label_type
WHERE tag.label_type_id = label_type.label_type_id
    AND label_type.label_type = 'Crosswalk'
    AND tag.tag IN ('broken surface', 'uneven surface', 'too close to traffic');

-- Remove 'rail/tram track' and 'painted sidewalk' tag for surface problems.
DELETE FROM label_tag
USING tag, label_type
WHERE label_tag.tag_id = tag.tag_id
    AND tag.label_type_id = label_type.label_type_id
    AND label_type.label_type = 'SurfaceProblem'
    AND tag.tag IN ('rail/tram track', 'painted sidewalk');

DELETE FROM tag
USING label_type
WHERE tag.label_type_id = label_type.label_type_id
    AND label_type.label_type = 'SurfaceProblem'
    AND tag.tag IN ('rail/tram track', 'painted sidewalk');

-- Add 'paint not fading' tag for crosswalks.
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'paint not fading' FROM label_type WHERE label_type.label_type = 'Crosswalk';