package models.validation

import com.google.inject.ImplementedBy
import models.api.{
  DailyValidationStat,
  ValidationDataForApi,
  ValidationFiltersForApi,
  ValidationResultTypeForApi,
  ValidatorType
}
import models.label.LabelType.labelTypeNames
import models.label.*
import models.mission.MissionTableDef
import models.user.*
import models.utils.CommonUtils.{UiSource, ViewerType}
import models.utils.{Contributors, FilteredTables, MyPostgresProfile, SqlFragments}
import models.utils.MyPostgresProfile.api.{given, *}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import service.TimeInterval
import slick.jdbc.GetResult

import java.time.{LocalDate, OffsetDateTime}
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

/**
 * One vote on a label.
 *
 * @param labelType The label's type when the vote was cast (#3671). The vote counts toward the label's agree/disagree/
 *                  unsure counts only while this still equals `label.label_type`; after the type changes it stays as
 *                  history and the label is validated afresh.
 */
case class LabelValidation(
    labelValidationId: Int,
    labelId: Int,
    labelType: LabelType,
    validationResult: ValidationOption,
    userId: String,
    missionId: Int,
    // NOTE: canvas_x and canvas_y are null when the label is not visible when validation occurs.
    canvasX: Option[Int],
    canvasY: Option[Int],
    heading: Double,
    pitch: Double,
    zoom: Double,
    canvasWidth: Int,
    canvasHeight: Int,
    startTimestamp: OffsetDateTime,
    endTimestamp: OffsetDateTime,
    source: UiSource,
    viewerType: ViewerType
)

case class ValidationCount(
    count: Int,
    timeInterval: TimeInterval,
    labelType: String,
    validationResult: Option[ValidationOption], // None represents the "All" results subtotal.
    validatorType: String
) {
  require((labelTypeNames ++ Seq("All")).contains(labelType))
  require(Seq("AI", "Human", "Both").contains(validatorType))
}

/** How many agree, disagree, and unsure votes a validation mission has so far. */
type ValidationResultCounts = (agreeCount: Int, disagreeCount: Int, unsureCount: Int)

/** How many validations a user has given, and when they gave their most recent one. */
type UserValidationCount = (userId: String, count: Int, latest: Option[OffsetDateTime])

/** How many votes with one result a user has cast. */
type UserValidationResultCount = (userId: String, validationResult: ValidationOption, count: Int)

/** How many votes with one result were cast by AI (or by humans). */
type ValidatorRoleResultCount = (isAi: Boolean, validationResult: ValidationOption, count: Int)

/** One vote as the admin Activity stream shows it. */
type RecentValidation = (
    labelId: Int,
    labelType: String,
    username: String,
    validationResult: ValidationOption,
    endTimestamp: OffsetDateTime
)

/**
 * Stores data from each validation interaction.
 * https://www.programcreek.com/scala/slick.lifted.ForeignKeyQuery
 * @param tag
 */
class LabelValidationTableDef(tag: slick.lifted.Tag) extends Table[LabelValidation](tag, "label_validation") {
  def labelValidationId: Rep[Int]             = column[Int]("label_validation_id", O.AutoInc)
  def labelId: Rep[Int]                       = column[Int]("label_id")
  def labelType: Rep[LabelType]               = column[LabelType]("label_type")
  def validationResult: Rep[ValidationOption] = column[ValidationOption]("validation_result")
  def userId: Rep[String]                     = column[String]("user_id")
  def missionId: Rep[Int]                     = column[Int]("mission_id")
  def canvasX: Rep[Option[Int]]               = column[Option[Int]]("canvas_x")
  def canvasY: Rep[Option[Int]]               = column[Option[Int]]("canvas_y")
  def heading: Rep[Double]                    = column[Double]("heading")
  def pitch: Rep[Double]                      = column[Double]("pitch")
  def zoom: Rep[Double]                       = column[Double]("zoom")
  def canvasHeight: Rep[Int]                  = column[Int]("canvas_height")
  def canvasWidth: Rep[Int]                   = column[Int]("canvas_width")
  def startTimestamp: Rep[OffsetDateTime]     = column[OffsetDateTime]("start_timestamp")
  def endTimestamp: Rep[OffsetDateTime]       = column[OffsetDateTime]("end_timestamp")
  def source: Rep[UiSource]                   = column[UiSource]("source")
  def viewerType: Rep[ViewerType]             = column[ViewerType]("viewer_type")

