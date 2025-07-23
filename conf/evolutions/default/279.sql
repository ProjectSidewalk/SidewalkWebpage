# --- !Ups
UPDATE label_validation SET source = 'Validate' WHERE source = 'ValidateDesktop';
UPDATE label_validation SET source = 'AdminValidate' WHERE source = 'ValidateDesktopAdmin';
UPDATE label_validation SET source = 'ExpertValidate' WHERE source = 'ValidateDesktopNew';

UPDATE validation_task_interaction SET source = 'Validate' WHERE source = 'ValidateDesktop';
UPDATE validation_task_interaction SET source = 'AdminValidate' WHERE source = 'ValidateDesktopAdmin';
UPDATE validation_task_interaction SET source = 'ExpertValidate' WHERE source = 'ValidateDesktopNew';

# --- !Downs
UPDATE validation_task_interaction SET source = 'ValidateDesktopNew' WHERE source = 'ExpertValidate';
UPDATE validation_task_interaction SET source = 'ValidateDesktopAdmin' WHERE source = 'AdminValidate';
UPDATE validation_task_interaction SET source = 'ValidateDesktop' WHERE source = 'Validate';

UPDATE label_validation SET source = 'ValidateDesktopNew' WHERE source = 'ExpertValidate';
UPDATE label_validation SET source = 'ValidateDesktopAdmin' WHERE source = 'AdminValidate';
UPDATE label_validation SET source = 'ValidateDesktop' WHERE source = 'Validate';
