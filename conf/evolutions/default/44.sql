# --- !Ups
ALTER TABLE label_validation ALTER COLUMN canvas_x DROP NOT NULL;
ALTER TABLE label_validation ALTER COLUMN canvas_y DROP NOT NULL;

# --- !Downs
UPDATE label_validation SET canvas_x = -1 WHERE canvas_x IS NULL;
UPDATE label_validation SET canvas_y = -1 WHERE canvas_y IS NULL;

ALTER TABLE label_validation ALTER COLUMN canvas_x SET NOT NULL;
ALTER TABLE label_validation ALTER COLUMN canvas_y SET NOT NULL;
