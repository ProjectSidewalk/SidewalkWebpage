package models.user

import play.api.db.slick.DatabaseConfigProvider
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import play.api.db.slick.HasDatabaseConfigProvider
import com.google.inject.ImplementedBy
import slick.jdbc.GetResult

import java.time.OffsetDateTime

case class UserStat(userStatId: Int, userId: String, metersAudited: Float, labelsPerMeter: Option[Float],
                    highQuality: Boolean, highQualityManual: Option[Boolean], ownLabelsValidated: Int,
                    accuracy: Option[Float], excluded: Boolean)

case class LabelTypeStat(labels: Int, validatedCorrect: Int, validatedIncorrect: Int, notValidated: Int)
case class UserStatsForAdminPage(userId: String, username: String, email: String, role: String, team: Option[String],
                                 signUpTime: Option[OffsetDateTime], lastSignInTime: Option[OffsetDateTime],
                                 signInCount: Int, labels: Int, ownValidated: Int, ownValidatedAgreedPct: Double,
                                 othersValidated: Int, othersValidatedAgreedPct: Double, highQuality: Boolean)
case class UserStatAPI(userId: String, labels: Int, metersExplored: Float, labelsPerMeter: Option[Float],
                       highQuality: Boolean, highQualityManual: Option[Boolean], labelAccuracy: Option[Float],
                       validatedLabels: Int, validationsReceived: Int, labelsValidatedCorrect: Int,
                       labelsValidatedIncorrect: Int, labelsNotValidated: Int, validationsGiven: Int,
                       dissentingValidationsGiven: Int, agreeValidationsGiven: Int, disagreeValidationsGiven: Int,
                       unsureValidationsGiven: Int, statsByLabelType: Map[String, LabelTypeStat])
object UserStatAPI {
  val csvHeader: String = "User ID,Labels,Meters Explored,Labels per Meter,High Quality,High Quality Manual," +
    "Label Accuracy,Validated Labels,Validations Received,Labels Validated Correct,Labels Validated Incorrect," +
    "Labels Not Validated,Validations Given,Dissenting Validations Given,Agree Validations Given," +
    "Disagree Validations Given,Unsure Validations Given,Curb Ramp Labels,Curb Ramps Validated Correct," +
    "Curb Ramps Validated Incorrect,Curb Ramps Not Validated,No Curb Ramp Labels,No Curb Ramps Validated Correct," +
    "No Curb Ramps Validated Incorrect,No Curb Ramps Not Validated,Obstacle Labels,Obstacles Validated Correct," +
    "Obstacles Validated Incorrect,Obstacles Not Validated,Surface Problem Labels,Surface Problems Validated Correct," +
    "Surface Problems Validated Incorrect,Surface Problems Not Validated,No Sidewalk Labels," +
    "No Sidewalks Validated Correct,No Sidewalks Validated Incorrect,No Sidewalks Not Validated,Crosswalk Labels," +
    "Crosswalks Validated Correct,Crosswalks Validated Incorrect,Crosswalks Not Validated,Pedestrian Signal Labels," +
    "Pedestrian Signals Validated Correct,Pedestrian Signals Validated Incorrect,Pedestrian Signals Not Validated," +
    "Cant See Sidewalk Labels,Cant See Sidewalks Validated Correct,Cant See Sidewalks Validated Incorrect," +
    "Cant See Sidewalks Not Validated,Other Labels,Others Validated Correct,Others Validated Incorrect," +
    "Others Not Validated"
}
case class UserCount(count: Int, timeInterval: String, taskCompletedOnly: Boolean, highQualityOnly: Boolean) {
  require(Seq("today", "week", "all_time").contains(timeInterval.toLowerCase()))
}

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

@ImplementedBy(classOf[UserStatTable])
trait UserStatTableRepository {
  def isExcludedUser(userId: String): DBIO[Boolean]
}

@Singleton
class UserStatTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
  extends UserStatTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._

  val userStats = TableQuery[UserStatTableDef]

//  val LABEL_PER_METER_THRESHOLD: Float = 0.0375.toFloat
//
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

  def isExcludedUser(userId: String): DBIO[Boolean] = {
    userStats.filter(_.userId === userId).map(_.excluded).result.head
  }

