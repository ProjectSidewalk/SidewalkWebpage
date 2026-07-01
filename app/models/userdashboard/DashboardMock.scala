package models.userdashboard

/**
 * Hardcoded mock data for the Phase 1 comps prototype of the redesigned User Dashboard + Leaderboard.
 *
 * This exists ONLY to drive the static prototype so the visual language and information architecture can be reviewed
 * before any data/backend work. Nothing here reads the database. It is expected to be deleted once the real data is
 * wired in (Phase 2+); keeping it in one file makes that removal trivial.
 */
object DashboardMock {

  /** Roman numerals for the five badge levels, so the tier's progression reads clearly alongside its themed name. */
  val roman: Seq[String] = Seq("I", "II", "III", "IV", "V")

  /**
   * One labeling/exploring/validating badge track: which levels are earned, progress toward the next, and the five
   * themed level names (progressively cooler). `earned` is the highest level reached (0-5); `nextCount` is the
   * human-readable remaining amount to the next level. The canonical home for these names when real data is wired is
   * BadgeAchievements.js (LEVEL_NAMES, with i18n keys) — this mock mirrors that shape.
   */
  case class BadgeTrack(name: String, icon: String, earned: Int, pct: Int, nextCount: String, levelNames: Seq[String]) {

    /** Current tier as "IV: Barrier Buster" (Roman numeral makes the progression legible), or "Not started". */
    def currentLabel: String = if (earned >= 1) s"${roman(earned - 1)}: ${levelNames(earned - 1)}" else "Not started"

    /** Next tier as "V: Sidewalk Sage", or None if maxed out. */
    def nextLabel: Option[String] = if (earned < 5) Some(s"${roman(earned)}: ${levelNames(earned)}") else None
  }

  /**
   * A trophy the user has earned. `variant` selects the flavor + styling: "podium" (weekly/all-time top 3, colored by
   * `rank` 1-3), "region" (Strava KOM-style top labeler in a neighborhood), or "pioneer" (first-ever labeler in a
   * region or city). `cssClass`/`tagLabel` derive the visual treatment.
   */
  case class Trophy(medal: String, title: String, sub: String, variant: String = "podium", rank: Int = 0) {
    def cssClass: String = variant match {
      case "region"  => "ud-trophy-region"
      case "pioneer" => "ud-trophy-pioneer"
      case _         => s"ud-trophy-$rank"
    }
    def tagLabel: Option[String] = variant match {
      case "region"  => Some("Region")
      case "pioneer" => Some("Pioneer")
      case _         => None
    }
  }

  /** Per-label-type accuracy, with the user's weakest type flagged for emphasis. */
  case class AccuracyRow(name: String, cssKey: String, pct: Int, weakest: Boolean)

  /** A row in a leaderboard/standing table. */
  case class RankRow(rank: Int, user: String, labels: Int, you: Boolean = false)

  val badgeTracks: Seq[BadgeTrack] = Seq(
    BadgeTrack(
      "Labeler",
      "labels",
      earned = 4,
      pct = 64,
      nextCount = "716 more labels",
      levelNames = Seq("Curb Spotter", "Sidewalk Scout", "Access Ace", "Barrier Buster", "Sidewalk Sage")
    ),
    BadgeTrack(
      "Explorer",
      "distance",
      earned = 3,
      pct = 42,
      nextCount = "1.6 km more",
      levelNames = Seq("Block Walker", "Neighborhood Nomad", "District Rambler", "City Trekker", "Metro Voyager")
    ),
    BadgeTrack(
      "Adventurer",
      "missions",
      earned = 3,
      pct = 23,
      nextCount = "33 more missions",
      levelNames = Seq("First Steps", "Trailblazer", "Pathfinder", "Quest Master", "Grand Wayfarer")
    ),
    BadgeTrack(
      "Validator",
      "validation",
      earned = 4,
      pct = 78,
      nextCount = "1,090 more validations",
      levelNames = Seq("Fact Checker", "Peer Reviewer", "Quality Guardian", "Truth Keeper", "Validation Virtuoso")
    )
  )

  val trophies: Seq[Trophy] = Seq(
    Trophy("🌱", "City pioneer", "First-ever labeler in Seattle", variant = "pioneer"),
    Trophy("🧭", "Region pioneer", "First-ever labeler in Capitol Hill", variant = "pioneer"),
    Trophy("👑", "Capitol Hill champion", "Most labels in this neighborhood", variant = "region"),
    Trophy("🥇", "Top labeler", "Week of Jun 16 · this city", variant = "podium", rank = 1),
    Trophy("🥈", "Top validator", "Week of Jun 9 · this city", variant = "podium", rank = 2),
    Trophy("🥉", "Top labeler", "Week of May 26 · this city", variant = "podium", rank = 3)
  )

  val accuracyByType: Seq[AccuracyRow] = Seq(
    AccuracyRow("Curb Ramp", "curb-ramp", 94, weakest = false),
    AccuracyRow("No Curb Ramp", "no-curb-ramp", 88, weakest = false),
    AccuracyRow("Crosswalk", "crosswalk", 91, weakest = false),
    AccuracyRow("Surface Problem", "surface-problem", 77, weakest = false),
    AccuracyRow("Obstacle", "obstacle", 61, weakest = true),
    AccuracyRow("No Sidewalk", "no-sidewalk", 83, weakest = false)
  )

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
