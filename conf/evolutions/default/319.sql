# --- !Ups
ALTER TABLE pano_data ADD COLUMN has_backup BOOLEAN;

CREATE TYPE viewer_type AS ENUM ('Default', 'Pannellum', 'StaticApi', 'StaticCrop');
ALTER TABLE label_validation ADD COLUMN viewer_type viewer_type;

-- GalleryImage and GalleryThumbs are card-level static image validations, everything else used the live viewer.
UPDATE label_validation
SET viewer_type = CASE
    WHEN source IN ('GalleryImage', 'GalleryThumbs') THEN 'StaticApi'::viewer_type
    ELSE 'Default'::viewer_type
END;

ALTER TABLE label_validation ALTER COLUMN viewer_type SET NOT NULL;

# --- !Downs
ALTER TABLE label_validation DROP COLUMN viewer_type;
DROP TYPE viewer_type;

ALTER TABLE pano_data DROP COLUMN has_backup;
