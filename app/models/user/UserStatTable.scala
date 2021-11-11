package models.user

import models.attribute.UserClusteringSessionTable

import java.util.UUID
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.LabelTable
import models.mission.MissionTable
import models.street.StreetEdgeTable.totalStreetDistance
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import java.sql.Timestamp
import java.time.Instant
import scala.slick.lifted.ForeignKeyQuery
import scala.slick.jdbc.{StaticQuery => Q}
import play.Logger

case class UserStat(userStatId: Int, userId: String, metersAudited: Float, labelsPerMeter: Option[Float],
                    highQuality: Boolean, highQualityManual: Option[Boolean], accuracy: Option[Float],
                    excludeManual: Option[Boolean])

case class LeaderboardStat(username: String, labelCount: Int, missionCount: Int, distanceMeters: Float, accuracy: Option[Float], score: Float)

class UserStatTable(tag: Tag) extends Table[UserStat](tag, Some("sidewalk"), "user_stat") {
  def userStatId = column[Int]("user_stat_id", O.PrimaryKey, O.AutoInc)
  def userId = column[String]("user_id", O.NotNull)
  def metersAudited = column[Float]("meters_audited", O.NotNull)
  def labelsPerMeter = column[Option[Float]]("labels_per_meter")
  def highQuality = column[Boolean]("high_quality", O.NotNull)
  def highQualityManual = column[Option[Boolean]]("high_quality_manual")
  def accuracy = column[Option[Float]]("accuracy")
  def excludeManual = column[Option[Boolean]]("exclude_manual")

  def * = (userStatId, userId, metersAudited, labelsPerMeter, highQuality, highQualityManual, accuracy, excludeManual) <> ((UserStat.apply _).tupled, UserStat.unapply)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("user_stat_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
}

object UserStatTable {
  val db = play.api.db.slick.DB
  val userStats = TableQuery[UserStatTable]
  val userTable = TableQuery[UserTable]

  val LABEL_PER_METER_THRESHOLD: Float = 0.0375.toFloat

  /**
    * Return query with user_id and high_quality columns.
    */
  def getQualityOfUsers: Query[(Column[String], Column[Boolean], Column[Option[Boolean]]), (String, Boolean, Option[Boolean]), Seq] = db.withSession { implicit session =>
    userStats.map(x => (x.userId, x.highQuality, x.excludeManual))
  }


  /**
   * Get list of users where `high_quality` column is marked as `TRUE` and they have placed a label since `cutoffTime`.
   *
   * @param cutoffTime Only get users who have placed a label since this time. Defaults to all time.
   */
  def getIdsOfGoodUsersWithLabels(cutoffTime: Timestamp = new Timestamp(Instant.EPOCH.toEpochMilli)): List[String] = db.withSession { implicit session =>
    // Get the list of users who have placed a label by joining with the label table.
    val usersWithLabels = for {
      _stat <- userStats if _stat.highQuality
      _mission <- MissionTable.auditMissions if _mission.userId === _stat.userId
      _label <- LabelTable.labelsWithoutDeletedOrOnboarding if _mission.missionId === _label.missionId
      if _label.timeCreated > cutoffTime
    } yield _stat.userId

    // SELECT DISTINCT on the user_ids.
    usersWithLabels.groupBy(x => x).map(_._1).list
  }

  /**
   * Get list of users where their data was included in clustering but they have since been marked as low quality.
   */
  def getIdsOfNewlyLowQualityUsers: List[String] = db.withSession { implicit session =>
    val newLowQualityUsers = for {
      _stat <- userStats if _stat.highQuality === false
      _clustSession <- UserClusteringSessionTable.userClusteringSessions if _stat.userId === _clustSession.userId
    } yield _stat.userId

    // SELECT DISTINCT on the user_ids.
    newLowQualityUsers.groupBy(x => x).map(_._1).list
  }

  /**
    * Calls functions to update all columns in user_stat table. Only updates users who have audited since cutoff time.
    */
  def updateUserStatTable(cutoffTime: Timestamp) = db.withSession { implicit session =>
    updateAuditedDistance(cutoffTime)
    updateLabelsPerMeter(cutoffTime)
    updateAccuracy()
    updateHighQuality(cutoffTime)
  }

