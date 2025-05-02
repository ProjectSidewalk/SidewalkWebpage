package models.user

import com.google.inject.ImplementedBy
import models.attribute.{UserAttributeLabelTableDef, UserClusteringSessionTable}
import models.audit.AuditTaskTableDef
import models.label.{LabelTable, LabelTableDef}
import models.mission.{MissionTableDef, MissionTypeTable}
import models.street.StreetEdgeTableDef
import models.user.RoleTable.{RESEARCHER_ROLES, ROLES_RESEARCHER_COLLAPSED}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import models.validation.LabelValidationTableDef
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import service.TimeInterval
import service.TimeInterval.TimeInterval
import slick.jdbc.GetResult

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.ExecutionContext

case class UserStat(userStatId: Int, userId: String, metersAudited: Float, labelsPerMeter: Option[Float],
                    highQuality: Boolean, highQualityManual: Option[Boolean], ownLabelsValidated: Int,
                    accuracy: Option[Float], excluded: Boolean)

case class LabelTypeStat(labels: Int, validatedCorrect: Int, validatedIncorrect: Int, notValidated: Int)
case class UserStatsForAdminPage(userId: String, username: String, email: String, role: String, team: Option[String],
                                 signUpTime: Option[OffsetDateTime], lastSignInTime: Option[OffsetDateTime],
                                 signInCount: Int, labels: Int, ownValidated: Int, ownValidatedAgreedPct: Double,
                                 othersValidated: Int, othersValidatedAgreedPct: Double, highQuality: Boolean)
case class UserStatApi(userId: String, labels: Int, metersExplored: Float, labelsPerMeter: Option[Float],
                       highQuality: Boolean, highQualityManual: Option[Boolean], labelAccuracy: Option[Float],
                       validatedLabels: Int, validationsReceived: Int, labelsValidatedCorrect: Int,
                       labelsValidatedIncorrect: Int, labelsNotValidated: Int, validationsGiven: Int,
                       dissentingValidationsGiven: Int, agreeValidationsGiven: Int, disagreeValidationsGiven: Int,
                       unsureValidationsGiven: Int, statsByLabelType: Map[String, LabelTypeStat])
