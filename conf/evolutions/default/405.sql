# --- !Ups
-- Government places (town halls, courthouses, public-facing government offices) join the place catalog, for the
-- AccessScore map. PlaceCategory (Scala) is the catalog, and PlaceTableSpec holds it to this CHECK.
ALTER TABLE place DROP CONSTRAINT place_category_check;
ALTER TABLE place ADD CONSTRAINT place_category_check
    CHECK (category IN ('school', 'health', 'library', 'grocery', 'transit', 'park', 'community', 'government'));

# --- !Downs
DELETE FROM place WHERE category = 'government';
ALTER TABLE place DROP CONSTRAINT place_category_check;
ALTER TABLE place ADD CONSTRAINT place_category_check
    CHECK (category IN ('school', 'health', 'library', 'grocery', 'transit', 'park', 'community'));