  /**
    * Update meters_audited column in the user_stat table for users who have done any auditing since `cutoffTime`.
    */
  def updateAuditedDistance(cutoffTime: Timestamp) = db.withSession { implicit session =>

    // Get the list of users who have done any auditing since the cutoff time.
    val usersToUpdate: List[String] = (for {
      _user <- userTable if _user.username =!= "anonymous"
      _mission <- MissionTable.auditMissions if _mission.userId === _user.userId
      if _mission.missionEnd > cutoffTime
    } yield _user.userId).groupBy(x => x).map(_._1).list

    // Computes the audited distance in meters using the distance_progress column of the mission table.
    val auditedDists: List[(String, Option[Float])] =
      MissionTable.auditMissions
        .filter(_.userId inSet usersToUpdate)
        .groupBy(_.userId).map(x => (x._1, x._2.map(_.distanceProgress).sum))
        .list

    // Update the meters_audited column in the user_stat table.
    for ((userId, auditedDist) <- auditedDists) {
      val updateQuery = for { _userStat <- userStats if _userStat.userId === userId } yield _userStat.metersAudited
      updateQuery.update(auditedDist.getOrElse(0F))
    }
  }

  /**
    * Update labels_per_meter column in the user_stat table for all users who have done any auditing since `cutoffTime`.
    */
  def updateLabelsPerMeter(cutoffTime: Timestamp) = db.withSession { implicit session =>

    // Get the list of users who have done any auditing since the cutoff time.
    val usersStatsToUpdate: List[String] = usersThatAuditedSinceCutoffTime(cutoffTime)

    // Compute label counts for each of those users.
    val labelCounts = (for {
      _mission <- MissionTable.auditMissions
      _label <- LabelTable.labelsWithoutDeletedOrOnboarding if _mission.missionId === _label.missionId
      if _mission.userId inSet usersStatsToUpdate
    } yield (_mission.userId, _label.labelId)).groupBy(_._1).map(x => (x._1, x._2.length))

    // Compute labeling frequency using label counts above and the meters_audited column in user_stat table.
    val labelFreq: List[(String, Float)] = userStats
      .filter(_.userId inSet usersStatsToUpdate)
      .leftJoin(labelCounts).on(_.userId === _._1)
      .map { case (_stat, _count) =>
        (_stat.userId, _count._2.ifNull(0.asColumnOf[Int]).asColumnOf[Float] / _stat.metersAudited)
      }.list

    // Update the labels_per_meter column in the user_stat table.
    for ((userId, labelingFreq) <- labelFreq) {
      val updateQuery = for { _userStat <- userStats if _userStat.userId === userId } yield _userStat.labelsPerMeter
      updateQuery.update(Some(labelingFreq))
    }
  }

  /**
    * Update the accuracy column in the user_stat table for every user.
    */
  def updateAccuracy() = db.withSession { implicit session =>
    val newAccuraciesQuery = Q.queryNA[(String, Option[Float])](
      s"""SELECT user_stat.user_id,
         |       CASE WHEN validated_count > 9 THEN accuracy_temp ELSE NULL END
         |FROM user_stat
         |INNER JOIN (
         |    SELECT user_id,
         |           CAST (COUNT(CASE WHEN n_agree > n_disagree THEN 1 END) AS FLOAT) / NULLIF(COUNT(CASE WHEN n_agree > n_disagree THEN 1 END) + COUNT(CASE WHEN n_disagree > n_agree THEN 1 END), 0) AS accuracy_temp,
         |           COUNT(CASE WHEN n_agree > n_disagree THEN 1 END) + COUNT(CASE WHEN n_disagree > n_agree THEN 1 END) AS validated_count
         |    FROM (
         |        SELECT mission.user_id, label.label_id,
         |               COUNT(CASE WHEN validation_result = 1 THEN 1 END) AS n_agree,
         |               COUNT(CASE WHEN validation_result = 2 THEN 1 END) AS n_disagree
         |        FROM mission
         |        INNER JOIN label ON mission.mission_id = label.mission_id
         |        INNER JOIN label_validation ON label.label_id = label_validation.label_id
         |        WHERE label.deleted = FALSE
         |            AND label.tutorial = FALSE
         |        GROUP BY mission.user_id, label.label_id
         |    ) agree_count
         |    GROUP BY user_id
         |) "accuracy_subquery" ON user_stat.user_id = accuracy_subquery.user_id
         |-- Filter out users if their accuracy is unchanged from what's already in the database.
         |WHERE COALESCE(accuracy <> (CASE WHEN validated_count > 9 THEN accuracy_temp ELSE NULL END), TRUE)
         |      AND (accuracy IS NOT NULL OR (CASE WHEN validated_count > 9 THEN accuracy_temp ELSE NULL END) IS NOT NULL);""".stripMargin
    )
    val usersToUpdate: List[(String, Option[Float])] = newAccuraciesQuery.list
    for ((userId, accuracy) <- usersToUpdate) {
      val updateQuery = for { _userStat <- userStats if _userStat.userId === userId } yield _userStat.accuracy
      updateQuery.update(accuracy)
    }
  }

