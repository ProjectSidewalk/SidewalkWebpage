package models.user

import play.api.db.slick.DatabaseConfigProvider
import scala.concurrent.Future
import slick.driver.JdbcProfile
import slick.driver.PostgresDriver.api._
import play.api.libs.concurrent.Execution.Implicits.defaultContext
import javax.inject._
import play.api.db.slick.HasDatabaseConfigProvider
import com.google.inject.ImplementedBy

case class UserStat(userStatId: Int, userId: String, metersAudited: Float, labelsPerMeter: Option[Float],
                    highQuality: Boolean, highQualityManual: Option[Boolean], ownLabelsValidated: Int,
                    accuracy: Option[Float], excluded: Boolean)

case class LeaderboardStat(username: String, labelCount: Int, missionCount: Int, distanceMeters: Float, accuracy: Option[Float], score: Float)

class UserStatTableDef(tag: Tag) extends Table[UserStat](tag, "user_stat") {
  def userStatId: Rep[Int] = column[Int]("user_stat_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String] = column[String]("user_id")
  def metersAudited: Rep[Float] = column[Float]("meters_audited")
  def labelsPerMeter: Rep[Option[Float]] = column[Option[Float]]("labels_per_meter")
  def highQuality: Rep[Boolean] = column[Boolean]("high_quality")
  def highQualityManual: Rep[Option[Boolean]] = column[Option[Boolean]]("high_quality_manual")
  def ownLabelsValidated: Rep[Int] = column[Int]("own_labels_validated")
  def accuracy: Rep[Option[Float]] = column[Option[Float]]("accuracy")
  def excluded: Rep[Boolean] = column[Boolean]("excluded")

  override def * = (userStatId, userId, metersAudited, labelsPerMeter, highQuality, highQualityManual, ownLabelsValidated, accuracy, excluded) <> ((UserStat.apply _).tupled, UserStat.unapply)
}

@ImplementedBy(classOf[UserStats])
trait UserStatsRepository {
  def getLeaderboardStats(n: Int, timePeriod: String = "overall", byOrg: Boolean = false, orgId: Option[Int] = None): Future[List[LeaderboardStat]]
}

@Singleton
class UserStats @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends UserStatsRepository with HasDatabaseConfigProvider[JdbcProfile] {
  import driver.api._

  val userStats = TableQuery[UserStatTableDef]