//  /**
//   * Get list of users whose data needs to be re-clustered.
//   *
//   * We find the list of users by determining which labels _should_ show up in the API and compare that to which labels
//   * _are_present in the API. Any mismatches indicate that the user's data should be re-clustered.
//   */
//  def usersToUpdateInAPI(): List[String] = db.withSession { implicit session =>
//    // Get the labels that are currently present in the API.
//    val labelsInAPI = for {
//      _ual <- userAttributeLabels
//      _l <- LabelTable.labelsUnfiltered if _ual.labelId === _l.labelId
//    } yield (_l.userId, _l.labelId)
//
//    // Find all mismatches between the list of labels above using an outer join.
//    UserClusteringSessionTable.labelsForAPIQuery
//      .outerJoin(labelsInAPI).on(_._2 === _._2)            // FULL OUTER JOIN.
//      .filter(x => x._1._2.?.isEmpty || x._2._2.?.isEmpty) // WHERE no_api.label_id IS NULL OR in_api.label_id IS NULL.
//      .map(x => (x._1._1.?, x._2._1.?))                    // SELECT no_api.user_id, in_api.user_id.
//      .list.map(x => x._1.getOrElse(x._2.get)).distinct    // Combine the two and do a SELECT DISTINCT.
//  }
//
//  /**
//   * Calls functions to update all columns in user_stat table. Only updates users who have audited since cutoff time.
//   */
//  def updateUserStatTable(cutoffTime: Timestamp) = db.withSession { implicit session =>
//    updateAuditedDistance(cutoffTime)
//    updateLabelsPerMeter(cutoffTime)
//    updateAccuracy(List())
//    updateHighQuality(cutoffTime)
//  }
//
//  /**
//   * Update meters_audited column in the user_stat table for users who have done any auditing since `cutoffTime`.
//   */
//  def updateAuditedDistance(cutoffTime: Timestamp) = db.withSession { implicit session =>
//
//    // Get the list of users who have done any auditing since the cutoff time.
//    val usersToUpdate: List[String] = (for {
//      _user <- userTable if _user.username =!= "anonymous"
//      _mission <- MissionTable.auditMissions if _mission.userId === _user.userId
//      if _mission.missionEnd > cutoffTime
//    } yield _user.userId).groupBy(x => x).map(_._1).list
//
//    // Computes the audited distance in meters using the audit_task and street_edge tables.
//    val auditedDists: List[(String, Option[Float])] =
//      AuditTaskTable.completedTasks
//        .filter(_.userId inSet usersToUpdate)
//        .innerJoin(StreetEdgeTable.streetEdges).on(_.streetEdgeId === _.streetEdgeId)
//        .groupBy(_._1.userId).map(x => (x._1, x._2.map(_._2.geom.transform(26918).length).sum))
//        .list
//
//    // Update the meters_audited column in the user_stat table.
//    for ((userId, auditedDist) <- auditedDists) {
//      val updateQuery = for { _userStat <- userStats if _userStat.userId === userId } yield _userStat.metersAudited
//      updateQuery.update(auditedDist.getOrElse(0F))
//    }
//  }
//
//  /**
//   * Update labels_per_meter column in the user_stat table for all users who have done any auditing since `cutoffTime`.
//   */
//  def updateLabelsPerMeter(cutoffTime: Timestamp) = db.withSession { implicit session =>
//
//    // Get the list of users who have done any auditing since the cutoff time.
//    val usersStatsToUpdate: List[String] = usersThatAuditedSinceCutoffTime(cutoffTime)
//
//    // Compute label counts for each of those users.
//    val labelCounts = (for {
//      _mission <- MissionTable.auditMissions
//      _label <- LabelTable.labelsWithExcludedUsers if _mission.missionId === _label.missionId
//      if _mission.userId inSet usersStatsToUpdate
//    } yield (_mission.userId, _label.labelId)).groupBy(_._1).map(x => (x._1, x._2.length))
//
//    // Compute labeling frequency using label counts above and the meters_audited column in user_stat table.
//    val labelFreq: List[(String, Float)] = userStats
//      .filter(_.userId inSet usersStatsToUpdate)
//      .leftJoin(labelCounts).on(_.userId === _._1)
//      .map { case (_stat, _count) =>
//        (_stat.userId, _count._2.ifNull(0.asColumnOf[Int]).asColumnOf[Float] / _stat.metersAudited)
//      }.list
//
//    // Update the labels_per_meter column in the user_stat table.
//    for ((userId, labelingFreq) <- labelFreq) {
//      val updateQuery = for { _userStat <- userStats if _userStat.userId === userId } yield _userStat.labelsPerMeter
//      updateQuery.update(Some(labelingFreq))
//    }
//  }

  /**
   * Update the accuracy column in the user_stat table for the given users, or every user if list is empty.
   *
   * @param users A list of user_ids to update, update all users if list is empty.
   */
  def updateAccuracy(users: Seq[String]) = {
    val filterStatement: String =
      if (users.isEmpty) ""
      else s"""AND label.user_id IN ('${users.mkString("','")}')"""

    sql"""
      SELECT user_stat.user_id, new_validated_count, new_accuracy
      FROM user_stat
      INNER JOIN (
          SELECT user_id,
                 CAST(SUM(CASE WHEN correct THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(SUM(CASE WHEN correct THEN 1 ELSE 0 END) + SUM(CASE WHEN NOT correct THEN 1 ELSE 0 END), 0) AS new_accuracy,
                 COUNT(CASE WHEN correct IS NOT NULL THEN 1 END) AS new_validated_count
          FROM label
          WHERE label.deleted = FALSE
              AND label.tutorial = FALSE
              #$filterStatement
          GROUP BY user_id
      ) "accuracy_subquery" ON user_stat.user_id = accuracy_subquery.user_id
      -- Filter out users if their validated count and accuracy are unchanged from what's already in the database.
      WHERE own_labels_validated <> new_validated_count
          OR (accuracy IS NULL AND new_accuracy IS NOT NULL)
          OR (accuracy IS NOT NULL AND new_accuracy IS NULL)
          OR (accuracy IS NOT NULL AND new_accuracy IS NOT NULL AND ROUND(accuracy::NUMERIC, 3) <> ROUND(new_accuracy::NUMERIC, 3));
    """.as[(String, Int, Option[Float])]
      .map { usersToUpdate =>
        for ((userId, validatedCount, accuracy) <- usersToUpdate) {
          val updateQuery = for {_us <- userStats if _us.userId === userId} yield (_us.ownLabelsValidated, _us.accuracy)
          updateQuery.update((validatedCount, accuracy))
        }
      }
  }

