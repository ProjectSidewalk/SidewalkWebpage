# --- !Ups
ALTER TABLE "user" RENAME TO sidewalk_user;

# --- !Downs
ALTER TABLE sidewalk_user RENAME TO "user";
