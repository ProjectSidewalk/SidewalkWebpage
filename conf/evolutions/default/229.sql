# --- !Ups
-- Create a copy of the audit_task_interaction table that has just a subset of the records for easy retrieval.
CREATE TABLE audit_task_interaction_small (
    audit_task_interaction_id BIGINT NOT NULL,
    audit_task_id INT NOT NULL,
    action TEXT NOT NULL,
    gsv_panorama_id TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    heading DOUBLE PRECISION,
    pitch DOUBLE PRECISION,
    zoom INT,
    note TEXT,
    timestamp TIMESTAMPTZ NOT NULL,
    temporary_label_id INT,
    mission_id INT,
    PRIMARY KEY (audit_task_interaction_id),
    FOREIGN KEY (audit_task_interaction_id) REFERENCES audit_task_interaction(audit_task_interaction_id),
    FOREIGN KEY (audit_task_id) REFERENCES audit_task(audit_task_id),
    FOREIGN KEY (mission_id) REFERENCES mission(mission_id)
);
ALTER TABLE audit_task_interaction_small OWNER TO sidewalk;

-- Below is being run on servers manually due to how long the query takes.
-- NOTE if adding more actions to this list in the future, make sure to update `actionSubsetForSmallTable` variable.
-- INSERT INTO audit_task_interaction_small
-- SELECT *
-- FROM audit_task_interaction
-- WHERE action IN ('ViewControl_MouseDown', 'LabelingCanvas_MouseDown', 'NextSlideButton_Click', 'PreviousSlideButton_Click')
-- ON CONFLICT DO NOTHING;

# --- !Downs
DROP TABLE audit_task_interaction_small;