//  /**
//   * Update high_quality col in user_stat table, run after updateAuditedDistance, updateLabelsPerMeter, updateAccuracy.
//   *
//   * Users are considered low quality if they either:
//   * 1. have been manually marked as high_quality_manual = FALSE in the user_stat table,
//   * 2. have a labeling frequency below `LABEL_PER_METER_THRESHOLD`, or
//   * 3. have an accuracy rating below 60% (with at least 50 of their labels validated).
//   *
//   * @return Number of user's whose records were updated.
//   */
//  def updateHighQuality(cutoffTime: Timestamp): Int = db.withSession { implicit session =>
//
//    // First get users manually marked as low quality or marked to be excluded for other reasons.
//    val lowQualUsers: List[(String, Boolean)] =
//      userStats.filter(u => u.excluded || !u.highQualityManual.getOrElse(true))
//        .map(x => (x.userId, false)).list
//
//    // Decide if each user is high quality. Conditions in the method comment. Users manually marked for exclusion or
//    // low quality are filtered out later (using results from the previous query).
//    val userQual: List[(String, Boolean)] = {
//      userStats.filter(x => x.highQualityManual.isEmpty || x.highQualityManual).map { x =>
//        (
//          x.userId,
//          x.highQualityManual.getOrElse(false) || (
//            (x.metersAudited === 0F || x.labelsPerMeter.getOrElse(5F) > LABEL_PER_METER_THRESHOLD)
//              && (x.accuracy.getOrElse(1.0F) > 0.6F.asColumnOf[Float] || x.ownLabelsValidated < 50.asColumnOf[Int])
//            )
//        )
//      }.list
//    }
//
//    // Get the list of users who have done any auditing since the cutoff time. Will only update these users.
//    val usersToUpdate: List[String] =
//      (usersThatAuditedSinceCutoffTime(cutoffTime) ++ usersValidatedSinceCutoffTime(cutoffTime)).distinct
//
//    // Make separate lists for low vs high quality users, then bulk update each.
//    val updateToHighQual: List[String] =
//      userQual.filter(x => x._2 && !lowQualUsers.map(_._1).contains(x._1) && usersToUpdate.contains(x._1)).map(_._1)
//    val updateToLowQual: List[String] =
//      (lowQualUsers ++ userQual.filterNot(_._2)).map(_._1).filter(x => usersToUpdate.contains(x))
//
//    val lowQualityUpdateQuery = for { _u <- userStats if _u.userId inSet updateToLowQual } yield _u.highQuality
//    val highQualityUpdateQuery = for { _u <- userStats if _u.userId inSet updateToHighQual } yield _u.highQuality
//
//    // Do both bulk updates, and return total number of updated rows.
//    lowQualityUpdateQuery.update(false) + highQualityUpdateQuery.update(true)
//  }
//
//  /**
//   * Helper function to get list of users who have done any auditing since the cutoff time.
//   */
//  def usersThatAuditedSinceCutoffTime(cutoffTime: Timestamp): List[String] = db.withSession { implicit session =>
//    (for {
//      _user <- userTable
//      _userStat <- userStats if _user.userId === _userStat.userId
//      _mission <- MissionTable.auditMissions if _mission.userId === _user.userId
//      if _user.username =!= "anonymous"
//      if _userStat.metersAudited > 0F
//      if _mission.missionEnd > cutoffTime
//    } yield _user.userId).groupBy(x => x).map(_._1).list
//  }
//
//  /**
//   * Helper function to get list of users who have had any of their labels validated since the cutoff time.
//   */
//  def usersValidatedSinceCutoffTime(cutoffTime: Timestamp): List[String] = db.withSession { implicit session =>
//    (for {
//      _labelVal <- LabelValidationTable.validationLabels
//      _label <- LabelTable.labels if _labelVal.labelId === _label.labelId
//      _user <- userTable if _label.userId === _user.userId
//      if _user.username =!= "anonymous"
//      if _labelVal.endTimestamp > cutoffTime
//    } yield _user.userId).groupBy(x => x).map(_._1).list
//  }

  /**
   * Gets leaderboard stats for the top `n` users in the given time period.
   *
   * Top users are calculated using: score = sqrt(# labels) * (0.5 * distance_audited / city_distance + 0.5 * accuracy).
   * Stats can be calculated for individual users or across teams. Overall and weekly are the possible time periods. We
   * only include accuracy if the user has at least 10 validated labels (must have either agree or disagree based off
   * majority vote; a unsure or tie does not count).
   * @param n The number of top users to get stats for
   * @param timePeriod The time period over which to compute stats, either "weekly" or "overall"
   * @param byTeam True if grouping by team instead of by user.
   * @param teamId The id of the team over which to compute stats
   * @return
   */
  def getLeaderboardStats(n: Int, timePeriod: String = "overall", byTeam: Boolean = false, teamId: Option[Int] = None, streetDistance: Float): DBIO[Seq[LeaderboardStat]] = {
    val statStartTime = timePeriod.toLowerCase() match {
      case "overall" => """TIMESTAMP 'epoch'"""
      case "weekly" => """(now() AT TIME ZONE 'US/Pacific')::date - (cast(extract(dow from (now() AT TIME ZONE 'US/Pacific')::date) as int) % 7) + TIME '00:00:00'"""
    }
    val joinUserTeamTable: String = if (byTeam || teamId.isDefined) {
      "INNER JOIN user_team ON sidewalk_user.user_id = user_team.user_id INNER JOIN team ON user_team.team_id = team.team_id"
    } else {
      ""
    }
    val teamFilter: String = teamId match {
      case Some(id) => s"AND user_team.team_id = $id"
      case None =>
        if (byTeam) "AND team.visible = TRUE"
        else ""
    }
    // There are quite a few changes to make to the query when grouping by team instead of user. All of those below.
    val groupingCol: String = if (byTeam) "user_team.team_id" else "sidewalk_user.user_id"
    val groupingColName: String = if (byTeam) "team_id" else "user_id"
    val joinUserTeamForAcc: String = if (byTeam) "INNER JOIN user_team ON label.user_id = user_team.user_id" else ""
    val usernamesJoin: String = {
      if (byTeam) {
        "INNER JOIN (SELECT team_id, name AS username FROM team) \"usernames\" ON label_counts.team_id = usernames.team_id"
      } else {
        "INNER JOIN (SELECT user_id, username FROM sidewalk_user) \"usernames\" ON label_counts.user_id = usernames.user_id"
      }
    }
    sql"""
      SELECT usernames.username,
             label_counts.label_count,
             mission_count,
             distance_meters,
             CASE WHEN validated_count > 9 THEN accuracy_temp ELSE NULL END AS accuracy,
             CASE WHEN accuracy_temp IS NOT NULL
                 THEN SQRT(label_counts.label_count) * (0.5 * distance_meters / #$streetDistance + 0.5 * accuracy_temp)
                 ELSE SQRT(label_counts.label_count) * (distance_meters / #$streetDistance)
                 END AS score
      FROM (
          SELECT #$groupingCol, COUNT(label_id) AS label_count
          FROM sidewalk_user
          INNER JOIN user_role ON sidewalk_user.user_id = user_role.user_id
          INNER JOIN role ON user_role.role_id = role.role_id
          INNER JOIN user_stat ON sidewalk_user.user_id = user_stat.user_id
          INNER JOIN label ON sidewalk_user.user_id = label.user_id
          #$joinUserTeamTable
          WHERE label.deleted = FALSE
              AND label.tutorial = FALSE
              AND role.role IN ('Registered', 'Administrator', 'Researcher')
              AND user_stat.excluded = FALSE
              AND (label.time_created AT TIME ZONE 'US/Pacific') > #$statStartTime
              #$teamFilter
          GROUP BY #$groupingCol
          ORDER BY label_count DESC
          LIMIT $n
      ) "label_counts"
      #$usernamesJoin
      INNER JOIN (
          SELECT #$groupingCol, COUNT(mission_id) AS mission_count
          FROM mission
          INNER JOIN sidewalk_user ON mission.user_id = sidewalk_user.user_id
          #$joinUserTeamTable
          WHERE (mission_end AT TIME ZONE 'US/Pacific') > #$statStartTime
          GROUP BY #$groupingCol
      ) "missions_counts" ON label_counts.#$groupingColName = missions_counts.#$groupingColName
      INNER JOIN (
          SELECT #$groupingCol, COALESCE(SUM(ST_LENGTH(ST_TRANSFORM(geom, 26918))), 0) AS distance_meters
          FROM street_edge
          INNER JOIN audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
          INNER JOIN sidewalk_user ON audit_task.user_id = sidewalk_user.user_id
          #$joinUserTeamTable
          WHERE audit_task.completed
              AND (task_end AT TIME ZONE 'US/Pacific') > #$statStartTime
          GROUP BY #$groupingCol
      ) "distance" ON label_counts.#$groupingColName = distance.#$groupingColName
      LEFT JOIN (
          SELECT #$groupingColName,
                 CAST(SUM(CASE WHEN correct THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(SUM(CASE WHEN correct THEN 1 ELSE 0 END) + SUM(CASE WHEN NOT correct THEN 1 ELSE 0 END), 0) AS accuracy_temp,
                 COUNT(CASE WHEN correct IS NOT NULL THEN 1 END) AS validated_count
          FROM label
          #$joinUserTeamForAcc
          WHERE (label.time_created AT TIME ZONE 'US/Pacific') > #$statStartTime
          GROUP BY #$groupingColName
      ) "accuracy" ON label_counts.#$groupingColName = accuracy.#$groupingColName
      ORDER BY score DESC;
    """.as[(String, Int, Int, Float, Option[Float], Float)]
      .map(_.map { stat =>
        // Run the query and, if it's not a team name, remove the "@X.Y" from usernames that are just email addresses.
        if (!byTeam && isValidEmail(stat._1))
          LeaderboardStat(stat._1.slice(0, stat._1.lastIndexOf('@')), stat._2, stat._3, stat._4, stat._5, stat._6)
        else LeaderboardStat.tupled(stat)
      })
  }

  /**
   * Computes some stats on users that will be served through a public API.
   */
  def getStatsForAPI: DBIO[Seq[UserStatAPI]] = {
    sql"""
      SELECT user_stat.user_id,
             COALESCE(label_counts.labels, 0) AS labels,
             user_stat.meters_audited AS meters_explored,
             user_stat.labels_per_meter,
             user_stat.high_quality,
             user_stat.high_quality_manual,
             user_stat.accuracy AS label_accuracy,
             COALESCE(label_counts.validated_labels, 0) AS validated_labels,
             COALESCE(label_counts.validations_received, 0) AS validations_received,
             COALESCE(label_counts.labels_validated_correct, 0) AS labels_validated_correct,
             COALESCE(label_counts.labels_validated_incorrect, 0) AS labels_validated_incorrect,
             COALESCE(label_counts.labels_not_validated, 0) AS labels_not_validated,
             COALESCE(validations.validations_given, 0) AS validations_given,
             COALESCE(validations.dissenting_validations_given, 0) AS dissenting_validations_given,
             COALESCE(validations.agree_validations_given, 0) AS agree_validations_given,
             COALESCE(validations.disagree_validations_given, 0) AS disagree_validations_given,
             COALESCE(validations.unsure_validations_given, 0) AS unsure_validations_given,
             COALESCE(label_counts.curb_ramp_labels, 0) AS curb_ramp_labels,
             COALESCE(label_counts.curb_ramp_validated_correct, 0) AS curb_ramp_validated_correct,
             COALESCE(label_counts.curb_ramp_validated_incorrect, 0) AS curb_ramp_validated_incorrect,
             COALESCE(label_counts.curb_ramp_not_validated, 0) AS curb_ramp_not_validated,
             COALESCE(label_counts.no_curb_ramp_labels, 0) AS no_curb_ramp_labels,
             COALESCE(label_counts.no_curb_ramp_validated_correct, 0) AS no_curb_ramp_validated_correct,
             COALESCE(label_counts.no_curb_ramp_validated_incorrect, 0) AS no_curb_ramp_validated_incorrect,
             COALESCE(label_counts.no_curb_ramp_not_validated, 0) AS no_curb_ramp_not_validated,
             COALESCE(label_counts.obstacle_labels, 0) AS obstacle_labels,
             COALESCE(label_counts.obstacle_validated_correct, 0) AS obstacle_validated_correct,
             COALESCE(label_counts.obstacle_validated_incorrect, 0) AS obstacle_validated_incorrect,
             COALESCE(label_counts.obstacle_not_validated, 0) AS obstacle_not_validated,
             COALESCE(label_counts.surface_problem_labels, 0) AS surface_problem_labels,
             COALESCE(label_counts.surface_problem_validated_correct, 0) AS surface_problem_validated_correct,
             COALESCE(label_counts.surface_problem_validated_incorrect, 0) AS surface_problem_validated_incorrect,
             COALESCE(label_counts.surface_problem_not_validated, 0) AS surface_problem_not_validated,
             COALESCE(label_counts.no_sidewalk_labels, 0) AS no_sidewalk_labels,
             COALESCE(label_counts.no_sidewalk_validated_correct, 0) AS no_sidewalk_validated_correct,
             COALESCE(label_counts.no_sidewalk_validated_incorrect, 0) AS no_sidewalk_validated_incorrect,
             COALESCE(label_counts.no_sidewalk_not_validated, 0) AS no_sidewalk_not_validated,
             COALESCE(label_counts.crosswalk_labels, 0) AS crosswalk_labels,
             COALESCE(label_counts.crosswalk_validated_correct, 0) AS crosswalk_validated_correct,
             COALESCE(label_counts.crosswalk_validated_incorrect, 0) AS crosswalk_validated_incorrect,
             COALESCE(label_counts.crosswalk_not_validated, 0) AS crosswalk_not_validated,
             COALESCE(label_counts.pedestrian_signal_labels, 0) AS pedestrian_signal_labels,
             COALESCE(label_counts.pedestrian_signal_validated_correct, 0) AS pedestrian_signal_validated_correct,
             COALESCE(label_counts.pedestrian_signal_validated_incorrect, 0) AS pedestrian_signal_validated_incorrect,
             COALESCE(label_counts.pedestrian_signal_not_validated, 0) AS pedestrian_signal_not_validated,
             COALESCE(label_counts.cant_see_sidewalk_labels, 0) AS cant_see_sidewalk_labels,
             COALESCE(label_counts.cant_see_sidewalk_validated_correct, 0) AS cant_see_sidewalk_validated_correct,
             COALESCE(label_counts.cant_see_sidewalk_validated_incorrect, 0) AS cant_see_sidewalk_validated_incorrect,
             COALESCE(label_counts.cant_see_sidewalk_not_validated, 0) AS cant_see_sidewalk_not_validated,
             COALESCE(label_counts.other_labels, 0) AS other_labels,
             COALESCE(label_counts.other_validated_correct, 0) AS other_validated_correct,
             COALESCE(label_counts.other_validated_incorrect, 0) AS other_validated_incorrect,
             COALESCE(label_counts.other_not_validated, 0) AS other_not_validated
      FROM user_stat
      INNER JOIN user_role ON user_stat.user_id = user_role.user_id
      INNER JOIN role ON user_role.role_id = role.role_id
      -- Validations given.
      LEFT JOIN (
          SELECT label_validation.user_id,
                 COUNT(*) AS validations_given,
                 COUNT(CASE WHEN (validation_result = 1 AND correct = FALSE)
                                 OR (validation_result = 2 AND correct = TRUE) THEN 1 END) AS dissenting_validations_given,
                 COUNT(CASE WHEN validation_result = 1 THEN 1 END) AS agree_validations_given,
                 COUNT(CASE WHEN validation_result = 2 THEN 1 END) AS disagree_validations_given,
                 COUNT(CASE WHEN validation_result = 3 THEN 1 END) AS unsure_validations_given
          FROM label_validation
          INNER JOIN label ON label_validation.label_id = label.label_id
          GROUP BY label_validation.user_id
      ) AS validations ON user_stat.user_id = validations.user_id
      -- Label and validation counts
      LEFT JOIN (
          SELECT audit_task.user_id,
                 COUNT(*) AS labels,
                 COUNT(CASE WHEN correct IS NOT NULL THEN 1 END) AS validated_labels,
                 SUM(agree_count) + SUM(disagree_count) + SUM(unsure_count) AS validations_received,
                 COUNT(CASE WHEN correct THEN 1 END) AS labels_validated_correct,
                 COUNT(CASE WHEN NOT correct THEN 1 END) AS labels_validated_incorrect,
                 COUNT(CASE WHEN correct IS NULL THEN 1 END) AS labels_not_validated,
                 COUNT(CASE WHEN label_type = 'CurbRamp' THEN 1 END) AS curb_ramp_labels,
                 COUNT(CASE WHEN label_type = 'CurbRamp' AND correct THEN 1 END) AS curb_ramp_validated_correct,
                 COUNT(CASE WHEN label_type = 'CurbRamp' AND NOT correct THEN 1 END) AS curb_ramp_validated_incorrect,
                 COUNT(CASE WHEN label_type = 'CurbRamp' AND correct IS NULL THEN 1 END) AS curb_ramp_not_validated,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' THEN 1 END) AS no_curb_ramp_labels,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' AND correct THEN 1 END) AS no_curb_ramp_validated_correct,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' AND NOT correct THEN 1 END) AS no_curb_ramp_validated_incorrect,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' AND correct IS NULL THEN 1 END) AS no_curb_ramp_not_validated,
                 COUNT(CASE WHEN label_type = 'Obstacle' THEN 1 END) AS obstacle_labels,
                 COUNT(CASE WHEN label_type = 'Obstacle' AND correct THEN 1 END) AS obstacle_validated_correct,
                 COUNT(CASE WHEN label_type = 'Obstacle' AND NOT correct THEN 1 END) AS obstacle_validated_incorrect,
                 COUNT(CASE WHEN label_type = 'Obstacle' AND correct IS NULL THEN 1 END) AS obstacle_not_validated,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' THEN 1 END) AS surface_problem_labels,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' AND correct THEN 1 END) AS surface_problem_validated_correct,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' AND NOT correct THEN 1 END) AS surface_problem_validated_incorrect,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' AND correct IS NULL THEN 1 END) AS surface_problem_not_validated,
                 COUNT(CASE WHEN label_type = 'NoSidewalk' THEN 1 END) AS no_sidewalk_labels,
                 COUNT(CASE WHEN label_type = 'NoSidewalk' AND correct THEN 1 END) AS no_sidewalk_validated_correct,
                 COUNT(CASE WHEN label_type = 'NoSidewalk' AND NOT correct THEN 1 END) AS no_sidewalk_validated_incorrect,
                 COUNT(CASE WHEN label_type = 'NoSidewalk' AND correct IS NULL THEN 1 END) AS no_sidewalk_not_validated,
                 COUNT(CASE WHEN label_type = 'Crosswalk' THEN 1 END) AS crosswalk_labels,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND correct THEN 1 END) AS crosswalk_validated_correct,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND NOT correct THEN 1 END) AS crosswalk_validated_incorrect,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND correct IS NULL THEN 1 END) AS crosswalk_not_validated,
                 COUNT(CASE WHEN label_type = 'Signal' THEN 1 END) AS pedestrian_signal_labels,
                 COUNT(CASE WHEN label_type = 'Signal' AND correct THEN 1 END) AS pedestrian_signal_validated_correct,
                 COUNT(CASE WHEN label_type = 'Signal' AND NOT correct THEN 1 END) AS pedestrian_signal_validated_incorrect,
                 COUNT(CASE WHEN label_type = 'Signal' AND correct IS NULL THEN 1 END) AS pedestrian_signal_not_validated,
                 COUNT(CASE WHEN label_type = 'Occlusion' THEN 1 END) AS cant_see_sidewalk_labels,
                 COUNT(CASE WHEN label_type = 'Occlusion' AND correct THEN 1 END) AS cant_see_sidewalk_validated_correct,
                 COUNT(CASE WHEN label_type = 'Occlusion' AND NOT correct THEN 1 END) AS cant_see_sidewalk_validated_incorrect,
                 COUNT(CASE WHEN label_type = 'Occlusion' AND correct IS NULL THEN 1 END) AS cant_see_sidewalk_not_validated,
                 COUNT(CASE WHEN label_type = 'Other' THEN 1 END) AS other_labels,
                 COUNT(CASE WHEN label_type = 'Other' AND correct THEN 1 END) AS other_validated_correct,
                 COUNT(CASE WHEN label_type = 'Other' AND NOT correct THEN 1 END) AS other_validated_incorrect,
                 COUNT(CASE WHEN label_type = 'Other' AND correct IS NULL THEN 1 END) AS other_not_validated
          FROM audit_task
          INNER JOIN label ON audit_task.audit_task_id = label.audit_task_id
          INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
          WHERE deleted = FALSE
              AND tutorial = FALSE
              AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
              AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
          GROUP BY audit_task.user_id
      ) label_counts ON user_stat.user_id = label_counts.user_id
      WHERE role.role <> 'Anonymous'
          AND user_stat.excluded = FALSE;""".as[UserStatAPI]
  }

  /**
   * Get all users, excluding anon users who haven't placed any labels or done any validations (to limit table size).
   */