  def * = (labelValidationId, labelId, labelType, validationResult, userId, missionId, canvasX, canvasY, heading, pitch,
    zoom, canvasWidth, canvasHeight, startTimestamp, endTimestamp, source, viewerType).mapTo[LabelValidation]

  def label   = foreignKey("label_validation_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
  def user    = foreignKey("label_validation_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
  def mission = foreignKey("label_validation_mission_id_fkey", missionId, TableQuery[MissionTableDef])(_.missionId)
  // One vote per user per label per type the label has had, so a re-vote after a type change adds rather than replaces.
  def userLabelTypeUnique =
    index("label_validation_user_id_label_id_label_type_key", (userId, labelId, labelType), unique = true)

  /** Whether this vote still counts: it judged the type the label has now. */
  def isCurrent(label: LabelTableDef): Rep[Boolean] = labelType === label.labelType

  // Serves the (label_id, user_id) vote lookup that label_comments_agg joins per comment (#5015). The DB index also
  // carries INCLUDE (validation_result) so that probe stays index-only -- Slick has no DSL for a covering column.
  def labelUserIdx = index("label_validation_label_id_user_id_idx", (labelId, userId))
}

@ImplementedBy(classOf[LabelValidationTable])
trait LabelValidationTableRepository {}

@Singleton
class LabelValidationTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    labelTable: LabelTable,
    sidewalkUserTable: SidewalkUserTable
)(using ec: ExecutionContext)
    extends LabelValidationTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val validations       = TableQuery[LabelValidationTableDef]
  val voidedValidations = TableQuery[VoidedLabelValidationTableDef]
  val users             = TableQuery[SidewalkUserTableDef]
  val userRoles         = TableQuery[UserRoleTableDef]
  val labelsUnfiltered  = TableQuery[LabelTableDef]
  val humanValidations  =
    validations.join(sidewalkUserTable.humanUsers).on(_.userId === _.userId).map { case (validation, _) => validation }

  /**
   * A function to count all validations by the given user for the given label. There should always be a maximum of one.
   *
   * @param userId The ID of the user whose validations we want to count
   * @param labelId The ID of the label
   * @return An integer with the count
   */
  def countValidationsFromUserAndLabel(userId: String, labelId: Int): DBIO[Int] = {
    validations.filter(v => v.userId === userId && v.labelId === labelId).length.result
  }

  /**
   * Gets additional information about the number of label validations for the current mission.
   * @param missionId  Mission ID of the current mission
   * @return           The mission's vote counts by result.
   */
  def getValidationProgress(missionId: Int): DBIO[ValidationResultCounts] = {
    validations
      .filter(_.missionId === missionId)
      .groupBy(_.validationResult)
      .map { case (result, group) => (result, group.length) }
      .result
      .map { results =>
        val countByResult: Map[ValidationOption, Int] = results.toMap
        (
          agreeCount = countByResult.getOrElse(ValidationOption.Agree, 0),
          disagreeCount = countByResult.getOrElse(ValidationOption.Disagree, 0),
          unsureCount = countByResult.getOrElse(ValidationOption.Unsure, 0)
        )
      }
  }

  /**
   * Get the user_ids of the users who placed the given labels.
   * @param labelIds
   */
  def usersValidated(labelIds: Seq[Int]): DBIO[Seq[String]] = {
    labelsUnfiltered
      .filter(_.labelId inSetBind labelIds)
      .map(_.userId)
      .groupBy(userId => userId)
      .map { case (userId, _) => userId }
      .result
  }

