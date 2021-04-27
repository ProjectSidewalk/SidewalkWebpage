
# --- !Ups
CREATE TABLE organization
(
  org_id SERIAL NOT NULL,
  org_name TEXT NOT NULL,
  org_description TEXT,
  PRIMARY KEY (org_id)
);

CREATE TABLE user_org
(
  user_org_id SERIAL NOT NULL,
  user_id TEXT NOT NULL,
  org_id INTEGER NOT NULL,
  PRIMARY KEY (user_org_id),
  FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id),
  FOREIGN KEY (org_id) REFERENCES organization(org_id)
);

# --- !Downs

DROP TABLE user_org;
DROP TABLE organization;