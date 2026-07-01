package models.userdashboard

/**
 * Hardcoded mock data for the Phase 1 comps prototype of the redesigned User Dashboard + Leaderboard.
 *
 * This exists ONLY to drive the static prototype so the visual language and information architecture can be reviewed
 * before any data/backend work. Nothing here reads the database. It is expected to be deleted once the real data is
 * wired in (Phase 2+); keeping it in one file makes that removal trivial.
 */
object DashboardMock {

  /** One labeling/exploring/validating badge track: which levels are earned and progress toward the next. */
  case class BadgeTrack(name: String, icon: String, earned: Int, pct: Int, nextLabel: String)

  /**
   * A leaderboard trophy the user has earned: a podium placement (weekly or all-time), or a region "champion" trophy
   * (Strava KOM-style — top labeler in a specific neighborhood). `region` flags the latter for distinct styling.
   */
  case class Trophy(rank: Int, medal: String, title: String, sub: String, region: Boolean = false)

  /** Per-label-type accuracy, with the user's weakest type flagged for emphasis. */
  case class AccuracyRow(name: String, cssKey: String, pct: Int, weakest: Boolean)

  /** A label of the user's that others validated as incorrect — teaching material. */
  case class Mistake(name: String, cssKey: String, note: String)

  /** A row in a leaderboard/standing table. */
  case class RankRow(rank: Int, user: String, labels: Int, you: Boolean = false)

  val badgeTracks: Seq[BadgeTrack] = Seq(
    BadgeTrack("Labeler", "labels", earned = 4, pct = 64, nextLabel = "716 more to Labeler V"),
    BadgeTrack("Explorer", "distance", earned = 3, pct = 42, nextLabel = "1.6 km more to Explorer IV"),
    BadgeTrack("Adventurer", "missions", earned = 3, pct = 23, nextLabel = "33 more missions to Adventurer IV"),
    BadgeTrack("Validator", "validation", earned = 4, pct = 78, nextLabel = "1,090 more to Validator V")
  )

  val trophies: Seq[Trophy] = Seq(
    Trophy(1, "👑", "Capitol Hill champion", "Most labels in this neighborhood", region = true),
    Trophy(1, "🥇", "Top labeler", "Week of Jun 16 · this city"),
    Trophy(2, "🥈", "Top validator", "Week of Jun 9 · this city"),
    Trophy(3, "🥉", "Top labeler", "Week of May 26 · this city")
  )

  val accuracyByType: Seq[AccuracyRow] = Seq(
    AccuracyRow("Curb Ramp", "curb-ramp", 94, weakest = false),
    AccuracyRow("No Curb Ramp", "no-curb-ramp", 88, weakest = false),
    AccuracyRow("Crosswalk", "crosswalk", 91, weakest = false),
    AccuracyRow("Surface Problem", "surface-problem", 77, weakest = false),
    AccuracyRow("Obstacle", "obstacle", 61, weakest = true),
    AccuracyRow("No Sidewalk", "no-sidewalk", 83, weakest = false)
  )

  val mistakes: Seq[Mistake] = Seq(
    Mistake("Obstacle", "obstacle", "Validators said this was clear — the pole was outside the path of travel."),
    Mistake("Surface Problem", "surface-problem", "Minor cracking; most validators marked it passable."),
    Mistake("Obstacle", "obstacle", "This looked like a temporary trash bin, not a fixed obstacle."),
    Mistake("No Sidewalk", "no-sidewalk", "A sidewalk was present just out of frame to the right."),
    Mistake("Curb Ramp", "curb-ramp", "Validators saw a driveway apron here rather than a curb ramp."),
    Mistake("Crosswalk", "crosswalk", "Faded markings — most validators couldn't confirm a crosswalk.")
  )

  /** How many recent mistakes to surface on the dashboard before the "See all" link. */
  val recentMistakesShown: Int = 6

  /** Total mistakes available behind "See all" (mock count). */
  val totalMistakes: Int = 23

  /** Mock standing slice (the user ± neighbors) for a large-cohort framing. */
  val standingSlice: Seq[RankRow] = Seq(
    RankRow(33, "curb_crusader", 312),
    RankRow(34, "you", 298, you = true),
    RankRow(35, "ramp_ranger", 291)
  )

  /**
   * Deterministic mock activity heatmap: 16 weeks x 7 days of intensity 0-4. Computed (not random) so the prototype
   * renders identically every load and so the script has no Math.random/Date dependency.
   */
  val heatmap: Seq[Int] = (0 until 16 * 7).map { i =>
    val day  = i % 7
    val week = i / 7
    // Weekends quieter; recent weeks busier; a couple of gaps so it reads like a real, imperfect streak.
    val base    = if (day == 0 || day == 6) 0 else 1
    val recency = week / 4
    val pulse   = (i * 7) % 5
    if (week == 5 || week == 11) 0 else math.min(4, base + recency + (if (pulse > 2) 1 else 0))
  }
}
