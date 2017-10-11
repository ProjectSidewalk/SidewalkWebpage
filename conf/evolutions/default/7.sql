
# --- !Ups
CREATE TABLE gsv_onboarding_panos
(
  gsv_panorama_id TEXT NOT NULL,
  has_labels BOOLEAN NOT NULL,
  PRIMARY KEY (gsv_panorama_id)
);

INSERT INTO gsv_onboarding_panos VALUES ('stxXyCKAbd73DmkM2vsIHA', TRUE);
INSERT INTO gsv_onboarding_panos VALUES ('PTHUzZqpLdS1nTixJMoDSw', FALSE);

# --- !Downs
DROP TABLE gsv_onboarding_panos;