//  def usersMinusAnonUsersWithNoLabelsAndNoValidations: Query[(UserTable, RoleTable), (DBUser, Role), Seq] = {
//    //    val anonUsersWithLabels = (for {
//    //      _user <- userTable
//    //      _userRole <- userRoleTable if _user.userId === _userRole.userId
//    //      _role <- roleTable if _userRole.roleId === _role.roleId
//    //      _label <- LabelTable.labelsWithTutorialAndExcludedUsers if _user.userId === _label.userId
//    //      if _role.role === "Anonymous"
//    //    } yield (_user, _role)).groupBy(x => x).map(_._1)
//    //
//    //    val anonUsersWithValidations = (for {
//    //      _user <- userTable
//    //      _userRole <- userRoleTable if _user.userId === _userRole.userId
//    //      _role <- roleTable if _userRole.roleId === _role.roleId
//    //      _labelValidation <- LabelValidationTable.validationLabels if _user.userId === _labelValidation.userId
//    //      if _role.role === "Anonymous"
//    //    } yield (_user, _role)).groupBy(x => x).map(_._1)
//
//    val otherUsers = for {
//      _user <- userTable
//      _userRole <- userRoleTable if _user.userId === _userRole.userId
//      _role <- roleTable if _userRole.roleId === _role.roleId
//      if _role.role =!= "Anonymous"
//    } yield (_user, _role)
//
//    // TODO Only returning non-anonymous users temporarily:
//    // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/3802
//    //    anonUsersWithLabels.union(anonUsersWithValidations) ++ otherUsers
//    otherUsers
//  }

  /**
   * Returns a count of all users under the specified conditions.
   * @param timeInterval can be "today" or "week". If anything else, defaults to "all_time".
   * @param taskCompletedOnly if true, only counts users who have completed one audit task or at least one validation.
   * @param highQualityOnly if true, only counts users who are marked as high quality.
   */
  def countAllUsersContributed(timeInterval: String = "all_time", taskCompletedOnly: Boolean = false, highQualityOnly: Boolean = false): DBIO[UserCount] = {
    require(Seq("today", "week", "all_time").contains(timeInterval.toLowerCase()))

    // Build up SQL string related to validation and audit task time intervals.
    // Defaults to *not* specifying a time (which is the same thing as "all_time").
    val (lblValidationTimeIntervalSql, auditTaskTimeIntervalSql) = timeInterval.toLowerCase() match {
      case "today" => (
        "(mission.mission_end AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date",
        "(audit_task.task_end AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date"
      )
      case "week" => (
        "(mission.mission_end AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'",
        "(audit_task.task_end AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'"
      )
      case _ => ("TRUE", "TRUE")
    }

    // Add in the optional SQL WHERE statement for filtering on high quality users.
    val highQualityOnlySql =
      if (highQualityOnly) "user_stat.high_quality"
      else "NOT user_stat.excluded"

    // Add in the task completion logic.
    val auditTaskCompletedSql = if (taskCompletedOnly) "audit_task.completed = TRUE" else "TRUE"
    val validationCompletedSql = if (taskCompletedOnly) "label_validation.end_timestamp IS NOT NULL" else "TRUE"

    sql"""
      SELECT COUNT(DISTINCT(users.user_id))
      FROM (
          SELECT DISTINCT(mission.user_id)
          FROM mission
          INNER JOIN mission_type ON mission.mission_type_id = mission_type.mission_type_id
          LEFT JOIN label_validation ON mission.mission_id = label_validation.mission_id
          WHERE mission_type.mission_type IN ('validation', 'labelmapValidation')
              AND #$lblValidationTimeIntervalSql
              AND #$validationCompletedSql
          UNION
          SELECT DISTINCT(user_id)
          FROM audit_task
          WHERE #$auditTaskCompletedSql
              AND #$auditTaskTimeIntervalSql
      ) users
      INNER JOIN user_stat ON users.user_id = user_stat.user_id
      WHERE #$highQualityOnlySql;
    """.as[Int].head.map(n => UserCount(n, timeInterval, taskCompletedOnly, highQualityOnly))
  }

