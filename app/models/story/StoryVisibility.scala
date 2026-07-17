package models.story

/**
 * Enumeration of a story's moderation state, backing the `story_visibility` Postgres enum type (#4054).
 *
 * The values are:
 *   - `visible` public on the label-detail card (every story starts here — public on submit)
 *   - `hidden`  admin quarantine: reversible and keeps the row and media bytes as abuse evidence; only admins and
 *               the author (flagged, still able to retract) can see it. The author's retraction is a row DELETE.
 *
 * NOTE: if changing these values, update the `story_visibility` Postgres enum type as well (see 336.sql).
 */
object StoryVisibility extends Enumeration {
  type StoryVisibility = Value
  val Visible: Value = Value("visible")
  val Hidden: Value  = Value("hidden")
}
