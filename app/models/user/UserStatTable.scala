package models.user

import formats.json.UserFormats.labelTypeStatWrites
import models.attribute.UserClusteringSessionTable
import java.util.UUID
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.{LabelTable, LabelValidationTable}
import models.mission.MissionTable
import models.street.StreetEdgeTable.totalStreetDistance
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}
import java.sql.Timestamp
import java.time.Instant
import scala.slick.lifted.ForeignKeyQuery
import scala.slick.jdbc.{GetResult, StaticQuery => Q}

case class UserStat(userStatId: Int, userId: String, metersAudited: Float, labelsPerMeter: Option[Float],
                    highQuality: Boolean, highQualityManual: Option[Boolean], ownLabelsValidated: Int,
                    accuracy: Option[Float], excludeManual: Boolean)

case class LabelTypeStat(labels: Int, validatedCorrect: Int, validatedIncorrect: Int, notValidated: Int) {
  def toArray = Array(labels, validatedCorrect, validatedIncorrect, notValidated)
}
case class UserStatAPI(userId: String, labels: Int, metersExplored: Float, labelsPerMeter: Option[Float],
                       highQuality: Boolean, highQualityManual: Option[Boolean], labelAccuracy: Option[Float],
                       validatedLabels: Int, validationsReceived: Int, labelsValidatedCorrect: Int,
                       labelsValidatedIncorrect: Int, labelsNotValidated: Int, validationsGiven: Int,
                       dissentingValidationsGiven: Int, agreeValidationsGiven: Int, disagreeValidationsGiven: Int,
                       notsureValidationsGiven: Int, statsByLabelType: Map[String, LabelTypeStat]) {
  def toJSON: JsObject = {
    Json.obj(
      "user_id" -> userId,
      "labels" -> labels,
      "meters_explored" -> metersExplored,
      "labels_per_meter" -> labelsPerMeter,
      "high_quality" -> highQuality,
      "high_quality_manual" -> highQualityManual,
      "label_accuracy" -> labelAccuracy,
      "validated_labels" -> validatedLabels,
      "validations_received" -> validationsReceived,
      "labels_validated_correct" -> labelsValidatedCorrect,
      "labels_validated_incorrect" -> labelsValidatedIncorrect,
      "labels_not_validated" -> labelsNotValidated,
      "validations_given" -> validationsGiven,
      "dissenting_validations_given" -> dissentingValidationsGiven,
      "agree_validations_given" -> agreeValidationsGiven,
      "disagree_validations_given" -> disagreeValidationsGiven,
      "notsure_validations_given" -> notsureValidationsGiven,
      "stats_by_label_type" -> Json.obj(
        "curb_ramp" -> Json.toJson(statsByLabelType("CurbRamp")),
        "no_curb_ramp" -> Json.toJson(statsByLabelType("NoCurbRamp")),
        "obstacle" -> Json.toJson(statsByLabelType("Obstacle")),
        "surface_problem" -> Json.toJson(statsByLabelType("SurfaceProblem")),
        "no_sidewalk" -> Json.toJson(statsByLabelType("NoSidewalk")),
        "crosswalk" -> Json.toJson(statsByLabelType("Crosswalk")),
        "pedestrian_signal" -> Json.toJson(statsByLabelType("Signal")),
        "cant_see_sidewalk" -> Json.toJson(statsByLabelType("Occlusion")),
        "other" -> Json.toJson(statsByLabelType("Other"))
      )
    )
  }
  def toArray = Array(
    userId, labels, metersExplored, labelsPerMeter.map(_.toString).getOrElse("NA"), highQuality,
    highQualityManual.map(_.toString).getOrElse("NA"), labelAccuracy.map(_.toString).getOrElse("NA"), validatedLabels,
    validationsReceived, labelsValidatedCorrect, labelsValidatedIncorrect, labelsNotValidated, validationsGiven,
    dissentingValidationsGiven, agreeValidationsGiven, disagreeValidationsGiven, notsureValidationsGiven
  ) ++ statsByLabelType("CurbRamp").toArray ++ statsByLabelType("NoCurbRamp").toArray ++
    statsByLabelType("Obstacle").toArray ++ statsByLabelType("SurfaceProblem").toArray ++
    statsByLabelType("NoSidewalk").toArray ++ statsByLabelType("Crosswalk").toArray ++
    statsByLabelType("Signal").toArray ++ statsByLabelType("Occlusion").toArray ++
    statsByLabelType("Other").toArray
}

