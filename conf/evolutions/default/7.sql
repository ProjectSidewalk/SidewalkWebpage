
# --- !Ups
CREATE TABLE IF NOT EXISTS gsv_onboarding_pano
(
  gsv_panorama_id TEXT NOT NULL,
  has_labels BOOLEAN NOT NULL,
  PRIMARY KEY (gsv_panorama_id)
);

INSERT INTO gsv_onboarding_pano VALUES ('stxXyCKAbd73DmkM2vsIHA', TRUE);
INSERT INTO gsv_onboarding_pano VALUES ('PTHUzZqpLdS1nTixJMoDSw', FALSE);
INSERT INTO gsv_onboarding_pano VALUES ('bdmGHJkiSgmO7_80SnbzXw', TRUE);
INSERT INTO gsv_onboarding_pano VALUES ('OgLbmLAuC4urfE5o7GP_JQ', TRUE);

# --- !Downs
DROP TABLE gsv_onboarding_pano;
