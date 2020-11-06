# --- !Ups
DROP TABLE teaser;

# --- !Downs
CREATE TABLE teaser (
    email character varying(2044) NOT NULL,
    PRIMARY KEY (email)
);
