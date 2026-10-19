# --- !Ups
-- Each model's HuggingFace commit, so assessments from different weights can be told apart (#5794). A tagger
-- revision is a commit in projectsidewalk/sidewalk-tagger-ai-<label type>, not in a repo named by its model id.
ALTER TABLE label_ai_assessment
  ADD COLUMN validator_revision TEXT,
  ADD COLUMN tagger_revision TEXT,
  ADD CONSTRAINT label_ai_assessment_tagger_revision_needs_tagger_check
    CHECK (tagger_revision IS NULL OR tagger_model_id IS NOT NULL);

-- API 1.0.2 to 1.0.5 all served these validator commits. Older releases loaded HF main, so their rows stay null.
UPDATE label_ai_assessment
SET validator_revision = CASE validator_model_id
    WHEN 'sidewalk-validator-ai-crosswalk' THEN 'b7936e5bd17a4b96db301f954e5d3a5fe9eaf361'
    WHEN 'sidewalk-validator-ai-curbramp' THEN '969ad5a33079db7885c9e9a4eb5cd0f39d8fe57a'
    WHEN 'sidewalk-validator-ai-obstacle' THEN '8f0fe8fc48748fac35098e74c1848d015126deef'
    WHEN 'sidewalk-validator-ai-surfaceproblem' THEN '0e1439daa5667c8a81f63e75f835bd51221df4c2'
    WHEN 'sidewalk-validator-ai-nocurbramp' THEN '9f3f3bb2f40864a468fb65e43644ee5ba54e3e19'
  END
WHERE api_version IN ('1.0.2', '1.0.3', '1.0.4', '1.0.5');

-- Taggers only from 1.0.5: 1.0.4 moved them to per-type repos midway, so its rows could point at either repo.
UPDATE label_ai_assessment
SET tagger_revision = CASE tagger_model_id
    WHEN 'validated-dino-cls-b-crosswalk-tags-best' THEN '7788eb8d836b28df5417fc77970bc7382a9105cf'
    WHEN 'validated-dino-cls-b-curbramp-tags-best' THEN 'cbd3a9632fc594a6f62de850757ae199761d0c4a'
    WHEN 'validated-dino-cls-b-obstacle-tags-best' THEN '27fb9470678725e976fadbdd30ce41ddbbcddf10'
    WHEN 'validated-dino-cls-b-surfaceproblem-tags-best' THEN '9b8f1053a64577c9041a68b0fe3f58fccb930543'
  END
WHERE api_version = '1.0.5' AND tagger_model_id IS NOT NULL;

# --- !Downs
ALTER TABLE label_ai_assessment
  DROP CONSTRAINT label_ai_assessment_tagger_revision_needs_tagger_check,
  DROP COLUMN tagger_revision,
  DROP COLUMN validator_revision;