case class LeaderboardStat(username: String, labelCount: Int, missionCount: Int, distanceMeters: Float, accuracy: Option[Float], score: Float)

class UserStatTable(tag: Tag) extends Table[UserStat](tag, Some("sidewalk"), "user_stat") {
  def userStatId = column[Int]("user_stat_id", O.PrimaryKey, O.AutoInc)
  def userId = column[String]("user_id", O.NotNull)
  def metersAudited = column[Float]("meters_audited", O.NotNull)
  def labelsPerMeter = column[Option[Float]]("labels_per_meter")
  def highQuality = column[Boolean]("high_quality", O.NotNull)
  def highQualityManual = column[Option[Boolean]]("high_quality_manual")
  def ownLabelsValidated = column[Int]("own_labels_validated", O.NotNull)
  def accuracy = column[Option[Float]]("accuracy")
  def excludeManual = column[Boolean]("exclude_manual")

  def * = (userStatId, userId, metersAudited, labelsPerMeter, highQuality, highQualityManual, ownLabelsValidated, accuracy, excludeManual) <> ((UserStat.apply _).tupled, UserStat.unapply)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("user_stat_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
}

object UserStatTable {
  val db = play.api.db.slick.DB
  val userStats = TableQuery[UserStatTable]
  val userTable = TableQuery[UserTable]

  val LABEL_PER_METER_THRESHOLD: Float = 0.0375.toFloat

  implicit val userStatAPIConverter = GetResult[UserStatAPI](r => UserStatAPI(
    r.nextString, r.nextInt, r.nextFloat, r.nextFloatOption, r.nextBoolean, r.nextBooleanOption, r.nextFloatOption,
    r.nextInt, r.nextInt, r.nextInt, r.nextInt, r.nextInt, r.nextInt, r.nextInt, r.nextInt, r.nextInt, r.nextInt,
    Map(
      "CurbRamp" -> LabelTypeStat(r.nextInt, r.nextInt, r.nextInt, r.nextInt),
      "NoCurbRamp" -> LabelTypeStat(r.nextInt, r.nextInt, r.nextInt, r.nextInt),
      "Obstacle" -> LabelTypeStat(r.nextInt, r.nextInt, r.nextInt, r.nextInt),
      "SurfaceProblem" -> LabelTypeStat(r.nextInt, r.nextInt, r.nextInt, r.nextInt),
      "NoSidewalk" -> LabelTypeStat(r.nextInt, r.nextInt, r.nextInt, r.nextInt),
      "Crosswalk" -> LabelTypeStat(r.nextInt, r.nextInt, r.nextInt, r.nextInt),
      "Signal" -> LabelTypeStat(r.nextInt, r.nextInt, r.nextInt, r.nextInt),
      "Occlusion" -> LabelTypeStat(r.nextInt, r.nextInt, r.nextInt, r.nextInt),
      "Other" -> LabelTypeStat(r.nextInt, r.nextInt, r.nextInt, r.nextInt)
    )
  ))

  /**
    * Return query with user_id and high_quality columns.
    */
  def getQualityOfUsers: Query[(Column[String], Column[Boolean], Column[Boolean]), (String, Boolean, Boolean), Seq] = db.withSession { implicit session =>
    userStats.map(x => (x.userId, x.highQuality, x.excludeManual))
  }