object UserStatApi {
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
case class UserCount(count: Int, toolUsed: String, role: String, timeInterval: TimeInterval, taskCompletedOnly: Boolean, highQualityOnly: Boolean) {
  require(Seq("explore", "validate", "combined").contains(toolUsed.toLowerCase()))
  require((ROLES_RESEARCHER_COLLAPSED.map(_.toLowerCase()) ++ Seq("all")).contains(role))
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
trait UserStatTableRepository { }

@Singleton
class UserStatTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider,
                              sidewalkUserTable: SidewalkUserTable,
                              labelTable: LabelTable,
                              userClusteringSessionTable: UserClusteringSessionTable
                             )(implicit ec: ExecutionContext)
  extends UserStatTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {

  val userStats = TableQuery[UserStatTableDef]
  val userTable = TableQuery[SidewalkUserTableDef]
  val userRoleTable = TableQuery[UserRoleTableDef]
  val userAttributeLabelTable = TableQuery[UserAttributeLabelTableDef]
  val labelsUnfiltered = TableQuery[LabelTableDef]
  val auditTaskTable = TableQuery[AuditTaskTableDef]
  val streetEdgeTable = TableQuery[StreetEdgeTableDef]
  val missionTable = TableQuery[MissionTableDef]
  val labelValidationTable = TableQuery[LabelValidationTableDef]

  val auditMissions = missionTable.filter(_.missionTypeId === MissionTypeTable.missionTypeToId("audit"))

  val LABEL_PER_METER_THRESHOLD: Float = 0.0375.toFloat

  implicit val userStatApiConverter: GetResult[UserStatApi] = GetResult[UserStatApi](r => UserStatApi(
    r.nextString(), r.nextInt(), r.nextFloat(), r.nextFloatOption(), r.nextBoolean(), r.nextBooleanOption(),
    r.nextFloatOption(), r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt(),
    r.nextInt(), r.nextInt(), r.nextInt(),
    Map(
      "CurbRamp" -> LabelTypeStat(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
      "NoCurbRamp" -> LabelTypeStat(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
      "Obstacle" -> LabelTypeStat(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
      "SurfaceProblem" -> LabelTypeStat(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
      "NoSidewalk" -> LabelTypeStat(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
      "Crosswalk" -> LabelTypeStat(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
      "Signal" -> LabelTypeStat(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
      "Occlusion" -> LabelTypeStat(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
      "Other" -> LabelTypeStat(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt())
    )
  ))

  def isExcludedUser(userId: String): DBIO[Boolean] = {
    userStats.filter(_.userId === userId).map(_.excluded).result.head
  }

  /**
   * Get the list of users whose data needs to be re-clustered.
   *
   * We find the list of users by determining which labels _should_ show up in the API and compare that to which labels
   * _are_present in the API. Any mismatches indicate that the user's data should be re-clustered.
   */
  def usersToUpdateInApi: DBIO[Seq[String]] = {
    // Get the labels that are currently present in the API.
    val labelsInApi = for {
      _ual <- userAttributeLabelTable
      _l <- labelsUnfiltered if _ual.labelId === _l.labelId
    } yield (_l.userId, _l.labelId)

    // Find all mismatches between the list of labels above using an outer join.
    userClusteringSessionTable.labelsForApiQuery
      .joinFull(labelsInApi).on(_._2 === _._2)          // FULL OUTER JOIN.
      .filter(x => x._1.isEmpty || x._2.isEmpty)        // WHERE no_api.label_id IS NULL OR in_api.label_id IS NULL.
      .map(x => x._1.map(_._1).ifNull(x._2.map(_._1)))  // COALSECE(no_api.label_id, in_api.label_id).
      .distinct.result.map(_.flatten)                   // SELECT DISTINCT and flatten.
  }

  /**
   * Update meters_audited column in the user_stat table for users who have done any auditing since `cutoffTime`.
   */
  def updateAuditedDistance(cutoffTime: OffsetDateTime): DBIO[Unit] = {

    // Get the list of users who have done any auditing since the cutoff time.
    val usersToUpdate: Query[Rep[String], String, Seq] = (for {
      _user <- userTable if _user.username =!= "anonymous"
      _mission <- auditMissions if _mission.userId === _user.userId
      if _mission.missionEnd > cutoffTime
    } yield _user.userId).groupBy(x => x).map(_._1)

    // Computes the audited distance in meters for each user using the audit_task and street_edge tables.
    auditTaskTable
      .filter(_.completed === true)
      .join(usersToUpdate).on(_.userId === _)
      .join(streetEdgeTable).on(_._1.streetEdgeId === _.streetEdgeId)
      .groupBy(_._1._1.userId).map(x => (x._1, x._2.map(_._2.geom.transform(26918).length).sum))
      .result.map { auditedDists: Seq[(String, Option[Float])] =>
        // Update the meters_audited column in the user_stat table.
        for ((userId, auditedDist) <- auditedDists) {
          val updateQuery = for { _userStat <- userStats if _userStat.userId === userId } yield _userStat.metersAudited
          updateQuery.update(auditedDist.getOrElse(0F))
        }
      }.transactionally
  }

  /**
   * Update labels_per_meter column in the user_stat table for all users who have done any auditing since `cutoffTime`.
   */
  def updateLabelsPerMeter(cutoffTime: OffsetDateTime): DBIO[Unit] = {

    // Get the list of users who have done any auditing since the cutoff time.
    val usersToUpdate = usersThatAuditedSinceCutoffTime(cutoffTime)

    // Compute label counts for each of those users.
    val labelCounts = (for {
      _mission <- auditMissions
      _label <- labelTable.labelsWithExcludedUsers if _mission.missionId === _label.missionId
      _usersToUpdate <- usersToUpdate if _mission.userId === _usersToUpdate
    } yield (_mission.userId, _label.labelId)).groupBy(_._1).map(x => (x._1, x._2.length))

    // Compute labeling frequency using the label counts above and the meters_audited column in the user_stat table.
    userStats
      .join(usersToUpdate).on(_.userId === _)
      .joinLeft(labelCounts).on(_._1.userId === _._1)
      .map { case ((_stat, _userId), _count) =>
        (_userId, _count.map(_._2).ifNull(0.asColumnOf[Int]).asColumnOf[Float] / _stat.metersAudited)
      }.result.map { labelFreq: Seq[(String, Float)] =>
        // Update the labels_per_meter column in the user_stat table.
        for ((userId, labelingFreq) <- labelFreq) {
          val updateQuery = for { _userStat <- userStats if _userStat.userId === userId } yield _userStat.labelsPerMeter
          updateQuery.update(Some(labelingFreq))
        }
      }.transactionally
  }

  /**
   * Update the accuracy column in the user_stat table for the given users, or every user if the list is empty.
   * @param users A list of user_ids to update, update all users if the list is empty.
   */
  def updateAccuracy(users: Seq[String]): DBIO[Unit] = {
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
      }.transactionally
  }

  /**
   * Update high_quality col in user_stat table, run after updateAuditedDistance, updateLabelsPerMeter, updateAccuracy.
   *
   * Users are considered low quality if they either:
   * 1. have been manually marked as high_quality_manual = FALSE in the user_stat table,
   * 2. have a labeling frequency below `LABEL_PER_METER_THRESHOLD`, or
   * 3. have an accuracy rating below 60% (with at least 50 of their labels validated).
   *
   * @return Number of users whose records were updated.
   */
  def updateHighQuality(cutoffTime: OffsetDateTime): DBIO[Int] = {

    // First, get users manually marked as low quality or marked to be excluded for other reasons.
    val lowQualUsersQuery: DBIO[Seq[(String, Boolean)]] =
      userStats.filter(u => u.excluded || !u.highQualityManual.getOrElse(true))
        .map(x => (x.userId, false)).result

    // Decide if each user is high quality. Conditions in the method comment. Users manually marked for exclusion or
    // low quality are filtered out later (using results from the previous query).
    val userQualQuery: DBIO[Seq[(String, Boolean)]] = {
      userStats.filter(x => x.highQualityManual.isEmpty || x.highQualityManual).map { x =>
        (
          x.userId,
          x.highQualityManual.getOrElse(false) || (
            (x.metersAudited === 0F || x.labelsPerMeter.getOrElse(5F) > LABEL_PER_METER_THRESHOLD)
              && (x.accuracy.getOrElse(1.0F) > 0.6F.asColumnOf[Float] || x.ownLabelsValidated < 50.asColumnOf[Int])
            )
        )
      }.result.transactionally
    }

    // Get the list of users who have done any auditing since the cutoff time. Will only update these users.
    val usersToUpdateQuery: DBIO[Seq[String]] =
      (usersThatAuditedSinceCutoffTime(cutoffTime) ++ usersValidatedSinceCutoffTime(cutoffTime)).distinct.result

    for {
      lowQualUsers <- lowQualUsersQuery
      userQual <- userQualQuery
      usersToUpdate <- usersToUpdateQuery

      // Make separate lists for low vs. high quality users, then bulk update each.
      updateToHighQual: Seq[String] =
        userQual.filter(x => x._2 && !lowQualUsers.map(_._1).contains(x._1) && usersToUpdate.contains(x._1)).map(_._1)
      updateToLowQual: Seq[String] =
        (lowQualUsers ++ userQual.filterNot(_._2)).map(_._1).filter(x => usersToUpdate.contains(x))

      lowQualityUpdateQuery = for { _u <- userStats if _u.userId inSet updateToLowQual } yield _u.highQuality
      highQualityUpdateQuery = for { _u <- userStats if _u.userId inSet updateToHighQual } yield _u.highQuality

      // Do both bulk updates, and return total number of updated rows.
      numLowQualUpdated: Int <- lowQualityUpdateQuery.update(false)
      numHighQualUpdated: Int <- highQualityUpdateQuery.update(true)
    } yield {
      numLowQualUpdated + numHighQualUpdated
    }
  }

  /**
   * Helper function to get the list of users who have done any auditing since the cutoff time.
   */
  def usersThatAuditedSinceCutoffTime(cutoffTime: OffsetDateTime): Query[Rep[String], String, Seq] = {
    (for {
      _user <- userTable
      _userStat <- userStats if _user.userId === _userStat.userId
      _mission <- auditMissions if _mission.userId === _user.userId
      if _user.username =!= "anonymous"
      if _userStat.metersAudited > 0F
      if _mission.missionEnd > cutoffTime
    } yield _user.userId).groupBy(x => x).map(_._1)
  }

  /**
   * Helper function to get the list of users who have had any of their labels validated since the cutoff time.
   */
  def usersValidatedSinceCutoffTime(cutoffTime: OffsetDateTime): Query[Rep[String], String, Seq] = {
    (for {
      _labelVal <- labelValidationTable
      _label <- labelTable.labels if _labelVal.labelId === _label.labelId
      _user <- userTable if _label.userId === _user.userId
      if _user.username =!= "anonymous"
      if _labelVal.endTimestamp > cutoffTime
    } yield _user.userId).groupBy(x => x).map(_._1)
  }

  /**
   * Gets leaderboard stats for the top `n` users in the given time period.
   *
   * Top users are calculated using: score = sqrt(# labels) * (0.5 * distance_audited / city_distance + 0.5 * accuracy).
   * Stats can be calculated for individual users or across teams. Overall and weekly are the possible time periods. We
   * only include accuracy if the user has at least 10 validated labels (must have either agree or disagree based off
   * of majority vote; an unsure or tie does not count).
   * @param n The number of top users to get stats for
   * @param timePeriod The time period over which to compute stats, either "weekly" or "overall"
   * @param byTeam True if grouping by team instead of by user.
   * @param teamId The id of the team over which to compute stats
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
   * Get all users, excluding anon users who haven't placed any labels or done any validations (to limit table size).
   */
  def usersMinusAnonUsersWithNoLabelsAndNoValidations: DBIO[Seq[SidewalkUserWithRole]] = {
    //    val anonUsersWithLabels = (for {
    //      _user <- userTable
    //      _userRole <- userRoleTable if _user.userId === _userRole.userId
    //      _role <- roleTable if _userRole.roleId === _role.roleId
    //      _label <- LabelTable.labelsWithTutorialAndExcludedUsers if _user.userId === _label.userId
    //      if _role.role === "Anonymous"
    //    } yield (_user, _role)).groupBy(x => x).map(_._1)
    //
    //    val anonUsersWithValidations = (for {
    //      _user <- userTable
    //      _userRole <- userRoleTable if _user.userId === _userRole.userId
    //      _role <- roleTable if _userRole.roleId === _role.roleId
    //      _labelValidation <- LabelValidationTable.validationLabels if _user.userId === _labelValidation.userId
    //      if _role.role === "Anonymous"
    //    } yield (_user, _role)).groupBy(x => x).map(_._1)

    val otherUsers = sidewalkUserTable.sidewalkUserWithRole.filter(_._4 =!= "Anonymous")

    // TODO Only returning non-anonymous users temporarily:
    // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/3802
    //    anonUsersWithLabels.union(anonUsersWithValidations) ++ otherUsers
    otherUsers.result.map(_.map(SidewalkUserWithRole.tupled))
  }

  def getUserQuality: DBIO[Seq[(String, Boolean)]] = {
    // TODO temporarily removing to improve admin page load time:
    // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/3802
    //    val userHighQuality = userStats.map { x => (x.userId, x.highQuality) }.list.toMap
    userStats
      .join(userRoleTable).on(_.userId === _.userId)
      .filter(_._2.roleId =!= 6) // Exclude anonymous users.
      .map(x => (x._1.userId, x._1.highQuality)).result
  }

  /**
   * Returns a count of all users under the specified conditions.
   * @param timeInterval can be "today" or "week". If anything else, defaults to "all_time".
   * @param taskCompletedOnly if true, only counts users who have completed one audit task or at least one validation.
   * @param highQualityOnly if true, only counts users who are marked as high quality.
   */
  def countAllUsersContributed(timeInterval: TimeInterval = TimeInterval.AllTime, taskCompletedOnly: Boolean = false, highQualityOnly: Boolean = false): DBIO[UserCount] = {
    // Build up SQL string related to validation and audit task time intervals.
    // Defaults to *not* specifying a time (which is the same thing as "all_time").
    val (lblValidationTimeIntervalSql, auditTaskTimeIntervalSql) = timeInterval match {
      case TimeInterval.Today => (
        "(mission.mission_end AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date",
        "(audit_task.task_end AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date"
      )
      case TimeInterval.Week => (
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
    """.as[Int].head.map(n => UserCount(n, "combined", "all", timeInterval, taskCompletedOnly, highQualityOnly))
  }

  /**
   * Count the number of users who used a validation interface over the given time period, grouped by role.
   * @param timeInterval can be "today" or "week". If anything else, defaults to "all_time".
   * @param labelValidated Whether to count only users who validated a label or anyone who loaded the page.
   */
  def countValidateUsersContributed(timeInterval: TimeInterval = TimeInterval.AllTime, labelValidated: Boolean = false): DBIO[Seq[UserCount]] = {
    // Build up SQL string related to validation and audit task time intervals.
    // Defaults to *not* specifying a time (which is the same thing as "all_time").
    val timeIntervalFilter = timeInterval match {
      case TimeInterval.Today => "(mission.mission_end AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date"
      case TimeInterval.Week => "(mission.mission_end AT TIME ZONE 'US/Pacific') > (NOW() AT TIME ZONE 'US/Pacific') - interval '168 hours'"
      case _ => "TRUE"
    }

    sql"""
      SELECT role.role, COALESCE(user_counts.count, 0)
      FROM role
      LEFT JOIN (
        SELECT user_role.role_id, COUNT(DISTINCT(sidewalk_user.user_id)) AS count
        FROM mission_type
        INNER JOIN mission ON mission_type.mission_type_id = mission.mission_type_id
        INNER JOIN sidewalk_user ON sidewalk_user.user_id = mission.user_id
        LEFT JOIN label_validation ON mission.mission_id = label_validation.mission_id
        INNER JOIN user_role ON sidewalk_user.user_id = user_role.user_id
        WHERE mission_type.mission_type IN ('validation', 'labelmapValidation')
            AND sidewalk_user.username <> 'anonymous'
            AND #${if (labelValidated) "label_validation.end_timestamp IS NOT NULL" else "TRUE"}
            AND #$timeIntervalFilter
        GROUP BY user_role.role_id
      ) user_counts ON role.role_id = user_counts.role_id;
    """.as[(String, Int)]
      .map { userCounts =>
        // Collapse the researcher roles into one role.
        val researcherCount = userCounts.filter(c => RESEARCHER_ROLES.contains(c._1)).map(_._2).sum
        val otherCounts = userCounts.filter(c => !RESEARCHER_ROLES.contains(c._1))
        val countsForCollapsedRoles: Seq[(String, Int)] = otherCounts :+ ("researcher", researcherCount)

        // Put into UserCount objects.
        countsForCollapsedRoles.map{ case (role, count) =>
          UserCount(count, "validate", role.toLowerCase(), timeInterval, labelValidated, highQualityOnly = false)
        }
      }
  }

  /**
   * Count the number of users who used the Explore page over the given time period, grouped by role.
   * @param timeInterval can be "today" or "week". If anything else, defaults to "all_time".
   * @param taskCompletedOnly Whether to count only users who completed an audit_task or anyone who loaded the page.
   */
  def countExploreUsersContributed(timeInterval: TimeInterval = TimeInterval.AllTime, taskCompletedOnly: Boolean = false): DBIO[Seq[UserCount]] = {
    // Build up SQL string related to validation and audit task time intervals.
    // Defaults to *not* specifying a time (which is the same thing as "all_time").
    val timeIntervalFilter = timeInterval match {
      case TimeInterval.Today => "(audit_task.task_end AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date"
      case TimeInterval.Week => "(audit_task.task_end AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'"
      case _ => "TRUE"
    }

    sql"""
      SELECT role.role, COALESCE(user_counts.count, 0)
      FROM role
      LEFT JOIN (
        SELECT user_role.role_id, COUNT(DISTINCT(audit_task.user_id)) AS count
        FROM audit_task
        INNER JOIN sidewalk_user ON sidewalk_user.user_id = audit_task.user_id
        INNER JOIN user_role ON sidewalk_user.user_id = user_role.user_id
        WHERE sidewalk_user.username <> 'anonymous'
            AND #${if (taskCompletedOnly) "audit_task.completed = TRUE" else "TRUE"}
            AND #$timeIntervalFilter
        GROUP BY user_role.role_id
      ) user_counts ON role.role_id = user_counts.role_id;
    """.as[(String, Int)]
      .map { userCounts =>
        // Collapse the researcher roles into one role.
        val researcherCount = userCounts.filter(c => RESEARCHER_ROLES.contains(c._1)).map(_._2).sum
        val otherCounts = userCounts.filter(c => !RESEARCHER_ROLES.contains(c._1))
        val countsForCollapsedRoles: Seq[(String, Int)] = otherCounts :+ ("researcher", researcherCount)

        // Put into UserCount objects.
        countsForCollapsedRoles.map{ case (role, count) =>
          UserCount(count, "explore", role.toLowerCase(), timeInterval, taskCompletedOnly, highQualityOnly = false)
        }
      }
  }

  /**
   * Computes some stats on users that will be served through a public API.
   */
  def getStatsForApi: DBIO[Seq[UserStatApi]] = {
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
          AND user_stat.excluded = FALSE;""".as[UserStatApi]
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

  def insert(userId: String): DBIO[Int] = {
    userStats += UserStat(0, userId, 0F, None, true, None, 0, None, false)
  }
}