  /** The user's vote on the label as the given type, the one a new vote on that type replaces. */
  def getValidation(labelId: Int, userId: String, labelType: LabelType): DBIO[Option[LabelValidation]] = {
    validations
      .filter(x => x.labelId === labelId && x.userId === userId && x.labelType === labelType)
      .result
      .headOption
  }

  /** The user's most recent vote on the label, of any type: the one a redo replaces. */
  def getNewestValidation(labelId: Int, userId: String): DBIO[Option[LabelValidation]] = {
    validations
      .filter(x => x.labelId === labelId && x.userId === userId)
      .sortBy(_.labelValidationId.desc)
      .result
      .headOption
  }

  /**
   * Calculates and returns the user accuracy for the supplied userId. The accuracy calculation is performed if and only
   * if 10 of the user's labels have been validated. A label is considered validated if it has either more agree
   * votes than disagree votes, or more disagree votes than agree votes.
   */
  def getUserAccuracy(userId: String): DBIO[Option[Double]] = {
    sql"""
      SELECT CASE WHEN validated_count > 9 THEN accuracy ELSE NULL END AS accuracy
      FROM (
          SELECT CAST(SUM(CASE WHEN correct THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(SUM(CASE WHEN correct THEN 1 ELSE 0 END) + SUM(CASE WHEN NOT correct THEN 1 ELSE 0 END), 0) AS accuracy,
                 COUNT(CASE WHEN correct IS NOT NULL THEN 1 END) AS validated_count
          FROM #${FilteredTables.accuracyLabels}
          WHERE label.user_id = $userId
      ) "accuracy_subquery";""".as[Option[Double]].map(_.headOption.flatten)
  }

  /**
   * [[getValidationCountsByUser]] scoped to a few labelers, so the admin team page doesn't group over every label in
   * the city to show one team (#5381).
   *
   * @param userIds The labelers to count for.
   * @return One entry per user with at least one judged label: (labeler id, (labels validated, agreed count)).
   */
  def getValidationCountsForUsers(userIds: Seq[String]): DBIO[Seq[(String, (Int, Int))]] = {
    validationCountsByUserQuery(Some(userIds)).result
  }

  /**
   * Select validation counts per user.
   *
   * @return list of tuples (labeler_id, (labels_validated, agreed_count))
   */
  def getValidationCountsByUser: DBIO[Seq[(String, (Int, Int))]] = {
    validationCountsByUserQuery(None).result
  }

  /** @param userIds The labelers to include, or None for everyone. */
  private def validationCountsByUserQuery(userIds: Option[Seq[String]]) = {
    val _labelers = userIds match {
      case Some(ids) => users.filter(_.userId inSet ids)
      case None      => users
    }
    val _labels = for {
      _label <- labelTable.labelsForAccuracy
      _user  <- _labelers if _user.userId === _label.userId // User who placed the label.
      if _label.correct.isDefined // Filter for labels marked as either correct or incorrect.
    } yield (_user.userId, _label.correct)

    // Count the number of correct labels and total number marked as either correct or incorrect for each user.
    _labels
      .groupBy { case (userId, _) => userId }
      .map { case (userId, group) =>
        // # Correct labels.
        val correctCount =
          group.map { case (_, correct) => Case.If(correct.getOrElse(false) === true).Then(1).Else(0) }.sum.getOrElse(0)
        (userId, (group.length, correctCount)) // group.length is # correct or incorrect.
      }
  }

  /**
   * Count number of validations supplied per user.
   *
   * @return list of tuples of (labeler_id, (validation_count, validation_agreed_count))
   */
  def getValidatedCountsPerUser: DBIO[Seq[(String, (Int, Int))]] = {
    humanValidations
      .filter(_.validationResult =!= ValidationOption.Unsure) // Exclude "unsure" validations.
      .groupBy(_.userId)
      .map { case (userId, group) =>
        // Sum up the agreed validations and total validations (just agreed + disagreed).
        val agreed =
          group.map { r => Case.If(r.validationResult === ValidationOption.Agree).Then(1).Else(0) }.sum.getOrElse(0)
        (userId, (group.length, agreed))
      }
      .result
  }