  /**
   * Get list of users where `high_quality` column is marked as `TRUE` and they have placed a label since `cutoffTime`.
   *
   * @param cutoffTime Only get users who have placed a label since this time. Defaults to all time.
   */
  def getIdsOfGoodUsersWithLabels(cutoffTime: Timestamp = new Timestamp(Instant.EPOCH.toEpochMilli)): List[String] = db.withSession { implicit session =>
    // TODO include users who have received new validations too? A la usersValidatedSinceCutoffTime() or similar?
    // Get the list of users who have placed a label by joining with the label table.
    val usersWithLabels = for {
      _stat <- userStats if _stat.highQuality
      _mission <- MissionTable.auditMissions if _mission.userId === _stat.userId
      _label <- LabelTable.labels if _mission.missionId === _label.missionId
      if (_label.correct.isEmpty || _label.correct === true) && // Filter out labels validated as incorrect.
        _label.timeCreated > cutoffTime
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
    updateAccuracy(List())
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
      _label <- LabelTable.labelsWithExcludedUsers if _mission.missionId === _label.missionId
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
    *
    * @param users A list of user_ids to update, update all users if list is empty.
    */
  def updateAccuracy(users: List[String]) = db.withSession { implicit session =>
    val filterStatement: String =
      if (users.isEmpty) ""
      else s"""AND mission.user_id IN ('${users.mkString("','")}')"""

    val newAccuraciesQuery = Q.queryNA[(String, Int, Option[Float])](
      s"""SELECT user_stat.user_id,
         |       new_validated_count,
         |       new_accuracy
         |FROM user_stat
         |INNER JOIN (
         |    SELECT user_id,
         |           CAST(SUM(CASE WHEN correct THEN 1 END) AS FLOAT) / NULLIF(SUM(CASE WHEN correct THEN 1 END) + SUM(CASE WHEN NOT correct THEN 1 END), 0) AS new_accuracy,
         |           COUNT(CASE WHEN correct IS NOT NULL THEN 1 END) AS new_validated_count
         |    FROM mission
         |    INNER JOIN label ON mission.mission_id = label.mission_id
         |    WHERE label.deleted = FALSE
         |        AND label.tutorial = FALSE
         |        $filterStatement
         |    GROUP BY user_id
         |) "accuracy_subquery" ON user_stat.user_id = accuracy_subquery.user_id
         |-- Filter out users if their validated count and accuracy are unchanged from what's already in the database.
         |WHERE own_labels_validated <> new_validated_count
         |    OR (accuracy IS NULL AND new_accuracy IS NOT NULL)
         |    OR (accuracy IS NOT NULL AND new_accuracy IS NULL)
         |    OR (accuracy IS NOT NULL AND new_accuracy IS NOT NULL AND ROUND(accuracy::NUMERIC, 3) <> ROUND(new_accuracy::NUMERIC, 3));""".stripMargin
    )
    val usersToUpdate: List[(String, Int, Option[Float])] = newAccuraciesQuery.list
    for ((userId, validatedCount, accuracy) <- usersToUpdate) {
      val updateQuery = for { _us <- userStats if _us.userId === userId } yield (_us.ownLabelsValidated, _us.accuracy)
      updateQuery.update((validatedCount, accuracy))
    }
  }

  /**
   * Update high_quality col in user_stat table, run after updateAuditedDistance, updateLabelsPerMeter, updateAccuracy.
   *
   * Users are considered low quality if they either:
   * 1. have been manually marked as high_quality_manual = FALSE in the user_stat table,
   * 2. have a labeling frequency below `LABEL_PER_METER_THRESHOLD`, or
   * 3. have an accuracy rating below 60% (with at least 50 of their labels validated.
   *
   * @return Number of user's whose records were updated.
   */
  def updateHighQuality(cutoffTime: Timestamp): Int = db.withSession { implicit session =>

    // First get users manually marked as low quality or marked to be excluded for other reasons.
    val lowQualUsers: List[(String, Boolean)] =
      userStats.filter(u => u.excludeManual || !u.highQualityManual.getOrElse(true))
        .map(x => (x.userId, x.highQualityManual.get)).list

    // Decide if each user is high quality. Conditions in the method comment. Users manually marked for exclusion or
    // low quality are filtered out later (using results from the previous query).
    val userQual: List[(String, Boolean)] = {
      userStats.filter(x => x.highQualityManual.isEmpty || x.highQualityManual).map { x =>
        (
          x.userId,
          x.highQualityManual.getOrElse(false) || (
            (x.metersAudited === 0F || x.labelsPerMeter.getOrElse(5F) > LABEL_PER_METER_THRESHOLD)
            && (x.accuracy.getOrElse(1.0F) > 0.6F.asColumnOf[Float] || x.ownLabelsValidated < 50.asColumnOf[Int])
            )
        )
      }.list
    }

    // Get the list of users who have done any auditing since the cutoff time. Will only update these users.
    val usersToUpdate: List[String] =
      (usersThatAuditedSinceCutoffTime(cutoffTime) ++ usersValidatedSinceCutoffTime(cutoffTime)).distinct

    // Make separate lists for low vs high quality users, then bulk update each.
    val updateToHighQual: List[String] =
      userQual.filter(x => x._2 && !lowQualUsers.map(_._1).contains(x._1) && usersToUpdate.contains(x._1)).map(_._1)
    val updateToLowQual: List[String] =
      (lowQualUsers ++ userQual.filterNot(_._2)).map(_._1).filter(x => usersToUpdate.contains(x))

    val lowQualityUpdateQuery = for { _u <- userStats if _u.userId inSet updateToLowQual } yield _u.highQuality
    val highQualityUpdateQuery = for { _u <- userStats if _u.userId inSet updateToHighQual } yield _u.highQuality

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
    * Helper function to get list of users who have had any of their labels validated since the cutoff time.
    */
  def usersValidatedSinceCutoffTime(cutoffTime: Timestamp): List[String] = db.withSession { implicit session =>
    (for {
      _labelVal <- LabelValidationTable.validationLabels
      _label <- LabelTable.labels if _labelVal.labelId === _label.labelId
      _mission <- MissionTable.missions if _label.missionId === _mission.missionId
      _user <- userTable if _mission.userId === _user.userId
      if _user.username =!= "anonymous"
      if _labelVal.endTimestamp > cutoffTime
    } yield _user.userId).groupBy(x => x).map(_._1).list
  }

  /**
   * Gets leaderboard stats for the top `n` users in the given time period.
   *
   * Top users are calculated using: score = sqrt(# labels) * (0.5 * distance_audited / city_distance + 0.5 * accuracy).
   * Stats can be calculated for individual users or across teams. Overall and weekly are the possible time periods. We
   * only include accuracy if the user has at least 10 validated labels (must have either agree or disagree based off
   * majority vote; a notsure or tie does not count).
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
    val joinUserOrgForAcc: String = if (byOrg) "INNER JOIN user_org ON mission.user_id = user_org.user_id" else ""
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
        |        AND user_stat.exclude_manual = FALSE
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
        |           CAST(SUM(CASE WHEN correct THEN 1 END) AS FLOAT) / NULLIF(SUM(CASE WHEN correct THEN 1 END) + SUM(CASE WHEN NOT correct THEN 1 END), 0) AS accuracy_temp,
        |           COUNT(CASE WHEN correct IS NOT NULL THEN 1 END) AS validated_count
        |    FROM label
        |    INNER JOIN mission ON label.mission_id = mission.mission_id
        |    $joinUserOrgForAcc
        |    WHERE (label.time_created AT TIME ZONE 'US/Pacific') > $statStartTime
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
   * Computes some stats on users that will be served through a public API.
   */
  def getStatsForAPI: List[UserStatAPI] = db.withSession { implicit session =>
    val statsQuery = Q.queryNA[UserStatAPI](
      s"""SELECT user_stat.user_id,
         |       COALESCE(label_counts.labels, 0) AS labels,
         |       user_stat.meters_audited AS meters_explored,
         |       user_stat.labels_per_meter,
         |       user_stat.high_quality,
         |       user_stat.high_quality_manual,
         |       user_stat.accuracy AS label_accuracy,
         |       COALESCE(label_counts.validated_labels, 0) AS validated_labels,
         |       COALESCE(label_counts.validations_received, 0) AS validations_received,
         |       COALESCE(label_counts.labels_validated_correct, 0) AS labels_validated_correct,
         |       COALESCE(label_counts.labels_validated_incorrect, 0) AS labels_validated_incorrect,
         |       COALESCE(label_counts.labels_not_validated, 0) AS labels_not_validated,
         |       COALESCE(validations.validations_given, 0) AS validations_given,
         |       COALESCE(validations.dissenting_validations_given, 0) AS dissenting_validations_given,
         |       COALESCE(validations.agree_validations_given, 0) AS agree_validations_given,
         |       COALESCE(validations.disagree_validations_given, 0) AS disagree_validations_given,
         |       COALESCE(validations.notsure_validations_given, 0) AS notsure_validations_given,
         |       COALESCE(label_counts.curb_ramp_labels, 0) AS curb_ramp_labels,
         |       COALESCE(label_counts.curb_ramp_validated_correct, 0) AS curb_ramp_validated_correct,
         |       COALESCE(label_counts.curb_ramp_validated_incorrect, 0) AS curb_ramp_validated_incorrect,
         |       COALESCE(label_counts.curb_ramp_not_validated, 0) AS curb_ramp_not_validated,
         |       COALESCE(label_counts.no_curb_ramp_labels, 0) AS no_curb_ramp_labels,
         |       COALESCE(label_counts.no_curb_ramp_validated_correct, 0) AS no_curb_ramp_validated_correct,
         |       COALESCE(label_counts.no_curb_ramp_validated_incorrect, 0) AS no_curb_ramp_validated_incorrect,
         |       COALESCE(label_counts.no_curb_ramp_not_validated, 0) AS no_curb_ramp_not_validated,
         |       COALESCE(label_counts.obstacle_labels, 0) AS obstacle_labels,
         |       COALESCE(label_counts.obstacle_validated_correct, 0) AS obstacle_validated_correct,
         |       COALESCE(label_counts.obstacle_validated_incorrect, 0) AS obstacle_validated_incorrect,
         |       COALESCE(label_counts.obstacle_not_validated, 0) AS obstacle_not_validated,
         |       COALESCE(label_counts.surface_problem_labels, 0) AS surface_problem_labels,
         |       COALESCE(label_counts.surface_problem_validated_correct, 0) AS surface_problem_validated_correct,
         |       COALESCE(label_counts.surface_problem_validated_incorrect, 0) AS surface_problem_validated_incorrect,
         |       COALESCE(label_counts.surface_problem_not_validated, 0) AS surface_problem_not_validated,
         |       COALESCE(label_counts.no_sidewalk_labels, 0) AS no_sidewalk_labels,
         |       COALESCE(label_counts.no_sidewalk_validated_correct, 0) AS no_sidewalk_validated_correct,
         |       COALESCE(label_counts.no_sidewalk_validated_incorrect, 0) AS no_sidewalk_validated_incorrect,
         |       COALESCE(label_counts.no_sidewalk_not_validated, 0) AS no_sidewalk_not_validated,
         |       COALESCE(label_counts.crosswalk_labels, 0) AS crosswalk_labels,
         |       COALESCE(label_counts.crosswalk_validated_correct, 0) AS crosswalk_validated_correct,
         |       COALESCE(label_counts.crosswalk_validated_incorrect, 0) AS crosswalk_validated_incorrect,
         |       COALESCE(label_counts.crosswalk_not_validated, 0) AS crosswalk_not_validated,
         |       COALESCE(label_counts.pedestrian_signal_labels, 0) AS pedestrian_signal_labels,
         |       COALESCE(label_counts.pedestrian_signal_validated_correct, 0) AS pedestrian_signal_validated_correct,
         |       COALESCE(label_counts.pedestrian_signal_validated_incorrect, 0) AS pedestrian_signal_validated_incorrect,
         |       COALESCE(label_counts.pedestrian_signal_not_validated, 0) AS pedestrian_signal_not_validated,
         |       COALESCE(label_counts.cant_see_sidewalk_labels, 0) AS cant_see_sidewalk_labels,
         |       COALESCE(label_counts.cant_see_sidewalk_validated_correct, 0) AS cant_see_sidewalk_validated_correct,
         |       COALESCE(label_counts.cant_see_sidewalk_validated_incorrect, 0) AS cant_see_sidewalk_validated_incorrect,
         |       COALESCE(label_counts.cant_see_sidewalk_not_validated, 0) AS cant_see_sidewalk_not_validated,
         |       COALESCE(label_counts.other_labels, 0) AS other_labels,
         |       COALESCE(label_counts.other_validated_correct, 0) AS other_validated_correct,
         |       COALESCE(label_counts.other_validated_incorrect, 0) AS other_validated_incorrect,
         |       COALESCE(label_counts.other_not_validated, 0) AS other_not_validated
         |FROM user_stat
         |INNER JOIN user_role ON user_stat.user_id = user_role.user_id
         |INNER JOIN role ON user_role.role_id = role.role_id
         |-- Validations given.
         |LEFT JOIN (
         |    SELECT user_id,
         |           COUNT(*) AS validations_given,
         |           COUNT(CASE WHEN (validation_result = 1 AND correct = FALSE)
         |                           OR (validation_result = 2 AND correct = TRUE) THEN 1 END) AS dissenting_validations_given,
         |           COUNT(CASE WHEN validation_result = 1 THEN 1 END) AS agree_validations_given,
         |           COUNT(CASE WHEN validation_result = 2 THEN 1 END) AS disagree_validations_given,
         |           COUNT(CASE WHEN validation_result = 3 THEN 1 END) AS notsure_validations_given
         |    FROM label_validation
         |    INNER JOIN label ON label_validation.label_id = label.label_id
         |    GROUP BY user_id
         |) AS validations ON user_stat.user_id = validations.user_id
         |-- Label and validation counts
         |LEFT JOIN (
         |    SELECT user_id,
         |           COUNT(*) AS labels,
         |           COUNT(CASE WHEN correct IS NOT NULL THEN 1 END) AS validated_labels,
         |           SUM(agree_count) + SUM(disagree_count) + SUM(notsure_count) AS validations_received,
         |           COUNT(CASE WHEN correct THEN 1 END) AS labels_validated_correct,
         |           COUNT(CASE WHEN NOT correct THEN 1 END) AS labels_validated_incorrect,
         |           COUNT(CASE WHEN correct IS NULL THEN 1 END) AS labels_not_validated,
         |           COUNT(CASE WHEN label_type = 'CurbRamp' THEN 1 END) AS curb_ramp_labels,
         |           COUNT(CASE WHEN label_type = 'CurbRamp' AND correct THEN 1 END) AS curb_ramp_validated_correct,
         |           COUNT(CASE WHEN label_type = 'CurbRamp' AND NOT correct THEN 1 END) AS curb_ramp_validated_incorrect,
         |           COUNT(CASE WHEN label_type = 'CurbRamp' AND correct IS NULL THEN 1 END) AS curb_ramp_not_validated,
         |           COUNT(CASE WHEN label_type = 'NoCurbRamp' THEN 1 END) AS no_curb_ramp_labels,
         |           COUNT(CASE WHEN label_type = 'NoCurbRamp' AND correct THEN 1 END) AS no_curb_ramp_validated_correct,
         |           COUNT(CASE WHEN label_type = 'NoCurbRamp' AND NOT correct THEN 1 END) AS no_curb_ramp_validated_incorrect,
         |           COUNT(CASE WHEN label_type = 'NoCurbRamp' AND correct IS NULL THEN 1 END) AS no_curb_ramp_not_validated,
         |           COUNT(CASE WHEN label_type = 'Obstacle' THEN 1 END) AS obstacle_labels,
         |           COUNT(CASE WHEN label_type = 'Obstacle' AND correct THEN 1 END) AS obstacle_validated_correct,
         |           COUNT(CASE WHEN label_type = 'Obstacle' AND NOT correct THEN 1 END) AS obstacle_validated_incorrect,
         |           COUNT(CASE WHEN label_type = 'Obstacle' AND correct IS NULL THEN 1 END) AS obstacle_not_validated,
         |           COUNT(CASE WHEN label_type = 'SurfaceProblem' THEN 1 END) AS surface_problem_labels,
         |           COUNT(CASE WHEN label_type = 'SurfaceProblem' AND correct THEN 1 END) AS surface_problem_validated_correct,
         |           COUNT(CASE WHEN label_type = 'SurfaceProblem' AND NOT correct THEN 1 END) AS surface_problem_validated_incorrect,
         |           COUNT(CASE WHEN label_type = 'SurfaceProblem' AND correct IS NULL THEN 1 END) AS surface_problem_not_validated,
         |           COUNT(CASE WHEN label_type = 'NoSidewalk' THEN 1 END) AS no_sidewalk_labels,
         |           COUNT(CASE WHEN label_type = 'NoSidewalk' AND correct THEN 1 END) AS no_sidewalk_validated_correct,
         |           COUNT(CASE WHEN label_type = 'NoSidewalk' AND NOT correct THEN 1 END) AS no_sidewalk_validated_incorrect,
         |           COUNT(CASE WHEN label_type = 'NoSidewalk' AND correct IS NULL THEN 1 END) AS no_sidewalk_not_validated,
         |           COUNT(CASE WHEN label_type = 'Crosswalk' THEN 1 END) AS crosswalk_labels,
         |           COUNT(CASE WHEN label_type = 'Crosswalk' AND correct THEN 1 END) AS crosswalk_validated_correct,
         |           COUNT(CASE WHEN label_type = 'Crosswalk' AND NOT correct THEN 1 END) AS crosswalk_validated_incorrect,
         |           COUNT(CASE WHEN label_type = 'Crosswalk' AND correct IS NULL THEN 1 END) AS crosswalk_not_validated,
         |           COUNT(CASE WHEN label_type = 'Signal' THEN 1 END) AS pedestrian_signal_labels,
         |           COUNT(CASE WHEN label_type = 'Signal' AND correct THEN 1 END) AS pedestrian_signal_validated_correct,
         |           COUNT(CASE WHEN label_type = 'Signal' AND NOT correct THEN 1 END) AS pedestrian_signal_validated_incorrect,
         |           COUNT(CASE WHEN label_type = 'Signal' AND correct IS NULL THEN 1 END) AS pedestrian_signal_not_validated,
         |           COUNT(CASE WHEN label_type = 'Occlusion' THEN 1 END) AS cant_see_sidewalk_labels,
         |           COUNT(CASE WHEN label_type = 'Occlusion' AND correct THEN 1 END) AS cant_see_sidewalk_validated_correct,
         |           COUNT(CASE WHEN label_type = 'Occlusion' AND NOT correct THEN 1 END) AS cant_see_sidewalk_validated_incorrect,
         |           COUNT(CASE WHEN label_type = 'Occlusion' AND correct IS NULL THEN 1 END) AS cant_see_sidewalk_not_validated,
         |           COUNT(CASE WHEN label_type = 'Other' THEN 1 END) AS other_labels,
         |           COUNT(CASE WHEN label_type = 'Other' AND correct THEN 1 END) AS other_validated_correct,
         |           COUNT(CASE WHEN label_type = 'Other' AND NOT correct THEN 1 END) AS other_validated_incorrect,
         |           COUNT(CASE WHEN label_type = 'Other' AND correct IS NULL THEN 1 END) AS other_not_validated
         |    FROM audit_task
         |    INNER JOIN label ON audit_task.audit_task_id = label.audit_task_id
         |    INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
         |    WHERE deleted = FALSE
         |        AND tutorial = FALSE
         |        AND label.street_edge_id <> ${LabelTable.tutorialStreetId}
         |        AND audit_task.street_edge_id <> ${LabelTable.tutorialStreetId}
         |    GROUP BY user_id
         |) label_counts ON user_stat.user_id = label_counts.user_id
         |WHERE role.role <> 'Anonymous';""".stripMargin
    )
    statsQuery.list
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
      userStats.insert(UserStat(0, userId.toString, 0F, None, true, None, 0, None, false))
    else
      0
  }
}
