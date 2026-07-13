package models.userdashboard

/**
 * A trophy shown in the dashboard's trophy case. Computed on read (no stored table) from label/region history.
 *
 * `variant` selects the flavor and styling: "podium" (a weekly top-3 leaderboard placement, colored by `rank` 1-3),
 * "region" (top labeler in a neighborhood, Strava-KOM style), or "pioneer" (first-ever labeler in a region or city).
 * `cssClass`/`tagLabel` derive the visual treatment the trophy-case template applies.
 *
 * @param medal   Emoji shown large on the trophy.
 * @param title   Short trophy name (e.g. "City pioneer", "Top labeler").
 * @param sub     One-line context (e.g. "First-ever labeler in Seattle", "Week of Jun 16, 2026").
 * @param variant "podium" | "region" | "pioneer".
 * @param rank    1-3 for podium trophies (drives the medal color); 0 otherwise.
 * @param link    Optional href the trophy links to (e.g. Explore that neighborhood for region/pioneer trophies).
 */
case class Trophy(
    medal: String,
    title: String,
    sub: String,
    variant: String = "podium",
    rank: Int = 0,
    link: Option[String] = None
) {

  /** CSS class selecting the trophy's color treatment. */
  def cssClass: String = variant match {
    case "region"  => "ud-trophy-region"
    case "pioneer" => "ud-trophy-pioneer"
    case _         => s"ud-trophy-$rank"
  }

  /** Optional corner-ribbon label, or None for podium trophies (whose medal already conveys the placement). */
  def tagLabel: Option[String] = variant match {
    case "region"  => Some("Region")
    case "pioneer" => Some("Pioneer")
    case _         => None
  }
}
