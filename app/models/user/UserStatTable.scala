package models.user

import com.google.inject.ImplementedBy
import models.api.UserStatForApi
import models.audit.AuditTaskTableDef
import models.label.{LabelTable, LabelTypeEnum}
import models.mission.{MissionTableDef, MissionType}
import models.street.StreetEdgeTable
import models.user.RoleTable.ROLES_RESEARCHER_COLLAPSED
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import models.validation.LabelValidationTableDef
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.functional.syntax._
import play.api.libs.json.{__, Writes}
import service.TimeInterval
import service.TimeInterval.TimeInterval
import slick.jdbc.GetResult

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.ExecutionContext

case class UserStat(
    userStatId: Int,
    userId: String,
    metersAudited: Double,
    labelsPerMeter: Option[Double],
    highQuality: Boolean,
    highQualityManual: Option[Boolean],
    ownLabelsValidated: Int,
    accuracy: Option[Double],
    excluded: Boolean,
    onLeaderboard: Boolean,
    publicProfile: Boolean
)

case class LabelTypeStat(labels: Int, validatedCorrect: Int, validatedIncorrect: Int, notValidated: Int)
object LabelTypeStat {
  // snake_case JSON output per the v3 API convention (#3871). Lives in the companion so it is in implicit
  // scope wherever a LabelTypeStat is serialized (e.g. UserStatForApi).
  implicit val writes: Writes[LabelTypeStat] = (
    (__ \ "labels").write[Int] and
      (__ \ "validated_correct").write[Int] and
      (__ \ "validated_incorrect").write[Int] and
      (__ \ "not_validated").write[Int]
  )(unlift(LabelTypeStat.unapply))
}
case class UserStatsForAdminPage(
    userId: String,
    username: String,
    email: String,
    role: String,
    team: Option[String],
    signUpTime: Option[OffsetDateTime],
    lastSignInTime: Option[OffsetDateTime],
    signInCount: Int,
    labels: Int,
    ownValidated: Int,
    ownValidatedAgreedPct: Double,
    othersValidated: Int,
    othersValidatedAgreedPct: Double,
    highQuality: Boolean,
    highQualityManual: Option[Boolean]
)
case class UserCount(
    count: Int,
    toolUsed: String,
    role: String,
    timeInterval: TimeInterval,
    taskCompletedOnly: Boolean,
    highQualityOnly: Boolean
) {
  require(Seq("explore", "validate", "combined").contains(toolUsed.toLowerCase()))
  require((ROLES_RESEARCHER_COLLAPSED.map(_.toLowerCase()) ++ Seq("all")).contains(role))
}

case class LeaderboardStat(
    username: String,
    labelCount: Int,
    missionCount: Int,
    distanceMeters: Double,
    accuracy: Option[Double],
    score: Double
)

/**
 * One row of the all-time global leaderboard: a contributor's totals summed across every included city (#3719).
 *
 * Ranked by `labelCount` rather than the per-city board's composite score, because that score divides audited distance
 * by the *current city's* total street distance — a denominator with no cross-city meaning.
 *
 * @param userId         The mapper's global user id, so the caller can resolve their profile visibility here.
 * @param username       Display name (email domain stripped, as on the per-city boards).
 * @param labelCount     Labels placed across all included cities.
 * @param missionCount   Missions completed across all included cities.
 * @param distanceMeters Street distance audited across all included cities.
 * @param accuracy       Validation agreement rate across all cities, or None below the 10-validated-label threshold.
 * @param topCitySchema  DB schema of the city where this user placed the most labels; the caller maps it to a city id.
 */
case class GlobalLeaderboardStat(
    userId: String,
    username: String,
    labelCount: Int,
    missionCount: Int,
    distanceMeters: Double,
    accuracy: Option[Double],
    topCitySchema: String
)

/**
 * One user's contribution totals in one city, for the dashboard's cross-city breakdown (#4496).
 *
 * Every count matches the definition the single-city dashboard already uses for the same tile, so the row for the
 * city being viewed reconciles exactly with the hero KPIs above it.
 *
 * @param citySchema    DB schema the totals came from; the caller maps it back to a city id.
 * @param labels        Labels placed here, on [[LabelTable.labelsWithExcludedUsers]]'s definition.
 * @param validations   Validations given here.
 * @param missions      Completed, non-skipped missions here (onboarding included).
 * @param metersAudited Street distance audited here from the nightly `user_stat.meters_audited`, or None if this city
 *                      has no `user_stat` row for the user.
 * @param lastActivity  When the user last placed a label here, or None if they have never labeled here.
 */
case class CrossCityUserStat(
    citySchema: String,
    labels: Int,
    validations: Int,
    missions: Int,
    metersAudited: Option[Double],
    lastActivity: Option[OffsetDateTime]
)

/**
 * One row in a user's "standing" slice — their neighbors on the board, ranked by label count for the period.
 *
 * @param rank       1-based rank among eligible users for the period.
 * @param username   Display name (email domain stripped).
 * @param labelCount Labels placed in the period.
 * @param isYou      True for the viewing user's own row.
 */
case class StandingRow(rank: Int, username: String, labelCount: Int, isYou: Boolean)

/**
 * A user's standing among eligible contributors for a period (ranked by labels), plus a small slice of neighbors.
 *
 * @param rank       The user's 1-based rank.
 * @param cohortSize Number of eligible ranked contributors (the "of N" denominator).
 * @param labelCount The user's label count for the period.
 * @param slice      The user's row ± a couple of neighbors, ordered by rank.
 * @param delta      Spots moved since the previous week (positive = climbed), or None if not comparable.
 */
case class UserStanding(rank: Int, cohortSize: Int, labelCount: Int, slice: Seq[StandingRow], delta: Option[Int] = None)

/**
 * One cell of the activity heatmap. The view assembles the localized tooltip from these parts.
 *
 * @param intensity 0 (no activity) … 4 (most), bucketed from the day's contribution count.
 * @param count     The day's contribution count.
 * @param dateLabel The cell's date, formatted in the viewer's locale (e.g. "Mon, Jun 23").
 */
case class StreakCell(intensity: Int, count: Int, dateLabel: String)

/**
 * A user's activity streak summary plus the heatmap grid.
 *
 * @param currentStreak   Consecutive active days ending today (or yesterday if today isn't active yet).
 * @param longestStreak   Longest run of consecutive active days ever.
 * @param totalActiveDays Distinct days with any activity.
 * @param cells           Heatmap cells in column-major order (7 rows × N weeks); `None` = out-of-window padding.
 * @param columnMonths    One entry per week column: the abbreviated month name (e.g. "Jun") on the first column of a
 *                        new month, else `None` — for the month labels along the top of the heatmap.
 */
case class StreakStats(
    currentStreak: Int,
    longestStreak: Int,
    totalActiveDays: Int,
    cells: Seq[Option[StreakCell]],
    columnMonths: Seq[Option[String]]
)

