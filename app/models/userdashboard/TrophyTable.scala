package models.userdashboard

import models.utils.MyPostgresProfile
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject._

/**
 * Read-only queries that compute a user's trophies on the fly from label/region history — there is no stored trophy
 * table (kept real-time and simple, like the activity streak). All queries are scoped to the current city's schema
 * (unqualified table names, resolved by the connection search_path) and exclude deleted/tutorial labels.
 *
 * Two eligibility rules are used deliberately:
 *   - Weekly podiums mirror the public weekly leaderboard exactly (role IN Registered/Administrator/Researcher, not
 *     excluded, on_leaderboard = TRUE), so a trophy always reconciles with a placement that was actually shown.
 *   - Region/city "pioneer" and "champion" are facts about the map (truly first / truly most), so they only drop
 *     excluded users and the AI account — anonymous human mappers still count.
 */
@Singleton
class TrophyTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._

  // Start of the US/Pacific week (Sunday) containing a given date expression — matches the leaderboard's week math.
  private def weekStart(dateExpr: String): String =
    s"(($dateExpr)::date - (cast(extract(dow from ($dateExpr)::date) as int) % 7))"

  /**
   * A user's completed-week top-3 placements by label count, most recent first, using the public-board eligibility.
   *
   * @param userId The user whose placements to find.
   * @param limit  Max rows to return.
   * @return       (week-start date as ISO yyyy-MM-dd, rank 1-3, label count) per qualifying week; the caller
   *               formats the date for the viewer's locale.
   */
  def getWeeklyPodiums(userId: String, limit: Int): DBIO[Seq[(String, Int, Int)]] = {
    val labelWeek = weekStart("label.time_created AT TIME ZONE 'US/Pacific'")
    val nowWeek   = weekStart("now() AT TIME ZONE 'US/Pacific'")
    sql"""
      WITH weekly AS (
          SELECT sidewalk_user.user_id AS uid,
                 #$labelWeek AS wk,
                 COUNT(label.label_id) AS lc,
                 RANK() OVER (PARTITION BY #$labelWeek ORDER BY COUNT(label.label_id) DESC)::int AS rnk
          FROM sidewalk_user
          INNER JOIN user_role ON sidewalk_user.user_id = user_role.user_id
          INNER JOIN role ON user_role.role_id = role.role_id
          INNER JOIN user_stat ON sidewalk_user.user_id = user_stat.user_id
          INNER JOIN label ON sidewalk_user.user_id = label.user_id
          WHERE label.deleted = FALSE
              AND label.tutorial = FALSE
              AND role.role IN ('Registered', 'Administrator', 'Researcher')
              AND user_stat.excluded = FALSE
              AND user_stat.on_leaderboard = TRUE
              AND #$labelWeek < #$nowWeek
          GROUP BY sidewalk_user.user_id, wk
      )
      SELECT to_char(wk, 'YYYY-MM-DD'), rnk, lc::int
      FROM weekly
      WHERE uid = $userId AND rnk <= 3
      ORDER BY wk DESC
      LIMIT $limit;
    """.as[(String, Int, Int)]
  }

  /**
   * Regions where the user is the top labeler (ties share rank 1), most labels first.
   *
   * @param userId   The user to check.
   * @param aiUserId The AI account id to exclude from the ranking.
   * @param limit    Max regions to return.
   * @return         (region name, region id, the user's label count in that region).
   */
  def getRegionChampions(userId: String, aiUserId: String, limit: Int): DBIO[Seq[(String, Int, Int)]] = {
    sql"""
      WITH region_counts AS (
          SELECT street_edge_region.region_id AS rid,
                 label.user_id AS uid,
                 COUNT(*)::int AS lc,
                 RANK() OVER (PARTITION BY street_edge_region.region_id ORDER BY COUNT(*) DESC)::int AS rnk
          FROM label
          INNER JOIN street_edge_region ON label.street_edge_id = street_edge_region.street_edge_id
          INNER JOIN user_stat ON label.user_id = user_stat.user_id
          WHERE label.deleted = FALSE AND label.tutorial = FALSE
              AND user_stat.excluded = FALSE AND label.user_id <> $aiUserId
          GROUP BY street_edge_region.region_id, label.user_id
      )
      SELECT region.name, region.region_id, region_counts.lc
      FROM region_counts
      INNER JOIN region ON region_counts.rid = region.region_id
      WHERE region_counts.uid = $userId AND region_counts.rnk = 1 AND region.deleted = FALSE
      ORDER BY region_counts.lc DESC
      LIMIT $limit;
    """.as[(String, Int, Int)]
  }

  /**
   * Regions the user was the first-ever to label (the earliest label in the region is theirs).
   *
   * @param userId   The user to check.
   * @param aiUserId The AI account id to exclude.
   * @param limit    Max regions to return.
   * @return         (region name, region id), alphabetical by name.
   */
  def getRegionPioneers(userId: String, aiUserId: String, limit: Int): DBIO[Seq[(String, Int)]] = {
    sql"""
      WITH firsts AS (
          SELECT DISTINCT ON (street_edge_region.region_id)
                 street_edge_region.region_id AS rid,
                 label.user_id AS uid
          FROM label
          INNER JOIN street_edge_region ON label.street_edge_id = street_edge_region.street_edge_id
          INNER JOIN user_stat ON label.user_id = user_stat.user_id
          WHERE label.deleted = FALSE AND label.tutorial = FALSE
              AND user_stat.excluded = FALSE AND label.user_id <> $aiUserId
          ORDER BY street_edge_region.region_id, label.time_created ASC, label.label_id ASC
      )
      SELECT region.name, region.region_id
      FROM firsts
      INNER JOIN region ON firsts.rid = region.region_id
      WHERE firsts.uid = $userId AND region.deleted = FALSE
      ORDER BY region.name
      LIMIT $limit;
    """.as[(String, Int)]
  }

  /**
   * Whether the user has tried a free-exploration session, and whether they labeled during one (#4451).
   *
   * Both flags come back from one round trip because the two trophies are always rendered together. Unlike the other
   * trophies these are participation facts about the user's own history, so no cross-user ranking or eligibility
   * filtering applies — only the usual deleted/tutorial label exclusions.
   *
   * @param userId The user to check.
   * @return       (has started at least one exploreAddress mission, has at least one label from such a mission).
   */
  def getFreeExplorationTrophyFlags(userId: String): DBIO[(Boolean, Boolean)] = {
    sql"""
      SELECT
          EXISTS (
              SELECT 1
              FROM mission
              WHERE mission.user_id = $userId AND mission.mission_type = 'exploreAddress'
          ),
          EXISTS (
              SELECT 1
              FROM label
              INNER JOIN mission ON label.mission_id = mission.mission_id
              WHERE label.user_id = $userId
                  AND label.deleted = FALSE AND label.tutorial = FALSE
                  AND mission.mission_type = 'exploreAddress'
          );
    """.as[(Boolean, Boolean)].head
  }

  /**
   * The user id of the first-ever labeler in this city (earliest non-tutorial label), if any.
   *
   * @param aiUserId The AI account id to exclude.
   * @return         The earliest labeler's user id, or None if the city has no labels yet.
   */
  def getCityPioneerUserId(aiUserId: String): DBIO[Option[String]] = {
    sql"""
      SELECT label.user_id
      FROM label
      INNER JOIN user_stat ON label.user_id = user_stat.user_id
      WHERE label.deleted = FALSE AND label.tutorial = FALSE
          AND user_stat.excluded = FALSE AND label.user_id <> $aiUserId
      ORDER BY label.time_created ASC, label.label_id ASC
      LIMIT 1;
    """.as[String].headOption
  }
}
