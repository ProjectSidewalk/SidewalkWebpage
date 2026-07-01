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

}