  /**
   * The total number of validations performed, as work credit: votes voided by the #4842 repair (evolution 355) live
   * in the archive table, but the work happened, so they count here. Verdict-derived stats must not use this.
   *
   * @return The total number of validations performed, including archived voided ones.
   */
  def countValidations: DBIO[Int] = countWithVoided(validations, voidedValidations)

  /**
   * The total number of human validations performed (i.e., excluding AI validations), as work credit. The voided-vote
   * archive counts in full: the #4842 repair voids human votes only, so every archived vote is human. That
   * human-ness is checked at repair time and not re-derived here — if an archived vote's caster were later granted
   * the AI role, this count would still (correctly) treat their pre-role-change vote as human work.
   *
   * @return The total number of human validations performed, including archived voided ones.
   */
  def countHumanValidations: DBIO[Int] = countWithVoided(humanValidations, voidedValidations)

  /**
   * The number of validations performed by this user, as work credit: votes voided by the #4842 repair (evolution
   * 354) were deleted from label_validation, but the work happened, so the archive counts here (badges, dashboards).
   *
   * @return The number of validations performed by this user, including archived voided ones.
   */
  def countValidations(userId: String): DBIO[Int] =
    countWithVoided(validations.filter(_.userId === userId), voidedValidations.filter(_.userId === userId))

  /**
   * Adds the voided-vote archive to a count of live votes, the rule every work-credit count above shares.
   *
   * @return The number of live votes plus the number of archived voided ones.
   */
  private def countWithVoided(
      live: Query[LabelValidationTableDef, LabelValidation, Seq],
      voided: Query[VoidedLabelValidationTableDef, ?, Seq]
  ): DBIO[Int] =
    for {
      liveCount     <- live.length.result
      archivedCount <- voided.length.result
    } yield liveCount + archivedCount

  /**
   * Counts work credit the way [[countValidations]] does, so the voided-vote archive counts too: the vote no longer
   * stands, but the person did the work. The latest timestamp comes from the live table only -- an archived vote's
   * says when a repair ran, not when they were last at the tool (#5381).
   *
   * @param userIds The validators to count for.
   * @return One entry per user who has validated.
   */
  def countValidationsAndLatestByUsers(userIds: Seq[String]): DBIO[Seq[UserValidationCount]] = {
    val liveCounts = validations
      .filter(_.userId inSet userIds)
      .groupBy(_.userId)
      .map { case (_userId, rows) => (_userId, rows.length, rows.map(_.endTimestamp).max) }
      .result
    val archivedCounts = voidedValidations
      .filter(_.userId inSet userIds)
      .groupBy(_.userId)
      .map { case (_userId, rows) => (_userId, rows.length) }
      .result

    for {
      live     <- liveCounts
      archived <- archivedCounts
    } yield {
      val archivedByUser = archived.toMap
      val liveByUser     = live.map { case (userId, count, latest) => userId -> (count, latest) }.toMap
      // A user with only archived votes has no live row to join onto, so the union of both key sets drives the result.
      (liveByUser.keySet ++ archivedByUser.keySet).toSeq.map { userId =>
        val (liveCount, latest) = liveByUser.getOrElse(userId, (0, None))
        (userId, liveCount + archivedByUser.getOrElse(userId, 0), latest)
      }
    }
  }