//  /**
//   * Count the number of users of the given role who have ever started (or completed) validating a label.
//   */
//  def countValidationUsersContributed(roles: List[String], labelValidated: Boolean): Int = db.withSession { implicit session =>
//
//    val users =
//      if (labelValidated) LabelValidationTable.validationLabels.map(_.userId)
//      else MissionTable.validationMissions.map(_.userId)
//
//    val filteredUsers = for {
//      _users <- users
//      _userTable <- userTable if _users === _userTable.userId
//      _userRole <- userRoleTable if _userTable.userId === _userRole.userId
//      _role <- roleTable if _userRole.roleId === _role.roleId
//      if _userTable.username =!= "anonymous"
//      if _role.role inSet roles
//    } yield _userTable.userId
//
//    // The group by and map does a SELECT DISTINCT, and the list.length does the COUNT.
//    filteredUsers.groupBy(x => x).map(_._1).size.run
//  }
//
//  /**
//   * Count the number of researchers who have ever started (or completed) validating a label.
//   *
//   * Researchers include the Researcher, Administrator, and Owner roles.
//   */
//  def countValidationResearchersContributed(labelValidated: Boolean): Int = db.withSession { implicit session =>
//    countValidationUsersContributed(List("Researcher", "Administrator", "Owner"), labelValidated)
//  }
//
//  /**
//   * Count the number of users who have ever started (or completed) validating a label (across all roles).
//   */
//  def countAllValidationUsersContributed(taskCompleted: Boolean): Int = db.withSession { implicit session =>
//    countValidationUsersContributed(roleTable.map(_.role).list, taskCompleted)
//  }
//
//  /**
//   * Count the number of users of the given role who contributed validations today.
//   *
//   * We consider a "contribution" to mean that a user has validated a label.
//   */
//  def countValidationUsersContributedToday(role: String): Int = db.withSession { implicit session =>
//    val countQuery = Q.query[String, Int](
//      """SELECT COUNT(DISTINCT(label_validation.user_id))
//        |FROM label_validation
//        |INNER JOIN sidewalk_user ON sidewalk_user.user_id = label_validation.user_id
//        |INNER JOIN user_role ON sidewalk_user.user_id = user_role.user_id
//        |INNER JOIN role ON user_role.role_id = role.role_id
//        |WHERE (label_validation.end_timestamp AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date
//        |    AND sidewalk_user.username <> 'anonymous'
//        |    AND role.role = ?""".stripMargin
//    )
//    countQuery(role).first
//  }
//
//  /**
//   * Count the num of researchers who contributed validations today (incl Researcher, Administrator, and Owner roles).
//   */
//  def countValidationResearchersContributedToday: Int = db.withSession { implicit session =>
//    countValidationUsersContributedToday("Researcher") +
//      countValidationUsersContributedToday("Administrator") +
//      countValidationUsersContributedToday("Owner")
//  }
//
//  /**
//   * Count the number of users who contributed validations today (across all roles).
//   */
//  def countAllValidationUsersContributedToday: Int = db.withSession { implicit session =>
//    countValidationUsersContributedToday("Registered") +
//      countValidationUsersContributedToday("Anonymous") +
//      countValidationUsersContributedToday("Turker") +
//      countValidationResearchersContributedToday
//  }
//
//  /**
//   * Count the number of users of the given role who contributed validations in the past week.
//   *
//   * We consider a "contribution" to mean that a user has validated at least one label.
//   */
//  def countValidationUsersContributedPastWeek(role: String): Int = db.withSession { implicit session =>
//    val countQuery = Q.query[String, Int](
//      """SELECT COUNT(DISTINCT(label_validation.user_id))
//        |FROM label_validation
//        |INNER JOIN sidewalk_user ON sidewalk_user.user_id = label_validation.user_id
//        |INNER JOIN user_role ON sidewalk_user.user_id = user_role.user_id
//        |INNER JOIN role ON user_role.role_id = role.role_id
//        |WHERE (label_validation.end_timestamp AT TIME ZONE 'US/Pacific') > (NOW() AT TIME ZONE 'US/Pacific') - interval '168 hours'
//        |    AND sidewalk_user.username <> 'anonymous'
//        |    AND role.role = ?""".stripMargin
//    )
//    countQuery(role).first
//  }
//
//  /**
//   * Count num of researchers who contributed validations in the past week (incl Researcher, Administrator, and Owner roles).
//   */
//  def countValidationResearchersContributedPastWeek: Int = db.withSession { implicit session =>
//    countValidationUsersContributedPastWeek("Researcher") +
//      countValidationUsersContributedPastWeek("Administrator") +
//      countValidationUsersContributedPastWeek("Owner")
//  }
//
//  /**
//   * Count the number of users who contributed validations in the past week (across all roles).
//   */
//  def countAllValidationUsersContributedPastWeek: Int = db.withSession { implicit session =>
//    countValidationUsersContributedPastWeek("Registered") +
//      countValidationUsersContributedPastWeek("Anonymous") +
//      countValidationUsersContributedPastWeek("Turker") +
//      countValidationResearchersContributedPastWeek
//  }
//
//  /**
//   * Count the number of users of the given role who have ever started (or completed) an audit task.
//   */
//  def countAuditUsersContributed(roles: List[String], taskCompleted: Boolean): Int = db.withSession { implicit session =>
//
//    val tasks = if (taskCompleted) auditTaskTable.filter(_.completed) else auditTaskTable
//
//    val users = for {
//      _task <- tasks
//      _user <- userTable if _task.userId === _user.userId
//      _userRole <- userRoleTable if _user.userId === _userRole.userId
//      _role <- roleTable if _userRole.roleId === _role.roleId
//      if _user.username =!= "anonymous"
//      if _role.role inSet roles
//    } yield _user.userId
//
//    // The group by and map does a SELECT DISTINCT, and the list.length does the COUNT.
//    users.groupBy(x => x).map(_._1).size.run
//  }
//
//  /**
//   * Count the number of researchers who have ever started (or completed) an audit task.
//   *
//   * Researchers include the Researcher, Administrator, and Owner roles.
//   */
//  def countAuditResearchersContributed(taskCompleted: Boolean): Int = db.withSession { implicit session =>
//    countAuditUsersContributed(List("Researcher", "Administrator", "Owner"), taskCompleted)
//  }
//
//  /**
//   * Count the number of users who have ever started (or completed) an audit task (across all roles).
//   */
//  def countAllAuditUsersContributed(taskCompleted: Boolean): Int = db.withSession { implicit session =>
//    countAuditUsersContributed(roleTable.map(_.role).list, taskCompleted)
//  }
//
//  /**
//   * Count the number of users of the given role who contributed today.
//   *
//   * We consider a "contribution" to mean that a user has completed at least one audit task.
//   */
//  def countAuditUsersContributedToday(role: String): Int = db.withSession { implicit session =>
//    val countQuery = Q.query[String, Int](
//      """SELECT COUNT(DISTINCT(audit_task.user_id))
//        |FROM audit_task
//        |INNER JOIN sidewalk_user ON sidewalk_user.user_id = audit_task.user_id
//        |INNER JOIN user_role ON sidewalk_user.user_id = user_role.user_id
//        |INNER JOIN role ON user_role.role_id = role.role_id
//        |WHERE (audit_task.task_end AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date
//        |    AND sidewalk_user.username <> 'anonymous'
//        |    AND role.role = ?
//        |    AND audit_task.completed = true""".stripMargin
//    )
//    countQuery(role).first
//  }
//
//  /**
//   * Count the number of researchers who contributed today (includes Researcher, Administrator, and Owner roles).
//   */
//  def countAuditResearchersContributedToday: Int = db.withSession { implicit session =>
//    countAuditUsersContributedToday("Researcher") +
//      countAuditUsersContributedToday("Administrator") +
//      countAuditUsersContributedToday("Owner")
//  }
//
//  /**
//   * Count the number of users who contributed today (across all roles).
//   */
//  def countAllAuditUsersContributedToday: Int = db.withSession { implicit session =>
//    countAuditUsersContributedToday("Registered") +
//      countAuditUsersContributedToday("Anonymous") +
//      countAuditUsersContributedToday("Turker") +
//      countAuditResearchersContributedToday
//  }
//
//  /**
//   * Count the number of users of the given role who contributed in the past week.
//   *
//   * We consider a "contribution" to mean that a user has completed at least one audit task.
//   */
//  def countAuditUsersContributedPastWeek(role: String): Int = db.withSession { implicit session =>
//    val countQuery = Q.query[String, Int](
//      """SELECT COUNT(DISTINCT(audit_task.user_id))
//        |FROM audit_task
//        |INNER JOIN sidewalk_user ON sidewalk_user.user_id = audit_task.user_id
//        |INNER JOIN user_role ON sidewalk_user.user_id = user_role.user_id
//        |INNER JOIN role ON user_role.role_id = role.role_id
//        |WHERE (audit_task.task_end AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'
//        |    AND sidewalk_user.username <> 'anonymous'
//        |    AND role.role = ?
//        |    AND audit_task.completed = true""".stripMargin
//    )
//    countQuery(role).first
//  }
//
//  /**
//   * Count the number of researchers who contributed in the past week (includes Researcher, Administrator, and Owner roles).
//   */
//  def countAuditResearchersContributedPastWeek: Int = db.withSession { implicit session =>
//    countAuditUsersContributedPastWeek("Researcher") +
//      countAuditUsersContributedPastWeek("Administrator") +
//      countAuditUsersContributedPastWeek("Owner")
//  }
//
//  /**
//   * Count the number of users who contributed in the past week (across all roles).
//   *
//   */
//  def countAllAuditUsersContributedPastWeek: Int = db.withSession { implicit session =>
//    countAuditUsersContributedPastWeek("Registered") +
//      countAuditUsersContributedPastWeek("Anonymous") +
//      countAuditUsersContributedPastWeek("Turker") +
//      countAuditResearchersContributedPastWeek
//  }
//
//  /**
//   * Gets metadata for each user that we use on the admin page.
//   */
//  def getUserStatsForAdminPage: List[UserStatsForAdminPage] = db.withSession { implicit session =>
//
//    // We run different queries for each bit of metadata that we need. We run each query and convert them to Scala maps
//    // with the user_id as the key. We then query for all the users in the `user` table and for each user, we lookup
//    // the user's metadata in each of the maps from those 6 queries. This simulates a left join across the six sub-
//    // queries. We are using Scala Map objects instead of Slick b/c Slick doesn't create very efficient queries for this
//    // use-case (at least in the old version of Slick that we are using right now).
//
//    // Map(user_id: String -> team: String).
//    val teams =
//      userTeams.innerJoin(TeamTable.teams).on(_.teamId === _.teamId).map(x => (x._1.userId, x._2.name)).list.toMap
//
//    // Map(user_id: String -> signup_time: Option[Timestamp]).
//    val signUpTimes =
//      WebpageActivityTable.activities.filter(_.activity inSet List("AnonAutoSignUp", "SignUp"))
//        .groupBy(_.userId).map{ case (_userId, group) => (_userId, group.map(_.timestamp).max) }.list.toMap
//
//    // Map(user_id: String -> (most_recent_sign_in_time: Option[Timestamp], sign_in_count: Int)).
//    val signInTimesAndCounts =
//      WebpageActivityTable.activities.filter(row => row.activity === "AnonAutoSignUp" || (row.activity like "SignIn%"))
//        .groupBy(_.userId).map{ case (_userId, group) => (_userId, group.map(_.timestamp).max, group.length) }
//        .list.map{ case (_userId, _time, _count) => (_userId, (_time, _count)) }.toMap
//
//    // Map(user_id: String -> label_count: Int).
//    val labelCounts = LabelTable.labelsWithTutorialAndExcludedUsers
//      .groupBy(_.userId).map { case (_userId, group) => (_userId, group.length) }.list.toMap
//
//    // Map(user_id: String -> (role: String, total: Int, agreed: Int, disagreed: Int, unsure: Int)).
//    val validatedCounts = LabelValidationTable.getValidationCountsPerUser.map { valCount =>
//      (valCount._1, (valCount._2, valCount._3, valCount._4))
//    }.toMap
//
//    // Map(user_id: String -> (count: Int, agreed: Int, disagreed: Int)).
//    val othersValidatedCounts = LabelValidationTable.getValidatedCountsPerUser.map { valCount =>
//      (valCount._1, (valCount._2, valCount._3))
//    }.toMap
//
//    // TODO temporarily removing to improve admin page load time:
//    // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/3802
//    //    val userHighQuality = UserStatTable.userStats.map { x => (x.userId, x.highQuality) }.list.toMap
//    val userHighQuality = UserStatTable.userStats
//      .innerJoin(userRoleTable).on(_.userId === _.userId)
//      .filter(_._2.roleId =!= 6) // Exclude anonymous users.
//      .map(x => (x._1.userId, x._1.highQuality)).list.toMap
//
//    // Now left join them all together and put into UserStatsForAdminPage objects.
//    usersMinusAnonUsersWithNoLabelsAndNoValidations.list.map { case (user, role) =>
//      val ownValidatedCounts = validatedCounts.getOrElse(user.userId, ("", 0, 0))
//      val ownValidatedTotal = ownValidatedCounts._2
//      val ownValidatedAgreed = ownValidatedCounts._3
//
//      val otherValidatedCounts = othersValidatedCounts.getOrElse(user.userId, (0, 0))
//      val otherValidatedTotal = otherValidatedCounts._1
//      val otherValidatedAgreed = otherValidatedCounts._2
//
//      val ownValidatedAgreedPct =
//        if (ownValidatedTotal == 0) 0f
//        else ownValidatedAgreed * 1.0 / ownValidatedTotal
//
//      val otherValidatedAgreedPct =
//        if (otherValidatedTotal == 0) 0f
//        else otherValidatedAgreed * 1.0 / otherValidatedTotal
//
//      UserStatsForAdminPage(
//        user.userId, user.username, user.email,
//        role.role,
//        teams.get(user.userId),
//        signUpTimes.get(user.userId).flatten,
//        signInTimesAndCounts.get(user.userId).flatMap(_._1), signInTimesAndCounts.get(user.userId).map(_._2).getOrElse(0),
//        labelCounts.getOrElse(user.userId, 0),
//        ownValidatedTotal,
//        ownValidatedAgreedPct,
//        otherValidatedTotal,
//        otherValidatedAgreedPct,
//        userHighQuality.getOrElse(user.userId, true)
//      )
//    }
//  }

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

  def insert(userId: String): DBIO[Int] = {
    userStats += UserStat(0, userId, 0F, None, true, None, 0, None, false)
  }
}
