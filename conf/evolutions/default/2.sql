# --- !Ups

ALTER TABLE "sidewalk"."amt_assignment"
  ADD CONSTRAINT "amt_assignment_turker_id_fkey"
    FOREIGN KEY ("turker_id") REFERENCES "sidewalk"."turker"("turker_id"),
  ADD CONSTRAINT "amt_assignment_condition_id_fkey"
    FOREIGN KEY ("condition_id") REFERENCES "sidewalk"."amt_condition"("condition_id"),
  ALTER COLUMN "route_id" SET NOT NULL;