  /**
   * Count validations of each label type, result, and human/AI in the time range. Includes counts for all subgroups.
   * @param timeInterval can be "today" or "week". If anything else, defaults to "all_time".
   */
  def countValidationsByResultAndLabelType(
      timeInterval: TimeInterval = TimeInterval.AllTime
  ): DBIO[Seq[ValidationCount]] = {
    val validationsInTimeInterval =
      TimeInterval.start(timeInterval).map(s => validations.filter(_.endTimestamp >= s)).getOrElse(validations)

    // Join with labels to get label type. Group by validation result and label type and get counts.
    validationsInTimeInterval
      .join(labelTable.labelsWithTutorialAndExcludedUsers)
      .on(_.labelId === _.labelId)
      .join(sidewalkUserTable.sidewalkUserToRoleJoin)
      .on { case ((v, _), (user, _)) => v.userId === user.userId }
      .groupBy { case ((v, _), (_, ur)) => (v.labelType, v.validationResult, ur.role === Role.Ai) }
      .map { case ((labelType, valResult, isAi), group) =>
        (labelType.asColumnOf[String], valResult, isAi, group.length)
      }
      .result
      .map { valCounts =>
        // We want to also calculate a sum for every possible subgroup b/w label_type, validation_result and validator.
        // Let's start by enumerating every subgroup combination. We include None for each of the three fields to
        // allow for "All" entries.
        val subgroupCombinations: Set[(Option[String], Option[ValidationOption], Option[Boolean])] = for {
          labelType <- labelTypeNames.map(Some(_)) ++ Seq(None)
          valResult <- ValidationOption.values.toSeq.map(Some(_)) ++ Seq(None)
          validator <- Seq(Some(true), Some(false), None)
        } yield (labelType, valResult, validator)

        // For each combination, filter matching records and sum their counts.
        subgroupCombinations.map { case (labTypeFilter, valResultFilter, validatorFilter) =>
          val filteredData = valCounts.filter { case (labelType, valResult, isAi, _) =>
            // .forall returns true of the element matches or if the filter is None (which works perfectly for "All").
            labTypeFilter.forall(_ == labelType) &&
            valResultFilter.forall(_ == valResult) &&
            validatorFilter.forall(_ == isAi)
          }
          val subgroupCount = filteredData.map { case (_, _, _, count) => count }.sum

          // Create the ValidationCount object for this subgroup.
          val labelType = labTypeFilter.getOrElse("All")
          val validator = validatorFilter.map(ValidatorType.fromIsAi).getOrElse("Both")
          ValidationCount(subgroupCount, timeInterval, labelType, valResultFilter, validator)
        }.toSeq
      }
  }

  /**
   * Retrieves the number of validations grouped by day.
   *
   * @return A database action that, when executed, yields a sequence of tuples where each tuple contains:
   *         - The day (as an OffsetDateTime truncated to the day)
   *         - The count of validations that ended on that day
   */
  def getValidationsByDate: DBIO[Seq[(OffsetDateTime, Int)]] = {
    humanValidations
      .map(_.endTimestamp.trunc("day"))
      .groupBy(day => day)
      .map { case (day, group) => (day, group.length) }
      .sortBy { case (day, _) => day }
      .result
  }

  /**
   * Per-user validation counts broken down by result (Agree/Disagree/Unsure), for the given users (the Contributors
   * leaderboard's top validators). Scoped to a small set of user ids so it stays cheap.
   *
   * @param userIds The users to break down.
   * @return One row per (user, validation result) pair that has any votes.
   */
  def getValidationResultCountsForUsers(userIds: Seq[String]): DBIO[Seq[UserValidationResultCount]] = {
    validations
      .filter(_.userId inSet userIds)
      .groupBy(v => (v.userId, v.validationResult))
      .map { case ((userId, result), group) => (userId, result, group.length) }
      .result
  }

  /**
   * Validation counts broken down by result (Agree/Disagree/Unsure) and whether the validator is the AI user, for the
   * Humans-vs-AI dashboard's validator lens. Lets the page compare how much validation work AI does versus humans and
   * how their verdict mixes differ.
   *
   * @return One row per (AI or human, validation result) pair that has any votes.
   */
  def getValidationCountsByValidatorRole: DBIO[Seq[ValidatorRoleResultCount]] = {
    (for {
      _validation <- validations
      _userRole   <- userRoles if _validation.userId === _userRole.userId
    } yield (_userRole.role === Role.Ai, _validation.validationResult))
      .groupBy { case (isAi, result) => (isAi, result) }
      .map { case ((isAi, result), group) => (isAi, result, group.length) }
      .result
  }