class UserStatTableDef(tag: Tag) extends Table[UserStat](tag, "user_stat") {
  // O.Default mirrors the DB default rather than driving it (nothing generates DDL from these definitions), so a
  // reader can see what a row gets from a partial INSERT — which is what UserStatTable.insertIfNew issues.
  def userStatId: Rep[Int]                    = column[Int]("user_stat_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String]                     = column[String]("user_id")
  def metersAudited: Rep[Double]              = column[Double]("meters_audited", O.Default(0d))
  def labelsPerMeter: Rep[Option[Double]]     = column[Option[Double]]("labels_per_meter")
  def highQuality: Rep[Boolean]               = column[Boolean]("high_quality", O.Default(true))
  def highQualityManual: Rep[Option[Boolean]] = column[Option[Boolean]]("high_quality_manual")
  def ownLabelsValidated: Rep[Int]            = column[Int]("own_labels_validated", O.Default(0))
  def accuracy: Rep[Option[Double]]           = column[Option[Double]]("accuracy")
  def excluded: Rep[Boolean]                  = column[Boolean]("excluded", O.Default(false))
  def onLeaderboard: Rep[Boolean]             = column[Boolean]("on_leaderboard", O.Default(true))
  def publicProfile: Rep[Boolean]             = column[Boolean]("public_profile", O.Default(true))

  override def * =
    (userStatId, userId, metersAudited, labelsPerMeter, highQuality, highQualityManual, ownLabelsValidated, accuracy,
      excluded, onLeaderboard, publicProfile) <> ((UserStat.apply _).tupled, UserStat.unapply)

  def user       = foreignKey("user_stat_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
  def userUnique = index("user_stat_user_id_key", userId, unique = true)
}

@ImplementedBy(classOf[UserStatTable])
trait UserStatTableRepository {}

@Singleton
class UserStatTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    sidewalkUserTable: SidewalkUserTable,
    streetEdgeTable: StreetEdgeTable,
    labelTable: LabelTable
)(implicit ec: ExecutionContext)
    extends UserStatTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  private val userStats            = TableQuery[UserStatTableDef]
  private val userRoleTable        = TableQuery[UserRoleTableDef]
  private val auditTaskTable       = TableQuery[AuditTaskTableDef]
  private val missionTable         = TableQuery[MissionTableDef]
  private val labelValidationTable = TableQuery[LabelValidationTableDef]

  private val auditMissions = missionTable.filter(_.missionType === MissionType.Audit)

  private val LABEL_PER_METER_THRESHOLD: Double = 0.0375