  /**
   * Update high_quality column in the user_stat table, run after `updateAuditedDistance` and `updateLabelsPerMeter`.
   *
   * @return Number of user's whose records were updated.
   */
  def updateHighQuality(cutoffTime: Timestamp): Int = db.withSession { implicit session =>

    // First get users manually marked as low quality or marked to be excluded for other reasons.
    val lowQualityUsers: List[(String, Boolean)] =
      (userStats.filterNot(_.highQualityManual) union userStats.filter(_.excludeManual))
        .map(x => (x.userId, x.highQualityManual.get)).list

    // Decide if each user is high quality. First check if user was manually marked as high quality, then if they have
    // an audited distance of 0 (meaning an infinite labeling frequency), then if labeling frequency is over threshold.
    val userQuality: List[(String, Boolean)] =
      userStats.filter(x => x.highQualityManual.isEmpty || x.highQualityManual).map { x =>
        (
          x.userId,
          x.highQualityManual.getOrElse(false)
          || x.metersAudited === 0F
          || x.labelsPerMeter.getOrElse(5F) > LABEL_PER_METER_THRESHOLD
        )
      }.list

    // Get the list of users who have done any auditing since the cutoff time. Will only update these users.
    val usersStatsToUpdate: List[String] = usersThatAuditedSinceCutoffTime(cutoffTime)

    // Make separate lists for low vs high quality users, then bulk update each.
    val updateToLowQuaity: List[String] =
      (lowQualityUsers ++ userQuality.filterNot(_._2)).map(_._1).filter(x => usersStatsToUpdate.contains(x))
    val updateToHighQuality: List[String] =
      userQuality.filter(_._2).map(_._1).filter(x => usersStatsToUpdate.contains(x))

    val lowQualityUpdateQuery = for { _u <- userStats if _u.userId inSet updateToLowQuaity } yield _u.highQuality
    val highQualityUpdateQuery = for { _u <- userStats if _u.userId inSet updateToHighQuality } yield _u.highQuality

    // Do both bulk updates, and return total number of updated rows.
    lowQualityUpdateQuery.update(false) + highQualityUpdateQuery.update(true)
  }

  /**
   * Helper function to get list of users who have done any auditing since the cutoff time.
   */
  def usersThatAuditedSinceCutoffTime(cutoffTime: Timestamp): List[String] = db.withSession { implicit session =>
    (for {
      _user <- userTable
      _userStat <- userStats if _user.userId === _userStat.userId
      _mission <- MissionTable.auditMissions if _mission.userId === _user.userId
      if _user.username =!= "anonymous"
      if _userStat.metersAudited > 0F
      if _mission.missionEnd > cutoffTime
    } yield _user.userId).groupBy(x => x).map(_._1).list
  }