  /**
   * Lightweight feed of the most recent human validations, for the admin Activity stream.
   *
   * Excludes AI validations (joins through `humanUsers`) so the stream reads as people's activity. Returns just what
   * the feed renders, joined to the validated label's type.
   *
   * @param n Number of validations to retrieve.
   * @return The validations, most recent first.
   */
  def getRecentValidations(n: Int): DBIO[Seq[RecentValidation]] = {
    (for {
      _validation <- validations
      _user       <- sidewalkUserTable.humanUsers if _validation.userId === _user.userId
      _label      <- labelTable.labelsWithTutorialAndExcludedUsers if _validation.labelId === _label.labelId
    } yield (_validation, _user, _label))
      .sortBy { case (_validation, _, _) => _validation.endTimestamp.desc }
      .take(n)
      .map { case (_validation, _user, _label) =>
        (_validation.labelId, _label.labelTypeName, _user.username, _validation.validationResult,
          _validation.endTimestamp)
      }
      .result
  }

  /**
   * Gets validation data for API with filters applied. Returns raw tuples to be converted to ValidationDataForApi.
   *
   * @param filters The filters to apply to the validation data.
   * @return A query for retrieving filtered validation data as tuples.
   */
  def getValidationsForApi(filters: ValidationFiltersForApi): Query[?, (LabelValidation, Label, Role), Seq] = {
    for {
      validation       <- validations
      label            <- labelsUnfiltered if validation.labelId === label.labelId
      (user, userRole) <- sidewalkUserTable.sidewalkUserToRoleJoin if validation.userId === user.userId

      // Apply filters.
      if filters.labelId.map(validation.labelId === _).getOrElse(true: Rep[Boolean]) &&
        filters.userId.map(user.userId === _).getOrElse(true: Rep[Boolean]) &&
        filters.validationResult.map(validation.validationResult === _).getOrElse(true: Rep[Boolean]) &&
        filters.labelType.map(label.labelType === _).getOrElse(true: Rep[Boolean]) &&
        filters.validationTimestamp.map(validation.startTimestamp >= _).getOrElse(true: Rep[Boolean]) &&
        filters.source.map(validation.source === _).getOrElse(true: Rep[Boolean])
    } yield (validation, label, userRole.role)
  }

  /**
   * Converts a row of [[getValidationsForApi]] to ValidationDataForApi. A helper method to be used in the service layer.
   */
  def tupleToValidationDataForApi(tuple: (LabelValidation, Label, Role)): ValidationDataForApi = {
    val (validation, label, role) = tuple
    ValidationDataForApi(
      labelValidationId = validation.labelValidationId,
      labelId = validation.labelId,
      labelType = label.labelType.name,
      validatedLabelType = validation.labelType.name,
      validationResult = validation.validationResult,
      userId = validation.userId,
      validatorType = ValidatorType.fromIsAi(role == Role.Ai),
      missionId = validation.missionId,
      canvasXY = validation.canvasX.flatMap(x => validation.canvasY.map(y => LocationXY(x, y))),
      heading = validation.heading,
      pitch = validation.pitch,
      zoom = validation.zoom,
      canvasHeight = validation.canvasHeight,
      canvasWidth = validation.canvasWidth,
      startTimestamp = validation.startTimestamp,
      endTimestamp = validation.endTimestamp,
      source = validation.source
    )
  }