  implicit val userStatApiConverter: GetResult[UserStatForApi] = GetResult[UserStatForApi](r =>
    UserStatForApi(
      r.nextString(),
      r.nextInt(),
      r.nextDouble(),
      r.nextDoubleOption(),
      r.nextBoolean(),
      r.nextBooleanOption(),
      r.nextDoubleOption(),
      r.nextInt(),
      r.nextInt(),
      r.nextInt(),
      r.nextInt(),
      r.nextInt(),
      r.nextInt(),
      r.nextInt(),
      r.nextInt(),
      r.nextInt(),
      r.nextInt(),
      Map(
        LabelTypeEnum.CurbRamp.name       -> LabelTypeStat(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
        LabelTypeEnum.NoCurbRamp.name     -> LabelTypeStat(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
        LabelTypeEnum.Obstacle.name       -> LabelTypeStat(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
        LabelTypeEnum.SurfaceProblem.name -> LabelTypeStat(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
        LabelTypeEnum.NoSidewalk.name     -> LabelTypeStat(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
        LabelTypeEnum.Crosswalk.name      -> LabelTypeStat(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
        LabelTypeEnum.Signal.name         -> LabelTypeStat(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
        LabelTypeEnum.Occlusion.name      -> LabelTypeStat(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
        LabelTypeEnum.Other.name          -> LabelTypeStat(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt())
      )
    )
  )

  def isExcludedUser(userId: String): DBIO[Boolean] = {
    userStats.filter(_.userId === userId).map(_.excluded).result.head
  }

  /**
   * Updates the high_quality_manual column for the given user.
   * @param userId The user whose data quality is being set
   * @param newHighQualityManual The new value for the high_quality_manual column
   * @return Number of rows updated; should be 1, or 0 if user is excluded or no user is found
   */
  def updateHighQualityManual(userId: String, newHighQualityManual: Option[Boolean]): DBIO[Int] = {
    userStats.filter(u => u.userId === userId && !u.excluded).map(_.highQualityManual).update(newHighQualityManual)
  }

  /**
   * Updates the high_quality column for a single user.
   * @param userId The user whose data quality is being set
   * @param newHighQuality The new value for the high_quality column
   * @return Number of rows updated; should be 1, or 0 if user is excluded or no user is found
   */
  def updateHighQuality(userId: String, newHighQuality: Boolean): DBIO[Int] = {
    userStats.filter(u => u.userId === userId && !u.excluded).map(_.highQuality).update(newHighQuality)
  }

  /**
   * Update the meters_audited column in the user_stat table for the given user.
   * @param userId The user whose audited distance is being calculated
   */
  def updateAuditedDistance(userId: String): DBIO[Unit] = {
    val userQuery: Query[Rep[String], String, Seq] = userStats.filter(_.userId === userId).map(_.userId)

    // Computes the audited distance in meters for each user using the audit_task and street_edge tables.
    updateAuditedDistanceHelper(userQuery)
  }

  /**
   * Update meters_audited column in the user_stat table for users who have done any auditing since `cutoffTime`.
   */
  def updateAuditedDistance(cutoffTime: OffsetDateTime): DBIO[Unit] = {
    updateAuditedDistanceHelper(usersThatAuditedSinceCutoffTime(cutoffTime))
  }

  /**
   * Updates the meters_audited column in the user_stat table for the given users.
   * @param usersToUpdate A query for the users whose audited distance is being calculated
   */
  def updateAuditedDistanceHelper(usersToUpdate: Query[Rep[String], String, Seq]): DBIO[Unit] = {
    // Computes the audited distance in meters for each user using the audit_task and street_edge tables.
    auditTaskTable
      .filter(_.completed === true)
      .join(usersToUpdate)
      .on(_.userId === _)
      .join(streetEdgeTable.streets)
      .on(_._1.streetEdgeId === _.streetEdgeId)
      .groupBy(_._1._1.userId)
      .map(x => (x._1, x._2.map(_._2.geom.lengthGeodesic).sum))
      .result
      .flatMap { auditedDists: Seq[(String, Option[Double])] =>
        // Update the meters_audited column in the user_stat table.
        val updateActions = auditedDists.map { case (userId, auditedDist) =>
          val updateQuery = for { _userStat <- userStats if _userStat.userId === userId } yield _userStat.metersAudited
          updateQuery.update(auditedDist.getOrElse(0d))
        }
        DBIO.sequence(updateActions).map(_ => ())
      }
  }.transactionally

  /**
   * Update the labels_per_meter column in the user_stat table for the given user.
   * @param userId The user whose labeling frequency is being calculated
   */
  def updateLabelsPerMeter(userId: String): DBIO[Unit] = {
    val userQuery: Query[Rep[String], String, Seq] = userStats.filter(_.userId === userId).map(_.userId)
    updateLabelsPerMeterHelper(userQuery)
  }

  /**
   * Update labels_per_meter column in the user_stat table for all users who have done any auditing since `cutoffTime`.
   */
  def updateLabelsPerMeter(cutoffTime: OffsetDateTime): DBIO[Unit] = {
    val usersToUpdate: Query[Rep[String], String, Seq] = usersThatAuditedSinceCutoffTime(cutoffTime)
    updateLabelsPerMeterHelper(usersToUpdate)
  }

  /**
   * Update labels_per_meter column in the user_stat table for all users who have done any auditing since `cutoffTime`.
   */
  def updateLabelsPerMeterHelper(usersToUpdate: Query[Rep[String], String, Seq]): DBIO[Unit] = {
    // Compute label counts for each of those users.
    val labelCounts = (for {
      _mission       <- auditMissions
      _label         <- labelTable.labelsWithExcludedUsers if _mission.missionId === _label.missionId
      _usersToUpdate <- usersToUpdate if _mission.userId === _usersToUpdate
    } yield (_mission.userId, _label.labelId)).groupBy(_._1).map(x => (x._1, x._2.length))

    // Compute labeling frequency using the label counts above and the meters_audited column in the user_stat table.
    userStats
      .join(usersToUpdate)
      .on(_.userId === _)
      .joinLeft(labelCounts)
      .on(_._1.userId === _._1)
      .map { case ((_stat, _userId), _count) =>
        // Calculate labels_per_meter. If no meters audited, just set to NULL.
        val newLabelsPerMeter = Case
          .If(_stat.metersAudited > 0d)
          .Then(_count.map(_._2).ifNull(0.asColumnOf[Int]).asColumnOf[Option[Double]] / _stat.metersAudited)
          .Else(Option.empty[Double].bind)

        (_userId, newLabelsPerMeter)
      }
      .result
      .flatMap { labelFreqs: Seq[(String, Option[Double])] =>
        // Update the labels_per_meter column in the user_stat table.
        val updateActions = labelFreqs.map { case (userId, labelingFreq) =>
          val updateQuery = for { _userStat <- userStats if _userStat.userId === userId } yield _userStat.labelsPerMeter
          updateQuery.update(labelingFreq)
        }
        DBIO.sequence(updateActions).map(_ => ())
      }
  }.transactionally

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
    """
      .as[(String, Int, Option[Double])]
      .flatMap { usersToUpdate: Seq[(String, Int, Option[Double])] =>
        // Update the own_labels_validated and accuracy columns in the user_stat table.
        val updateActions = usersToUpdate.map { case (userId, validatedCount, accuracy) =>
          val updateQuery =
            for { _us <- userStats if _us.userId === userId } yield (_us.ownLabelsValidated, _us.accuracy)
          updateQuery.update((validatedCount, accuracy))
        }
        DBIO.sequence(updateActions).map(_ => ())
      }
  }.transactionally

  /**
   * Update the high_quality column for the given user based on labeling freq and accuracy (or use manual setting).
   *
   * Users are considered low quality if they either:
   * 1. have been manually marked as high_quality_manual = FALSE in the user_stat table,
   * 2. have a labeling frequency below `LABEL_PER_METER_THRESHOLD`, or
   * 3. have an accuracy rating below 60% (with at least 50 of their labels validated).
   *
   * @param userId The user whose high_quality column should be updated
   * @return The number of rows updated; should be 1, or 0 if no user is found
   */
  def updateUserQuality(userId: String): DBIO[Int] = {
    // Decide if each user is high quality. Conditions in the method comment. Users manually marked for exclusion or
    // low quality are filtered out later (using results from the previous query).
    val userQualQuery: DBIO[Seq[Boolean]] = {
      userStats
        .filter(_.userId === userId)
        .map { x =>
          !x.excluded &&                              // false if excluded=true
          x.highQualityManual.getOrElse(true) && (    // false if high_quality_manual=false
            x.highQualityManual.getOrElse(false) || ( // true if high_quality_manual set to true
              // 0.6d, not 0.6f: widening the float would compare against 0.60000002, so this path and the bulk
              // `updateHighQuality` below would disagree for an accuracy in that sliver. Evolution 347 and
              // GeodesicDistanceSpec both assume the two agree exactly.
              (x.metersAudited === 0d || x.labelsPerMeter.getOrElse(5d) > LABEL_PER_METER_THRESHOLD)
                && (x.accuracy.getOrElse(1.0d) > 0.6d.asColumnOf[Double] || x.ownLabelsValidated < 50.asColumnOf[Int])
            )
          )
        }
        .result
    }
    for {
      newUserQuality <- userQualQuery
      rowsUpdated    <-
        if (newUserQuality.nonEmpty) updateHighQuality(userId, newUserQuality.head)
        else DBIO.successful(0)
    } yield rowsUpdated
  }.transactionally

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
      userStats
        .filter(u => u.excluded || !u.highQualityManual.getOrElse(true))
        .map(x => (x.userId, false))
        .result

    // Decide if each user is high quality. Conditions in the method comment. Users manually marked for exclusion or
    // low quality are filtered out later (using results from the previous query).
    val userQualQuery: DBIO[Seq[(String, Boolean)]] = {
      userStats
        .filter(x => x.highQualityManual.isEmpty || x.highQualityManual)
        .map { x =>
          (
            x.userId,
            x.highQualityManual.getOrElse(false) || (
              (x.metersAudited === 0d || x.labelsPerMeter.getOrElse(5d) > LABEL_PER_METER_THRESHOLD)
                && (x.accuracy.getOrElse(1.0d) > 0.6d.asColumnOf[Double] || x.ownLabelsValidated < 50.asColumnOf[Int])
            )
          )
        }
        .result
    }.transactionally

    // Get the list of users who have done any auditing or have had any of their labels validated since the cutoff time.
    // Will only update these users.
    val usersToUpdateQuery: DBIO[Seq[String]] =
      (usersThatAuditedSinceCutoffTime(cutoffTime) ++ usersValidatedSinceCutoffTime(cutoffTime)).distinct.result

    for {
      lowQualUsers  <- lowQualUsersQuery
      userQual      <- userQualQuery
      usersToUpdate <- usersToUpdateQuery

      // Make separate lists for low vs. high quality users, then bulk update each.
      updateToHighQual: Seq[String] =
        userQual.filter(x => x._2 && !lowQualUsers.map(_._1).contains(x._1) && usersToUpdate.contains(x._1)).map(_._1)
      updateToLowQual: Seq[String] =
        (lowQualUsers ++ userQual.filterNot(_._2)).map(_._1).filter(x => usersToUpdate.contains(x))

      lowQualityUpdateQuery  = for { _u <- userStats if _u.userId inSetBind updateToLowQual } yield _u.highQuality
      highQualityUpdateQuery = for { _u <- userStats if _u.userId inSetBind updateToHighQual } yield _u.highQuality

      // Do both bulk updates, and return total number of updated rows.
      numLowQualUpdated: Int  <- lowQualityUpdateQuery.update(false)
      numHighQualUpdated: Int <- highQualityUpdateQuery.update(true)
    } yield {
      numLowQualUpdated + numHighQualUpdated
    }
  }

  /**
   * The users who have done any auditing since the cutoff time, i.e. whose cached stats may have gone stale.
   *
   * Completed audit tasks, not just audit missions, decide this. A user can accumulate completed audit tasks under a
   * mission of another type — `auditOnboarding`, or the `exploreAddress` drop-ins of #4451 — and a mission-only
   * selector never reaches them, so `meters_audited` stays at whatever it was, usually 0, forever (#4774). The audit
   * missions are still unioned in rather than replaced, so a user whose missions moved but whose tasks did not is
   * still refreshed.
   *
   * Deliberately does not require `meters_audited > 0`: that is the value this set exists to correct, so requiring it
   * would keep exactly the stuck-at-zero users out of the refresh that would unstick them.
   */
  def usersThatAuditedSinceCutoffTime(cutoffTime: OffsetDateTime): Query[Rep[String], String, Seq] = {
    val fromMissions: Query[Rep[String], String, Seq] = auditMissions.filter(_.missionEnd > cutoffTime).map(_.userId)
    val fromTasks: Query[Rep[String], String, Seq]    =
      auditTaskTable.filter(task => task.completed && task.taskEnd > cutoffTime).map(_.userId)

    (fromMissions ++ fromTasks).distinct
  }

  /**
   * Helper function to get the list of users who have had any of their labels validated since the cutoff time.
   */
  def usersValidatedSinceCutoffTime(cutoffTime: OffsetDateTime): Query[Rep[String], String, Seq] = {
    (for {
      _labelVal <- labelValidationTable
      _label    <- labelTable.labels if _labelVal.labelId === _label.labelId
      if _labelVal.endTimestamp > cutoffTime
    } yield _label.userId).groupBy(x => x).map(_._1)
  }

  /**
   * Runs `action` in a transaction with JIT disabled for the duration of that transaction.
   *
   * Interim workaround for #4376 (mirrors `ConfigTable.withJitOff`): the projectsidewalk/db image ships a broken
   * Postgres JIT (PostGIS bitcode built with LLVM 16, runtime llvmjit linked against LLVM 11). A query expensive enough
   * to cross the JIT inline-cost threshold and inline PostGIS bitcode (e.g. ST_LENGTH) segfaults the backend,
   * dropping the connection (SQLSTATE 08006) and forcing Postgres crash-recovery — which surfaces as a site-wide 502.
   * `getLeaderboardStats` computes audited distance with PostGIS ST_Length and is expensive enough to trip
   * this (#4545), so it must run with JIT off. `SET LOCAL` scopes the setting to this one transaction. Remove once #4376
   * disables JIT at the DB config level.
   *
   * @param action The DBIO to run with JIT off.
   * @return       The same action, wrapped so JIT is disabled for its transaction.
   */
  private def withJitOff[T](action: DBIO[T]): DBIO[T] =
    (sqlu"SET LOCAL jit = off" >> action).transactionally

  /**
   * Gets leaderboard stats for the top `n` users in the given time period.
   *
   * Top users are calculated using: score = sqrt(# labels) * (0.5 * distance_audited / city_distance + 0.5 * accuracy).
   * Stats can be calculated for individual users or across teams. Overall and weekly are the possible time periods. We
   * only include accuracy if the user has at least 10 validated labels (must have either agree or disagree based off
   * of majority vote; an unsure or tie does not count).
   *
   * Qualification is by labels placed in the period: mission count and audited distance are LEFT-joined and default to
   * 0 when absent, so a user who has placed labels but not yet finished a mission or a street still appears (with those
   * columns at 0 and a low score). This matches getUserStanding's label-based eligibility, so the board and the "your
   * standing" widget reconcile — a new mapper with labels but no completed street/mission still shows up (#4533).
   * @param n The number of top users to get stats for
   * @param timePeriod The time period over which to compute stats, either "weekly" or "overall"
   * @param byTeam True if grouping by team instead of by user.
   * @param teamId The id of the team over which to compute stats
   */
  def getLeaderboardStats(
      n: Int,
      timePeriod: String = "overall",
      byTeam: Boolean = false,
      teamId: Option[Int] = None,
      streetDistance: Double
  ): DBIO[Seq[LeaderboardStat]] = {
    val statStartTime = timePeriod.toLowerCase() match {
      case "overall" => """TIMESTAMP 'epoch'"""
      case "weekly"  =>
        """(now() AT TIME ZONE 'US/Pacific')::date - (cast(extract(dow from (now() AT TIME ZONE 'US/Pacific')::date) as int) % 7) + TIME '00:00:00'"""
    }
    val joinUserTeamTable: String = if (byTeam || teamId.isDefined) {
      "INNER JOIN user_team ON sidewalk_user.user_id = user_team.user_id INNER JOIN team ON user_team.team_id = team.team_id"
    } else {
      ""
    }
    val teamFilter: String = teamId match {
      case Some(id) => s"AND user_team.team_id = $id"
      case None     =>
        if (byTeam) "AND team.visible = TRUE"
        else ""
    }
    // on_leaderboard hides a user by name from the individual rankings; team totals still include their contribution,
    // so this filter is applied only to the per-user board (#4323).
    val leaderboardVisibilityFilter: String = if (byTeam) "" else "AND user_stat.on_leaderboard = TRUE"
    // There are quite a few changes to make to the query when grouping by team instead of user. All of those below.
    val groupingCol: String        = if (byTeam) "user_team.team_id" else "sidewalk_user.user_id"
    val groupingColName: String    = if (byTeam) "team_id" else "user_id"
    val joinUserTeamForAcc: String = if (byTeam) "INNER JOIN user_team ON label.user_id = user_team.user_id" else ""
    val usernamesJoin: String      = {
      if (byTeam) {
        "INNER JOIN (SELECT team_id, name AS username FROM team) \"usernames\" ON label_counts.team_id = usernames.team_id"
      } else {
        "INNER JOIN (SELECT user_id, username FROM sidewalk_user) \"usernames\" ON label_counts.user_id = usernames.user_id"
      }
    }
    withJitOff(
      sql"""
      SELECT usernames.username,
             label_counts.label_count,
             COALESCE(mission_count, 0) AS mission_count,
             COALESCE(distance_meters, 0) AS distance_meters,
             CASE WHEN validated_count > 9 THEN accuracy_temp ELSE NULL END AS accuracy,
             CASE WHEN accuracy_temp IS NOT NULL
                 THEN SQRT(label_counts.label_count) * (0.5 * COALESCE(distance_meters, 0) / #$streetDistance + 0.5 * accuracy_temp)
                 ELSE SQRT(label_counts.label_count) * (COALESCE(distance_meters, 0) / #$streetDistance)
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
              AND role.role IN (#${RoleTable.LEADERBOARD_ROLES_SQL})
              AND user_stat.excluded = FALSE
              #$leaderboardVisibilityFilter
              AND (label.time_created AT TIME ZONE 'US/Pacific') > #$statStartTime
              #$teamFilter
          GROUP BY #$groupingCol
          ORDER BY label_count DESC
          LIMIT $n
      ) "label_counts"
      #$usernamesJoin
      -- LEFT joins so mission/distance are supplementary (default 0), not membership gates: labels alone qualify (#4533).
      LEFT JOIN (
          SELECT #$groupingCol, COUNT(mission_id) AS mission_count
          FROM mission
          INNER JOIN sidewalk_user ON mission.user_id = sidewalk_user.user_id
          #$joinUserTeamTable
          WHERE (mission_end AT TIME ZONE 'US/Pacific') > #$statStartTime
          GROUP BY #$groupingCol
      ) "missions_counts" ON label_counts.#$groupingColName = missions_counts.#$groupingColName
      LEFT JOIN (
          SELECT #$groupingCol, COALESCE(SUM(ST_Length(geom::geography)), 0) AS distance_meters
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
      ORDER BY score DESC, label_counts.label_count DESC;
    """
        .as[(String, Int, Int, Double, Option[Double], Double)]
        .map(_.map { stat =>
          // Run the query and, if it's not a team name, remove the "@X.Y" from usernames that are just email addresses.
          if (!byTeam && isValidEmail(stat._1))
            LeaderboardStat(stat._1.slice(0, stat._1.lastIndexOf('@')), stat._2, stat._3, stat._4, stat._5, stat._6)
          else LeaderboardStat.tupled(stat)
        })
    )
  }

  /**
   * Gets the all-time global leaderboard: the top `n` contributors by labels summed across `citySchemas` (#3719).
   *
   * Accounts are global (`sidewalk_login.sidewalk_user` is shared by every city) while contributions are per-city, so
   * this unions each city schema's per-user totals and rolls them up by the shared `user_id`. That union runs as one
   * statement rather than a per-city fan-out because all city schemas live in the same database.
   *
   * Two deliberate departures from the per-city board, both to keep this cheap enough to run on a page load:
   *  - Distance sums the nightly-precomputed `user_stat.meters_audited` instead of recomputing geodesic street
   *    lengths per city. It is the same quantity by the same definition (see
   *    `updateAuditedDistanceHelper`), just up to a day stale, and it keeps PostGIS out of a 50-way union — which also
   *    sidesteps the JIT segfault that forces `withJitOff` on the per-city board (#4376/#4545).
   *  - Ranking is by raw label count, so the rows are in true rank order (the per-city board's composite score has a
   *    city-relative distance term that cannot be compared across cities).
   *
   * Eligibility mirrors the per-city board — role in [[RoleTable.LEADERBOARD_ROLES]], non-excluded,
   * non-deleted/non-tutorial labels — with two cross-city refinements:
   *  - `excluded` is per city, so a user flagged low-quality in one city loses *that city's* contribution and keeps the
   *    rest; the flag describes that city's data, not the person. It is applied as an aggregate FILTER rather than a
   *    WHERE so the row survives to carry that city's `on_leaderboard` flag into the opt-out roll-up below.
   *  - `on_leaderboard` is also per city, but opting out is about being *named*, so a single opt-out anywhere hides the
   *    user from this board entirely rather than just trimming a city.
   *
   * @param citySchemas   DB schema names whose contributions count, already vetted by the caller (existence, config
   *                      opt-out, and having the columns this query needs). Spliced into SQL, so each must be a bare
   *                      identifier.
   * @param optOutSchemas Additional schemas to read `on_leaderboard` opt-outs from without counting their
   *                      contributions, so a mapper who opted out in a city this board excludes still stays unnamed.
   *                      Same identifier requirement.
   * @param n             How many rows to return.
   * @return              Up to `n` rows ordered by descending total label count, ties broken by user id so the board is
   *                      stable across refreshes.
   */
  def getGlobalLeaderboardStats(
      citySchemas: Seq[String],
      optOutSchemas: Seq[String],
      n: Int
  ): DBIO[Seq[GlobalLeaderboardStat]] = {
    if (citySchemas.isEmpty) {
      DBIO.successful(Seq.empty[GlobalLeaderboardStat])
    } else {
      // Schema names are spliced, not bound, so reject anything that isn't a bare identifier before building the SQL.
      val unsafe: Seq[String] = (citySchemas ++ optOutSchemas).filterNot(_.matches("^[a-z_][a-z0-9_]*$"))
      require(unsafe.isEmpty, s"Refusing to build cross-schema SQL for non-identifier schema names: $unsafe")

      // Per-city totals keyed by the global user_id. MAX(meters_audited) picks the single per-city value (user_stat
      // holds one row per user per city); the FILTERs zero out a city where the user is excluded while still letting
      // BOOL_OR see that city's opt-out flag.
      val labelBlocks: String = citySchemas
        .map { schema =>
          s"""  SELECT label.user_id, '$schema'::text AS city_schema,
         COUNT(*) FILTER (WHERE NOT user_stat.excluded)::int AS labels,
         COUNT(*) FILTER (WHERE label.correct AND NOT user_stat.excluded)::int AS agreed,
         COUNT(*) FILTER (WHERE NOT label.correct AND NOT user_stat.excluded)::int AS disagreed,
         MAX(user_stat.meters_audited) FILTER (WHERE NOT user_stat.excluded) AS meters,
         BOOL_OR(NOT user_stat.on_leaderboard) AS opted_out
  FROM "$schema".label
  INNER JOIN "$schema".user_stat ON user_stat.user_id = label.user_id
  WHERE label.deleted = FALSE AND label.tutorial = FALSE
  GROUP BY label.user_id"""
        }
        .mkString("\n  UNION ALL\n")

      // Opt-outs from cities that don't contribute rows, so `city_labels` never sees their flags. Read straight from
      // user_stat rather than off a label join: a mapper can opt out of a city without having labeled in it.
      val optOutBlocks: String = optOutSchemas
        .map(schema =>
          s"""  SELECT user_stat.user_id FROM "$schema".user_stat WHERE user_stat.on_leaderboard = FALSE"""
        )
        .mkString("\n  UNION ALL\n")
      val extraOptOutFilter: String =
        if (optOutSchemas.isEmpty) ""
        else "WHERE NOT EXISTS (SELECT 1 FROM extra_opt_outs WHERE extra_opt_outs.user_id = city_labels.user_id)"
      val extraOptOutCte: String =
        if (optOutSchemas.isEmpty) "" else s"extra_opt_outs AS (\n$optOutBlocks\n        ),"

      // Missions roll up per output row rather than in a CTE: a CTE would aggregate every mission table in full before
      // the LIMIT could restrict it, whereas the lateral runs ~one mission_user_id_idx probe per city per shown row.
      val missionBlocks: String = citySchemas
        .map { schema =>
          s"""    SELECT COUNT(*)::int AS missions
    FROM "$schema".mission
    INNER JOIN "$schema".user_stat ON user_stat.user_id = mission.user_id
    WHERE mission.user_id = top_n.user_id AND user_stat.excluded = FALSE"""
        }
        .mkString("\n    UNION ALL\n")

      sql"""
        WITH city_labels AS (
        #$labelBlocks
        ),
        #$extraOptOutCte
        rolled AS (
            SELECT city_labels.user_id,
                   SUM(city_labels.labels)::int AS label_count,
                   SUM(city_labels.meters) AS distance_meters,
                   SUM(city_labels.agreed)::int AS agreed,
                   SUM(city_labels.disagreed)::int AS disagreed
            FROM city_labels
            #$extraOptOutFilter
            GROUP BY city_labels.user_id
            HAVING BOOL_OR(city_labels.opted_out) = FALSE AND SUM(city_labels.labels) > 0
        ),
        top_n AS (
            SELECT rolled.*
            FROM rolled
            INNER JOIN sidewalk_login.user_role ON user_role.user_id = rolled.user_id
            INNER JOIN sidewalk_login.role ON user_role.role_id = role.role_id
            WHERE role.role IN (#${RoleTable.LEADERBOARD_ROLES_SQL})
            ORDER BY rolled.label_count DESC, rolled.user_id
            LIMIT $n
        )
        SELECT top_n.user_id,
               sidewalk_user.username,
               top_n.label_count,
               mission_totals.mission_count,
               top_n.distance_meters,
               CASE WHEN top_n.agreed + top_n.disagreed > 9
                    THEN top_n.agreed::float / (top_n.agreed + top_n.disagreed) END AS accuracy,
               (SELECT city_labels.city_schema
                FROM city_labels
                WHERE city_labels.user_id = top_n.user_id AND city_labels.labels > 0
                ORDER BY city_labels.labels DESC, city_labels.city_schema
                LIMIT 1) AS top_city_schema
        FROM top_n
        INNER JOIN sidewalk_login.sidewalk_user ON sidewalk_user.user_id = top_n.user_id
        CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(per_city.missions), 0)::int AS mission_count
          FROM (
        #$missionBlocks
          ) AS per_city
        ) AS mission_totals
        ORDER BY top_n.label_count DESC, top_n.user_id;
      """
        .as[(String, String, Int, Int, Double, Option[Double], String)]
        .map(_.map { stat =>
          val username: String = if (isValidEmail(stat._2)) stat._2.slice(0, stat._2.lastIndexOf('@')) else stat._2
          GlobalLeaderboardStat(stat._1, username, stat._3, stat._4, stat._5, stat._6, stat._7)
        })
    }
  }

  /**
   * The schema this connection reads, i.e. the city every other dashboard query returns data for.
   *
   * Taken from the connection rather than `city-id` config because a box whose `DATABASE_USER` and `SIDEWALK_CITY_ID`
   * name different cities would otherwise credit one city's live distance to another city's row.
   */
  def currentSchema: DBIO[String] = sql"SELECT current_schema()".as[String].head

  /**
   * Which schemas have the `voided_label_validation` archive, so the cross-city query knows where it may read it.
   *
   * Every city is its own app instance at its own evolution level, so a schema without the archive is normal rather
   * than broken (#4878) — and referencing a missing relation would fail the whole union, dropping every city rather
   * than one. An unmigrated schema's archive contribution is genuinely zero, so the arm is simply left out there.
   * Read from `information_schema` in one shot rather than probed per schema, so nothing is spliced into SQL.
   */
  def schemasWithVoidedValidationArchive: DBIO[Set[String]] =
    sql"""SELECT table_schema FROM information_schema.tables WHERE table_name = 'voided_label_validation'"""
      .as[String]
      .map(_.toSet)

  /**
   * One user's contribution totals in each of `citySchemas`, for the dashboard's cross-city section (#4496).
   *
   * Accounts are global while contributions are per-city, so a mapper's real Project Sidewalk totals only exist as a
   * roll-up across schemas. All city schemas live in one database, so this is a single statement rather than a fan-out.
   *
   * Shaped as scalar subqueries per city rather than grouped scans because the whole query is keyed on one `user_id`:
   * every subquery is an index seek, so a city the user never touched costs an index miss instead of a table scan.
   * Measured on production (51 schemas, heaviest multi-city account): ~9 s cold, ~200 ms warm.
   *
   * Three deliberate choices:
   *  - Counts mirror the single-city dashboard's own definitions rather than the global leaderboard's looser ones. The
   *    row for the city being viewed sits inches below the hero KPIs, so any divergence reads as a bug (#4699).
   *  - Distance reads the nightly `user_stat.meters_audited` — `MAX`, not `SUM`, because `user_stat.user_id` carries no
   *    unique constraint and duplicate rows exist in the wild. It also keeps PostGIS out of a 51-way union, which is
   *    what forces `withJitOff` elsewhere (#4376/#4545).
   *  - Nothing here reads `excluded`, `on_leaderboard` or `public_profile`. This is a mapper looking at their own data,
   *    so no visibility flag applies — and a schema behind on evolutions may not have those columns at all, which
   *    would fail the entire union rather than one city.
   *
   * @param citySchemas    DB schema names to report on, already vetted by the caller for existence and required
   *                       columns. Spliced into SQL, so each must be a bare identifier.
   * @param archiveSchemas Which of those schemas have `voided_label_validation`, from
   *                       [[schemasWithVoidedValidationArchive]]; the archive arm is omitted for the rest.
   * @param userId         The mapper whose totals to gather; bound once and referenced by every block.
   * @return               One row per schema, including cities where the user did nothing (the caller drops those),
   *                       most labels first.
   */
  def getCrossCityUserStats(
      citySchemas: Seq[String],
      archiveSchemas: Set[String],
      userId: String
  ): DBIO[Seq[CrossCityUserStat]] = {
    if (citySchemas.isEmpty) {
      DBIO.successful(Seq.empty[CrossCityUserStat])
    } else {
      // Schema names are spliced, not bound, so reject anything that isn't a bare identifier before building the SQL.
      val unsafe: Seq[String] = citySchemas.filterNot(_.matches("^[a-z_][a-z0-9_]*$"))
      require(unsafe.isEmpty, s"Refusing to build cross-schema SQL for non-identifier schema names: $unsafe")

      // The user id is bound once in a CTE and read back as `(SELECT user_id FROM me)`; the per-schema blocks are
      // built as plain strings, so an interpolated `$userId` inside them would be spliced rather than bound.
      val blocks: String = citySchemas
        .map { schema =>
          // Validations count as work credit: the #4842 repair deleted voided votes from label_validation but archived
          // them, and the work happened, so countValidations adds the archive back. This mirrors it per schema.
          val archiveArm: String =
            if (!archiveSchemas.contains(schema)) ""
            else s""" + (SELECT COUNT(*)::int FROM "$schema".voided_label_validation
           WHERE voided_label_validation.user_id = (SELECT user_id FROM me))"""
          // Label filters mirror LabelTable.labelsWithExcludedUsers: joined to audit_task, not deleted, not tutorial,
          // and on neither the label's nor the task's tutorial street. "Excluded" users are counted on purpose — this
          // is their own dashboard, and countLabelsFromUser makes the same call.
          s"""  SELECT '$schema'::text AS city_schema,
         (SELECT COUNT(*)::int
            FROM "$schema".label
            INNER JOIN "$schema".audit_task ON audit_task.audit_task_id = label.audit_task_id
           WHERE label.user_id = (SELECT user_id FROM me)
             AND label.deleted = FALSE AND label.tutorial = FALSE
             AND label.street_edge_id NOT IN (SELECT tutorial_street_edge_id FROM "$schema".config)
             AND audit_task.street_edge_id NOT IN (SELECT tutorial_street_edge_id FROM "$schema".config)
         ) AS labels,
         (SELECT COUNT(*)::int FROM "$schema".label_validation
           WHERE label_validation.user_id = (SELECT user_id FROM me))$archiveArm AS validations,
         (SELECT COUNT(*)::int FROM "$schema".mission
           WHERE mission.user_id = (SELECT user_id FROM me)
             AND mission.completed = TRUE AND mission.skipped = FALSE) AS missions,
         (SELECT MAX(user_stat.meters_audited) FROM "$schema".user_stat
           WHERE user_stat.user_id = (SELECT user_id FROM me)) AS meters_audited,
         (SELECT MAX(label.time_created) FROM "$schema".label
           WHERE label.user_id = (SELECT user_id FROM me) AND label.deleted = FALSE) AS last_activity"""
        }
        .mkString("\n  UNION ALL\n")

      sql"""
        WITH me AS (SELECT CAST($userId AS text) AS user_id)
        #$blocks
        ORDER BY labels DESC, city_schema;
      """
        .as[(String, Int, Int, Int, Option[Double], Option[OffsetDateTime])]
        .map(_.map(CrossCityUserStat.tupled))
    }
  }

  /**
   * Computes a user's standing (rank by label count) among eligible contributors for a period, plus a slice of
   * neighbors around them.
   *
   * Reuses the leaderboard's eligibility filters — role IN (Registered, Administrator, Researcher), non-excluded,
   * on_leaderboard = TRUE, non-deleted/non-tutorial labels — so Owners and users who opted out are excluded and the
   * "of N" denominator reconciles with the board.
   * Ranks by label count (the intuitive "your standing" metric), not the leaderboard's composite score.
   *
   * @param userId The user whose standing to compute.
   * @param mode   "weekly" (since this US/Pacific week's start), "lastWeek" (the prior week), or "overall" (all time).
   * @param n      How many neighbors to include on each side of the user in the returned slice.
   * @return       The user's standing, or `None` if they have no qualifying labels in the period (so aren't ranked).
   */
  def getUserStanding(userId: String, mode: String, n: Int): DBIO[Option[UserStanding]] = {
    val weekStart =
      "((now() AT TIME ZONE 'US/Pacific')::date - (cast(extract(dow from (now() AT TIME ZONE 'US/Pacific')::date) as int) % 7))"
    val timeFilter = mode.toLowerCase match {
      case "weekly"   => s"AND (label.time_created AT TIME ZONE 'US/Pacific') >= $weekStart"
      case "lastweek" =>
        s"AND (label.time_created AT TIME ZONE 'US/Pacific') >= ($weekStart - INTERVAL '7 days') " +
          s"AND (label.time_created AT TIME ZONE 'US/Pacific') < $weekStart"
      case _ => ""
    }
    sql"""
      WITH ranked AS (
          SELECT sidewalk_user.user_id AS uid,
                 sidewalk_user.username AS uname,
                 COUNT(label.label_id)::int AS lc,
                 RANK() OVER (ORDER BY COUNT(label.label_id) DESC)::int AS rnk,
                 COUNT(*) OVER ()::int AS cohort
          FROM sidewalk_user
          INNER JOIN user_role ON sidewalk_user.user_id = user_role.user_id
          INNER JOIN role ON user_role.role_id = role.role_id
          INNER JOIN user_stat ON sidewalk_user.user_id = user_stat.user_id
          INNER JOIN label ON sidewalk_user.user_id = label.user_id
          WHERE label.deleted = FALSE
              AND label.tutorial = FALSE
              AND role.role IN (#${RoleTable.LEADERBOARD_ROLES_SQL})
              AND user_stat.excluded = FALSE
              AND user_stat.on_leaderboard = TRUE
              #$timeFilter
          GROUP BY sidewalk_user.user_id, sidewalk_user.username
      ),
      me AS (SELECT rnk, cohort, lc FROM ranked WHERE uid = $userId)
      SELECT ranked.rnk, ranked.uname, ranked.lc, (ranked.uid = $userId) AS is_you, me.cohort, me.rnk, me.lc
      FROM ranked CROSS JOIN me
      WHERE ranked.rnk BETWEEN me.rnk - $n AND me.rnk + $n
      ORDER BY ranked.rnk, ranked.uname;
    """.as[(Int, String, Int, Boolean, Int, Int, Int)].map { rows =>
      rows.headOption.map { head =>
        val slice = rows.map { r =>
          val name = if (isValidEmail(r._2)) r._2.slice(0, r._2.lastIndexOf('@')) else r._2
          StandingRow(r._1, name, r._3, r._4)
        }
        UserStanding(rank = head._6, cohortSize = head._5, labelCount = head._7, slice = slice)
      }
    }
  }

  /**
   * Per-day activity counts for a user (US/Pacific calendar days), across labeling, exploring, and validating.
   *
   * A day counts if the user placed a (non-deleted, non-tutorial) label, completed an audit task, or made a
   * validation on it -- including validations voided by the #4842 repair (evolution 355): the verdicts are dead, but
   * the work happened, so the archive counts as activity. Returned as (ISO date string, count) so the streak/heatmap
   * math is done in Scala.
   *
   * @param userId The user whose activity to summarize.
   * @return       One row per active day, ascending by date.
   */
  def getActivityDayCounts(userId: String): DBIO[Seq[(String, Int)]] = {
    sql"""
      WITH activity AS (
          SELECT (label.time_created AT TIME ZONE 'US/Pacific')::date AS d
          FROM label
          WHERE label.user_id = $userId AND label.deleted = FALSE AND label.tutorial = FALSE
          UNION ALL
          SELECT (audit_task.task_end AT TIME ZONE 'US/Pacific')::date
          FROM audit_task
          WHERE audit_task.user_id = $userId AND audit_task.completed AND audit_task.task_end IS NOT NULL
          UNION ALL
          SELECT (label_validation.end_timestamp AT TIME ZONE 'US/Pacific')::date
          FROM label_validation
          WHERE label_validation.user_id = $userId AND label_validation.end_timestamp IS NOT NULL
          UNION ALL
          SELECT (voided_label_validation.end_timestamp AT TIME ZONE 'US/Pacific')::date
          FROM voided_label_validation
          WHERE voided_label_validation.user_id = $userId
      )
      SELECT to_char(d, 'YYYY-MM-DD') AS day, COUNT(*)::int AS c
      FROM activity
      GROUP BY d
      ORDER BY d;
    """.as[(String, Int)]
  }

  /**
   * Per-label-type validation tallies for a user: how many of their labels of each type were judged correct vs
   * incorrect (by majority vote). Only non-deleted, non-tutorial labels. Drives the dashboard's per-type accuracy
   * bars.
   *
   * @param userId The user whose labels to tally.
   * @return       One row per label type present: (label type name, correct count, incorrect count).
   */
  def getLabelTypeAccuracy(userId: String): DBIO[Seq[(String, Int, Int)]] = {
    sql"""
      SELECT label_type.label_type,
             COUNT(*) FILTER (WHERE label.correct IS TRUE)::int AS correct,
             COUNT(*) FILTER (WHERE label.correct IS FALSE)::int AS incorrect
      FROM label
      INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
      WHERE label.user_id = $userId AND label.deleted = FALSE AND label.tutorial = FALSE
      GROUP BY label_type.label_type;
    """.as[(String, Int, Int)]
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

  /**
   * Counts non-anonymous users currently flagged as low quality (high_quality = false), for the admin Overview's
   * "needs attention" panel. Mirrors `getUserQuality`'s anonymous exclusion so the count matches what's reviewable.
   *
   * @return Number of low-quality registered users.
   */
  def countLowQualityUsers: DBIO[Int] = {
    userStats
      .join(userRoleTable)
      .on(_.userId === _.userId)
      .filter(_._2.roleId =!= 6) // Exclude anonymous users.
      .filter(!_._1.highQuality)
      .length
      .result
  }

  def getUserQuality: DBIO[Seq[(String, Boolean, Option[Boolean])]] = {
    // TODO temporarily removing to improve admin page load time:
    // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/3802
    //    val userHighQuality = userStats.map { x => (x.userId, x.highQuality) }.list.toMap
    // high_quality_manual is included so the admin UI can flag users whose quality was set by hand vs auto-computed.
    userStats
      .join(userRoleTable)
      .on(_.userId === _.userId)
      .filter(_._2.roleId =!= 6) // Exclude anonymous users.
      .map(x => (x._1.userId, x._1.highQuality, x._1.highQualityManual))
      .result
  }

  /**
   * Returns a count of all users under the specified conditions.
   * @param timeInterval can be "today" or "week". If anything else, defaults to "all_time".
   * @param taskCompletedOnly if true, only counts users who have completed one audit task or at least one validation.
   * @param highQualityOnly if true, only counts users who are marked as high quality.
   */
  def countAllUsersContributed(
      timeInterval: TimeInterval = TimeInterval.AllTime,
      taskCompletedOnly: Boolean = false,
      highQualityOnly: Boolean = false
  ): DBIO[UserCount] = {
    // Build up SQL string related to validation and audit task time intervals.
    // Defaults to *not* specifying a time (which is the same thing as "all_time").
    val (lblValidationTimeIntervalSql, auditTaskTimeIntervalSql) = timeInterval match {
      case TimeInterval.Today =>
        (
          "(mission.mission_end AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date",
          "(audit_task.task_end AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date"
        )
      case TimeInterval.Week =>
        (
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
    val auditTaskCompletedSql  = if (taskCompletedOnly) "audit_task.completed = TRUE" else "TRUE"
    val validationCompletedSql = if (taskCompletedOnly) "all_validations.end_timestamp IS NOT NULL" else "TRUE"

    sql"""
      SELECT COUNT(DISTINCT(users.user_id))
      FROM (
          SELECT DISTINCT(mission.user_id)
          FROM mission
          LEFT JOIN (
              -- Votes voided by the #4842 repair still count as participation.
              SELECT mission_id, end_timestamp FROM label_validation
              UNION ALL
              SELECT mission_id, end_timestamp FROM voided_label_validation
          ) AS all_validations ON mission.mission_id = all_validations.mission_id
          WHERE mission.mission_type IN ('validation', 'labelmapValidation')
              AND #$lblValidationTimeIntervalSql
              AND #$validationCompletedSql
          UNION
          SELECT DISTINCT(user_id)
          FROM audit_task
          WHERE #$auditTaskCompletedSql
              AND #$auditTaskTimeIntervalSql
      ) users
      INNER JOIN user_stat ON users.user_id = user_stat.user_id
      INNER JOIN user_role ON user_stat.user_id = user_role.user_id
      INNER JOIN role ON user_role.role_id = role.role_id
      WHERE role.role <> 'AI'
          AND #$highQualityOnlySql;
    """.as[Int].head.map(n => UserCount(n, "combined", "all", timeInterval, taskCompletedOnly, highQualityOnly))
  }

  /**
   * Gets user statistics with optional filtering applied at the database query level for efficiency.
   *
   * @param minLabels Optional minimum number of labels a user must have
   * @param minMetersExplored Optional minimum meters explored a user must have
   * @param highQualityOnly Optional filter to include only high quality users if true
   * @param minAccuracy Optional minimum label accuracy a user must have
   * @return DBIO action that retrieves filtered user statistics
   */
  def getStatsForApiWithFilters(
      minLabels: Option[Int] = None,
      minMetersExplored: Option[Double] = None,
      highQualityOnly: Boolean = false,
      minAccuracy: Option[Double] = None
  ): DBIO[Seq[UserStatForApi]] = {
    // Construct the SQL query with dynamic WHERE clauses based on filter parameters.
    val minLabelsClause   = minLabels.map(min => s"AND COALESCE(label_counts.labels, 0) >= $min").getOrElse("")
    val minMetersClause   = minMetersExplored.map(min => s"AND user_stat.meters_audited >= $min").getOrElse("")
    val highQualityClause = if (highQualityOnly) "AND user_stat.high_quality = TRUE" else ""
    val minAccuracyClause =
      minAccuracy.map(min => s"AND user_stat.accuracy IS NOT NULL AND user_stat.accuracy >= $min").getOrElse("")

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
             COALESCE(validations.validations_given, 0) + COALESCE(voided_validations.cnt, 0) AS validations_given,
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
             COALESCE(label_counts.marked_crosswalk_labels, 0) AS marked_crosswalk_labels,
             COALESCE(label_counts.marked_crosswalk_validated_correct, 0) AS marked_crosswalk_validated_correct,
             COALESCE(label_counts.marked_crosswalk_validated_incorrect, 0) AS marked_crosswalk_validated_incorrect,
             COALESCE(label_counts.marked_crosswalk_not_validated, 0) AS marked_crosswalk_not_validated,
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
                 COUNT(CASE WHEN (validation_result = 'Agree' AND correct = FALSE)
                                 OR (validation_result = 'Disagree' AND correct = TRUE) THEN 1 END) AS dissenting_validations_given,
                 COUNT(CASE WHEN validation_result = 'Agree' THEN 1 END) AS agree_validations_given,
                 COUNT(CASE WHEN validation_result = 'Disagree' THEN 1 END) AS disagree_validations_given,
                 COUNT(CASE WHEN validation_result = 'Unsure' THEN 1 END) AS unsure_validations_given
          FROM label_validation
          INNER JOIN label ON label_validation.label_id = label.label_id
          GROUP BY label_validation.user_id
      ) AS validations ON user_stat.user_id = validations.user_id
      -- Votes voided by the #4842 repair: work credit toward validations_given only; the verdict splits
      -- (agree/disagree/unsure/dissenting) read live votes, so validations_given can exceed their sum.
      LEFT JOIN (
          SELECT voided_label_validation.user_id, COUNT(*) AS cnt
          FROM voided_label_validation
          GROUP BY voided_label_validation.user_id
      ) AS voided_validations ON user_stat.user_id = voided_validations.user_id
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
                 COUNT(CASE WHEN label_type = 'Crosswalk' THEN 1 END) AS marked_crosswalk_labels,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND correct THEN 1 END) AS marked_crosswalk_validated_correct,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND NOT correct THEN 1 END) AS marked_crosswalk_validated_incorrect,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND correct IS NULL THEN 1 END) AS marked_crosswalk_not_validated,
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
          AND user_stat.excluded = FALSE
          #$minLabelsClause
          #$minMetersClause
          #$highQualityClause
          #$minAccuracyClause;""".as[UserStatForApi]
  }

  /**
   * Check if the input string is a valid email address.
   *
   * We use a regex found in the Play Framework's code: https://github.com/playframework/playframework/blob/ddf3a7ee4285212ec665826ec268ef32b5a76000/core/play/src/main/scala/play/api/data/validation/Validation.scala#L79
   */
  def isValidEmail(maybeEmail: String): Boolean = {
    val emailRegex =
      """^[a-zA-Z0-9\.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$""".r
    maybeEmail match {
      case e if e.trim.isEmpty                           => false
      case e if emailRegex.findFirstMatchIn(e).isDefined => true
      case _                                             => false
    }
  }

  /**
   * Get the entry in the user_stat table for the given userId if it exists.
   *
   * @param userId The userId to look up.
   * @return An optional UserStat object if it exists, otherwise None.
   */
  def getStatsFromUserId(userId: String): DBIO[Option[UserStat]] = {
    userStats.filter(_.userId === userId).result.headOption
  }

  /**
   * Insert a user_stat entry for the given userId, doing nothing if the user already has one.
   *
   * Raw SQL for the `ON CONFLICT` clause, which Slick can't express: the request path this exists for
   * ([[service.AuthenticationService.addUserStatEntryIfNew]], run for every request from an identified user) can be
   * hit by several concurrent requests before the row exists — the parallel requests of a user's first page load in a
   * city. A read-then-insert lets each of them see "no row" and insert one, so the DB-level conflict on
   * `user_stat_user_id_key` is what actually makes it insert-once (#4604).
   *
   * Only the three columns a caller can vary are named; every other column takes its DB default, so a future column
   * with a `NOT NULL` default doesn't silently break this statement at runtime.
   *
   * @param userId        The userId to insert a user_stat entry for.
   * @param onLeaderboard Whether the user appears in leaderboard rankings.
   * @param publicProfile Whether the user's dashboard is publicly viewable.
   * @return DBIO action returning the number of rows inserted: 1 for a new user, 0 if they already had a row.
   */
  def insertIfNew(userId: String, onLeaderboard: Boolean, publicProfile: Boolean): DBIO[Int] = {
    sqlu"""
      INSERT INTO user_stat (user_id, on_leaderboard, public_profile)
      VALUES ($userId, $onLeaderboard, $publicProfile)
      ON CONFLICT (user_id) DO NOTHING
    """
  }

  /**
   * Reads a user's two privacy flags.
   *
   * @param userId The user to look up.
   * @return (onLeaderboard, publicProfile), or None if the user has no user_stat row.
   */
  def getPrivacySettings(userId: String): DBIO[Option[(Boolean, Boolean)]] = {
    userStats.filter(_.userId === userId).map(u => (u.onLeaderboard, u.publicProfile)).result.headOption
  }

  /**
   * Of the given users, which have a public profile *in this deployment's city*.
   *
   * `user_stat` is per city, so this answers whether `/userProfile/:username` would render anything here. A user with
   * no row in this schema is absent from the result, matching [[UserService.profileVisible]]'s read of a missing row
   * as private.
   *
   * @param userIds The users to check; an empty input skips the query.
   * @return        The subset whose profile this deployment may show.
   */
  def usersWithPublicProfile(userIds: Seq[String]): DBIO[Set[String]] = {
    if (userIds.isEmpty) DBIO.successful(Set.empty[String])
    else userStats.filter(u => u.userId.inSet(userIds) && u.publicProfile).map(_.userId).result.map(_.toSet)
  }

  /**
   * Updates a user's two privacy flags.
   *
   * @param userId        The user to update.
   * @param onLeaderboard New leaderboard-visibility flag.
   * @param publicProfile New public-profile flag.
   * @return Number of rows updated (1, or 0 if the user has no user_stat row).
   */
  def updatePrivacySettings(userId: String, onLeaderboard: Boolean, publicProfile: Boolean): DBIO[Int] = {
    userStats
      .filter(_.userId === userId)
      .map(u => (u.onLeaderboard, u.publicProfile))
      .update((onLeaderboard, publicProfile))
  }
}