  /**
   * Gets leaderboard stats for the top `n` users in the given time period.
   *
   * Top users are calculated using: score = sqrt(# labels) * (0.5 * distance_audited / city_distance + 0.5 * accuracy).
   * Stats can be calculated for individual users or across teams. Overall and weekly are the possible time periods. We
   * only include accuracy if the user has at least 10 validated labels (must have either agree or disagree based off
   * majority vote; an unsure or tie does not count).
   * @param n The number of top users to get stats for
   * @param timePeriod The time period over which to compute stats, either "weekly" or "overall"
   * @param byOrg True if grouping by organization/team instead of by user.
   * @param orgId The id of the org over which to compute stats
   * @return
   */
  def getLeaderboardStats(n: Int, timePeriod: String = "overall", byOrg: Boolean = false, orgId: Option[Int] = None): List[LeaderboardStat] = db.withSession { implicit session =>
    val streetDistance: Float = totalStreetDistance() * 1609.34F // Convert miles to meters.

    val statStartTime = timePeriod.toLowerCase() match {
      case "overall" => """TIMESTAMP 'epoch'"""
      case "weekly" => """(now() AT TIME ZONE 'US/Pacific')::date - (cast(extract(dow from (now() AT TIME ZONE 'US/Pacific')::date) as int) % 7) + TIME '00:00:00'"""
    }
    val joinUserOrgTable: String = if (byOrg || orgId.isDefined) {
      "INNER JOIN user_org ON sidewalk_user.user_id = user_org.user_id"
    } else {
      ""
    }
    val orgFilter: String = orgId match {
      case Some(id) => "AND user_org.org_id = " + id
      case None => ""
    }
    // There are quite a few changes to make to the query when grouping by team/org instead of user. All of those below.
    val groupingCol: String = if (byOrg) "org_id" else "sidewalk_user.user_id"
    val groupingColName: String = if (byOrg) "org_id" else "user_id"
    val joinUserOrgForAcc: String = if (byOrg) "INNER JOIN user_org ON agree_count.user_id = user_org.user_id" else ""
    val usernamesJoin: String = {
      if (byOrg) {
        "INNER JOIN (SELECT org_id, org_name AS username FROM organization) \"usernames\" ON label_counts.org_id = usernames.org_id"
      } else {
        "INNER JOIN (SELECT user_id, username FROM sidewalk_user) \"usernames\" ON label_counts.user_id = usernames.user_id"
      }
    }
    val statsQuery = Q.queryNA[(String, Int, Int, Float, Option[Float], Float)](
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
        |    FROM sidewalk_user
        |    INNER JOIN user_role ON sidewalk_user.user_id = user_role.user_id
        |    INNER JOIN role ON user_role.role_id = role.role_id
        |    INNER JOIN user_stat ON sidewalk_user.user_id = user_stat.user_id
        |    INNER JOIN mission ON sidewalk_user.user_id = mission.user_id
        |    INNER JOIN label ON mission.mission_id = label.mission_id
        |    $joinUserOrgTable
        |    WHERE label.deleted = FALSE
        |        AND label.tutorial = FALSE
        |        AND role.role IN ('Registered', 'Administrator', 'Researcher')
        |        AND (user_stat.exclude_manual = FALSE OR user_stat.exclude_manual IS NULL)
        |        AND (label.time_created AT TIME ZONE 'US/Pacific') > $statStartTime
        |        $orgFilter
        |    GROUP BY $groupingCol
        |    ORDER BY label_count DESC
        |    LIMIT $n
        |) "label_counts"
        |$usernamesJoin
        |INNER JOIN (
        |    SELECT $groupingCol, COUNT(mission_id) AS mission_count, COALESCE(SUM(distance_progress), 0) AS distance_meters
        |    FROM mission
        |    INNER JOIN sidewalk_user ON mission.user_id = sidewalk_user.user_id
        |    $joinUserOrgTable
        |    WHERE (mission_end AT TIME ZONE 'US/Pacific') > $statStartTime
        |    GROUP BY $groupingCol
        |) "missions_and_distance" ON label_counts.$groupingColName = missions_and_distance.$groupingColName
        |LEFT JOIN (
        |    SELECT $groupingColName,
        |           CAST (COUNT(CASE WHEN n_agree > n_disagree THEN 1 END) AS FLOAT) / NULLIF(COUNT(CASE WHEN n_agree > n_disagree THEN 1 END) + COUNT(CASE WHEN n_disagree > n_agree THEN 1 END), 0) AS accuracy_temp,
        |           COUNT(CASE WHEN n_agree > n_disagree THEN 1 END) + COUNT(CASE WHEN n_disagree > n_agree THEN 1 END) AS validated_count
        |    FROM (
        |        SELECT mission.user_id, label.label_id,
        |               COUNT(CASE WHEN validation_result = 1 THEN 1 END) AS n_agree,
        |               COUNT(CASE WHEN validation_result = 2 THEN 1 END) AS n_disagree
        |        FROM mission
        |        INNER JOIN label ON mission.mission_id = label.mission_id
        |        INNER JOIN label_validation ON label.label_id = label_validation.label_id
        |        WHERE (label.time_created AT TIME ZONE 'US/Pacific') > $statStartTime
        |        GROUP BY mission.user_id, label.label_id
        |    ) agree_count
        |    $joinUserOrgForAcc
        |    GROUP BY $groupingColName
        |) "accuracy" ON label_counts.$groupingColName = accuracy.$groupingColName
        |ORDER BY score DESC;""".stripMargin
    )
    // Run the query and, if it's not a team name, remove the "@X.Y" from usernames that are valid email addresses.
    statsQuery.list.map(stat =>
      if (!byOrg && isValidEmail(stat._1)) LeaderboardStat(stat._1.slice(0, stat._1.lastIndexOf('@')), stat._2, stat._3, stat._4, stat._5, stat._6)
      else LeaderboardStat.tupled(stat)
    )
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

  /**
    * Insert new user_stat row with defaults if the user_id doesn't already have a row.
    *
    * @return Number of rows updated
    */
  def addUserStatIfNew(userId: UUID): Int = db.withTransaction { implicit session =>
    if (userStats.filter(_.userId === userId.toString).length.run == 0)
      userStats.insert(UserStat(0, userId.toString, 0F, None, true, None, None, None))
    else
      0
  }
}