  def getLeaderboardStats(n: Int, timePeriod: String = "overall", byOrg: Boolean = false, orgId: Option[Int] = None): Future[List[LeaderboardStat]] = {
//    val streetDistance: Float = totalStreetDistance() * 1609.34F // Convert miles to meters.
    val streetDistance: Float = 50000F // TODO: This is a placeholder value. Replace with the actual street distance.

    val statStartTime = timePeriod.toLowerCase() match {
      case "overall" => """TIMESTAMP 'epoch'"""
      case "weekly" => """(now() AT TIME ZONE 'US/Pacific')::date - (cast(extract(dow from (now() AT TIME ZONE 'US/Pacific')::date) as int) % 7) + TIME '00:00:00'"""
    }
    val joinUserOrgTable: String = if (byOrg || orgId.isDefined) {
      "INNER JOIN user_org ON sidewalk_user.user_id = user_org.user_id INNER JOIN organization ON user_org.org_id = organization.org_id"
    } else {
      ""
    }
    val orgFilter: String = orgId match {
      case Some(id) => "AND user_org.org_id = " + id
      case None =>
        // Temporarily filtering out previous course sections from the leaderboard. Need to remove soon.
        if (byOrg) "AND organization.org_name NOT LIKE 'DHD206 % 2021' AND organization.org_name NOT LIKE 'DHD206 % 2022'"
        else ""
    }
    // There are quite a few changes to make to the query when grouping by team/org instead of user. All of those below.
    val groupingCol: String = if (byOrg) "user_org.org_id" else "sidewalk_user.user_id"
    val groupingColName: String = if (byOrg) "org_id" else "user_id"
    val joinUserOrgForAcc: String = if (byOrg) "INNER JOIN user_org ON label.user_id = user_org.user_id" else ""
    val usernamesJoin: String = {
      if (byOrg) {
        "INNER JOIN (SELECT org_id, org_name AS username FROM organization) \"usernames\" ON label_counts.org_id = usernames.org_id"
      } else {
        "INNER JOIN (SELECT user_id, username FROM sidewalk_login.sidewalk_user) \"usernames\" ON label_counts.user_id = usernames.user_id"
      }
    }
    val statsQuery =
      s"""SELECT usernames.username,
         |        label_counts.label_count,
         |        mission_count,
         |        distance_meters,
         |        CASE WHEN validated_count > 9 THEN accuracy_temp ELSE NULL END AS accuracy,
         |        CASE WHEN accuracy_temp IS NOT NULL
         |            THEN SQRT(label_counts.label_count) * (0.5 * distance_meters / $streetDistance + 0.5 * accuracy_temp)
         |            ELSE SQRT(label_counts.label_count) * (distance_meters / $streetDistance)
         |            END AS score
         |FROM (
         |    SELECT $groupingCol, COUNT(label_id) AS label_count
         |    FROM sidewalk_login.sidewalk_user
         |    INNER JOIN sidewalk_login.user_role ON sidewalk_user.user_id = user_role.user_id
         |    INNER JOIN sidewalk_login.role ON user_role.role_id = role.role_id
         |    INNER JOIN user_stat ON sidewalk_user.user_id = user_stat.user_id
         |    INNER JOIN label ON sidewalk_user.user_id = label.user_id
         |    $joinUserOrgTable
         |    WHERE label.deleted = FALSE
         |        AND label.tutorial = FALSE
         |        AND role.role IN ('Registered', 'Administrator', 'Researcher')
         |        AND user_stat.excluded = FALSE
         |        AND (label.time_created AT TIME ZONE 'US/Pacific') > $statStartTime
         |        $orgFilter
         |    GROUP BY $groupingCol
         |    ORDER BY label_count DESC
         |    LIMIT $n
         |) "label_counts"
         |$usernamesJoin
         |INNER JOIN (
         |    SELECT $groupingCol, COUNT(mission_id) AS mission_count
         |    FROM mission
         |    INNER JOIN sidewalk_login.sidewalk_user ON mission.user_id = sidewalk_user.user_id
         |    $joinUserOrgTable
         |    WHERE (mission_end AT TIME ZONE 'US/Pacific') > $statStartTime
         |    GROUP BY $groupingCol
         |) "missions_counts" ON label_counts.$groupingColName = missions_counts.$groupingColName
         |INNER JOIN (
         |    SELECT $groupingCol, COALESCE(SUM(ST_LENGTH(ST_TRANSFORM(geom, 26918))), 0) AS distance_meters
         |    FROM street_edge
         |    INNER JOIN audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
         |    INNER JOIN sidewalk_login.sidewalk_user ON audit_task.user_id = sidewalk_user.user_id
         |    $joinUserOrgTable
         |    WHERE audit_task.completed
         |        AND (task_end AT TIME ZONE 'US/Pacific') > $statStartTime
         |    GROUP BY $groupingCol
         |) "distance" ON label_counts.$groupingColName = distance.$groupingColName
         |LEFT JOIN (
         |    SELECT $groupingColName,
         |           CAST(SUM(CASE WHEN correct THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(SUM(CASE WHEN correct THEN 1 ELSE 0 END) + SUM(CASE WHEN NOT correct THEN 1 ELSE 0 END), 0) AS accuracy_temp,
         |           COUNT(CASE WHEN correct IS NOT NULL THEN 1 END) AS validated_count
         |    FROM label
         |    $joinUserOrgForAcc
         |    WHERE (label.time_created AT TIME ZONE 'US/Pacific') > $statStartTime
         |    GROUP BY $groupingColName
         |) "accuracy" ON label_counts.$groupingColName = accuracy.$groupingColName
         |ORDER BY score DESC;""".stripMargin

    // Run the query and, if it's not a team name, remove the "@X.Y" from usernames that are valid email addresses.
    db.run(sql"#$statsQuery".as[(String, Int, Int, Float, Option[Float], Float)])
      .map(_.toList.map { stat =>
        if (!byOrg && isValidEmail(stat._1)) LeaderboardStat(stat._1.slice(0, stat._1.lastIndexOf('@')), stat._2, stat._3, stat._4, stat._5, stat._6)
        else LeaderboardStat.tupled(stat)
      })
  }

  /**
   * Check if the input string is a valid email address.
   *
   * We use a regex found in the Play Framework's code: https://github.com/playframework/playframework/blob/ddf3a7ee4285212ec665826ec268ef32b5a76000/core/play/src/main/scala/play/api/data/validation/Validation.scala#L79
   */
  def isValidEmail(maybeEmail: String): Boolean = {
    val emailRegex = """^[a-zA-Z0-9\.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$""".r
    maybeEmail match {
      case e if e.trim.isEmpty => false
      case e if emailRegex.findFirstMatchIn(e).isDefined => true
      case _ => false
    }
  }
}
