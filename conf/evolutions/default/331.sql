# --- !Ups
-- New ui_source value for validations submitted from the landing-page validation grid (#1638). Adding a value inside
-- a transaction is fine on PG 12+ as long as the same transaction doesn't use it, and this evolution doesn't.
ALTER TYPE ui_source ADD VALUE 'LandingPage' BEFORE 'Old data, unknown source';

# --- !Downs
-- Postgres can't remove an enum value, so remap any rows using it and rebuild the type without it. No views or
-- indexes depend on the three source columns, so the column type swaps are unobstructed.
UPDATE label_validation SET source = 'Old data, unknown source' WHERE source = 'LandingPage';
UPDATE label_history SET source = 'Old data, unknown source' WHERE source = 'LandingPage';
UPDATE validation_task_interaction SET source = 'Old data, unknown source' WHERE source = 'LandingPage';

ALTER TYPE ui_source RENAME TO ui_source_old;
CREATE TYPE ui_source AS ENUM (
    'Explore', 'Validate', 'ExpertValidate', 'ValidateMobile', 'AdminValidate', 'LabelMap', 'GalleryImage',
    'GalleryExpandedImage', 'GalleryThumbs', 'GalleryExpandedThumbs', 'UserMap', 'LabelSearchPage',
    'AdminUserDashboard', 'AdminMapTab', 'AdminContributionsTab', 'AdminLabelSearchTab', 'SidewalkAI',
    'ExternalTagValidationASSETS2024', 'Old data, unknown source'
);
ALTER TABLE label_history ALTER COLUMN source TYPE ui_source USING source::text::ui_source;
ALTER TABLE label_validation ALTER COLUMN source TYPE ui_source USING source::text::ui_source;
ALTER TABLE validation_task_interaction ALTER COLUMN source TYPE ui_source USING source::text::ui_source;
DROP TYPE ui_source_old;