  /**
   * Retrieves all validation result types with their counts (grouped by Human/AI).
   *
   * @return A database action that, when executed, will return a sequence of ValidationResultTypeForApi objects.
   */
  def getValidationResultTypes: DBIO[Seq[ValidationResultTypeForApi]] = {
    getValidationCountsByValidatorRole.map { (results: Seq[ValidatorRoleResultCount]) =>
      // Create a ValidationResultTypeForApi object for each validation result type.
      ValidationOption.values.toSeq
        .map { valResult =>
          val currValCounts   = results.filter(_.validationResult == valResult)
          val humanCount: Int = currValCounts.find(!_.isAi).map(_.count).getOrElse(0)
          val aiCount: Int    = currValCounts.find(_.isAi).map(_.count).getOrElse(0)
          ValidationResultTypeForApi(
            name = valResult.name,
            count = humanCount + aiCount,
            countHuman = humanCount,
            countAi = aiCount
          )
        }
    }
  }

  /**
   * Returns daily validation counts split by human vs AI validator and validation result, per label type.
   *
   * Validations are bucketed by label_validation.end_timestamp cast to a US/Pacific calendar date —
   * i.e. the day the validation was performed, not the day the label was placed. The quality filter
   * mirrors the convention in getOverallStatsForApi: when filterLowQuality is false, only
   * administratively excluded users are removed; when true, only high_quality users are included.
   *
   * validation_result is compared via ::text cast to support both integer and validation_option enum
   * schemas across different city deployments ('Agree', 'Disagree', 'Unsure'). Votes are grouped by the type they
   * judged.
   *
   * @param startDate        Inclusive lower bound on end_timestamp (Pacific date); no bound if None.
   * @param endDate          Inclusive upper bound on end_timestamp; no bound if None.
   * @param filterLowQuality If true, restrict to user_stat.high_quality users; otherwise exclude
   *                         only user_stat.excluded users.
   * @return                 One row per (date, label type), sorted by date then label type.
   */
  def getDailyValidationStats(
      startDate: Option[LocalDate],
      endDate: Option[LocalDate],
      filterLowQuality: Boolean
  ): DBIO[Seq[DailyValidationStat]] = {
    val contributors = Contributors(filterLowQuality)
    val conditions   = Seq(
      Some(sql"label.deleted = FALSE"),
      startDate.map(d => sql"label_validation.end_timestamp >= $d::date"),
      endDate.map(d => sql"label_validation.end_timestamp < ($d::date + INTERVAL '1 day')")
    ).flatten

    sql"""
      SELECT CAST((label_validation.end_timestamp AT TIME ZONE 'US/Pacific')::date AS TEXT) AS date,
             label_validation.label_type::text,
             COUNT(CASE WHEN user_role.role IS DISTINCT FROM 'AI' AND label_validation.validation_result::text = 'Agree'
                        THEN 1 END) AS human_agree,
             COUNT(CASE WHEN user_role.role IS DISTINCT FROM 'AI' AND label_validation.validation_result::text = 'Disagree'
                        THEN 1 END) AS human_disagree,
             COUNT(CASE WHEN user_role.role IS DISTINCT FROM 'AI' AND label_validation.validation_result::text = 'Unsure'
                        THEN 1 END) AS human_unsure,
             COUNT(CASE WHEN user_role.role = 'AI' AND label_validation.validation_result::text = 'Agree'
                        THEN 1 END) AS ai_agree,
             COUNT(CASE WHEN user_role.role = 'AI' AND label_validation.validation_result::text = 'Disagree'
                        THEN 1 END) AS ai_disagree,
             COUNT(CASE WHEN user_role.role = 'AI' AND label_validation.validation_result::text = 'Unsure'
                        THEN 1 END) AS ai_unsure
      FROM #${FilteredTables.votesCast(contributors = contributors)}
      INNER JOIN label ON label_validation.label_id = label.label_id
      LEFT  JOIN sidewalk_login.user_role ON label_validation.user_id = user_role.user_id
      WHERE """
      .concat(SqlFragments.allOf(conditions))
      .concat(sql"""
      GROUP BY (label_validation.end_timestamp AT TIME ZONE 'US/Pacific')::date, label_validation.label_type::text
      ORDER BY date ASC, label_validation.label_type::text
    """)
      .as[DailyValidationStat]
  }
}
