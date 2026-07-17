package models.validation

import com.google.inject.ImplementedBy
import models.api.{ValidationDataForApi, ValidationFiltersForApi, ValidationResultTypeForApi}
import models.label.LabelTypeEnum.{labelTypeIdToLabelType, validLabelTypeIds, validLabelTypes}
import models.label._
import models.mission.MissionTableDef
import models.user._
import models.utils.CommonUtils.UiSource.UiSource
import models.utils.CommonUtils.ViewerType.ViewerType
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import service.TimeInterval
import service.TimeInterval.TimeInterval
import slick.jdbc.GetResult

import java.time.{LocalDate, OffsetDateTime}
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class LabelValidation(
    labelValidationId: Int,
    labelId: Int,
    validationResult: ValidationOption.Value,
    oldSeverity: Option[Int],
    newSeverity: Option[Int],
    oldTags: List[String],
    newTags: List[String],
    userId: String,
    missionId: Int,
    // NOTE: canvas_x and canvas_y are null when the label is not visible when validation occurs.
    canvasX: Option[Int],
    canvasY: Option[Int],
    heading: Double,
    pitch: Double,
    zoom: Double,
    canvasHeight: Int,
    canvasWidth: Int,
    startTimestamp: OffsetDateTime,
    endTimestamp: OffsetDateTime,
    source: UiSource,
    viewerType: ViewerType
)

case class ValidationCount(
    count: Int,
    timeInterval: TimeInterval,
    labelType: String,
    validationResult: Option[ValidationOption.Value], // None represents the "All" results subtotal.
    validatorType: String
) {
  require((validLabelTypes ++ Seq("All")).contains(labelType))
  require(Seq("AI", "Human", "Both").contains(validatorType))
}

/**
 * Stores data from each validation interaction.
 * https://www.programcreek.com/scala/slick.lifted.ForeignKeyQuery
 * @param tag
 */
class LabelValidationTableDef(tag: slick.lifted.Tag) extends Table[LabelValidation](tag, "label_validation") {
  def labelValidationId: Rep[Int]                   = column[Int]("label_validation_id", O.AutoInc)
  def labelId: Rep[Int]                             = column[Int]("label_id")
  def validationResult: Rep[ValidationOption.Value] = column[ValidationOption.Value]("validation_result")
  def oldSeverity: Rep[Option[Int]]                 = column[Option[Int]]("old_severity")
  def newSeverity: Rep[Option[Int]]                 = column[Option[Int]]("new_severity")
  def oldTags: Rep[List[String]]                    = column[List[String]]("old_tags")
  def newTags: Rep[List[String]]                    = column[List[String]]("new_tags")
  def userId: Rep[String]                           = column[String]("user_id")
  def missionId: Rep[Int]                           = column[Int]("mission_id")
  def canvasX: Rep[Option[Int]]                     = column[Option[Int]]("canvas_x")
  def canvasY: Rep[Option[Int]]                     = column[Option[Int]]("canvas_y")
  def heading: Rep[Double]                          = column[Double]("heading")
  def pitch: Rep[Double]                            = column[Double]("pitch")
  def zoom: Rep[Double]                             = column[Double]("zoom")
  def canvasHeight: Rep[Int]                        = column[Int]("canvas_height")
  def canvasWidth: Rep[Int]                         = column[Int]("canvas_width")
  def startTimestamp: Rep[OffsetDateTime]           = column[OffsetDateTime]("start_timestamp")
  def endTimestamp: Rep[OffsetDateTime]             = column[OffsetDateTime]("end_timestamp")
  def source: Rep[UiSource]                         = column[UiSource]("source")
  def viewerType: Rep[ViewerType]                   = column[ViewerType]("viewer_type")

  def * = (labelValidationId, labelId, validationResult, oldSeverity, newSeverity, oldTags, newTags, userId, missionId,
    canvasX, canvasY, heading, pitch, zoom, canvasHeight, canvasWidth, startTimestamp, endTimestamp, source,
    viewerType) <> ((LabelValidation.apply _).tupled, LabelValidation.unapply)

  def label   = foreignKey("label_validation_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
  def user    = foreignKey("label_validation_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
  def mission = foreignKey("label_validation_mission_id_fkey", missionId, TableQuery[MissionTableDef])(_.missionId)

//  def userLabelUnique: Index = index("label_validation_user_id_label_id_unique", (userId, labelId), unique = true)
}

@ImplementedBy(classOf[LabelValidationTable])
trait LabelValidationTableRepository {}

@Singleton
class LabelValidationTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    labelTable: LabelTable,
    sidewalkUserTable: SidewalkUserTable,
    implicit val ec: ExecutionContext
) extends LabelValidationTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val validations          = TableQuery[LabelValidationTableDef]
  val users                = TableQuery[SidewalkUserTableDef]
  val userRoles            = TableQuery[UserRoleTableDef]
  val roleTable            = TableQuery[RoleTableDef]
  val labelsUnfiltered     = TableQuery[LabelTableDef]
  val labelTypeTable       = TableQuery[LabelTypeTableDef]
  val humanValidations     = validations.join(sidewalkUserTable.humanUsers).on(_.userId === _.userId).map(_._1)
  val labelsWithoutDeleted = labelsUnfiltered.filter(_.deleted === false)

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
   * @return           DBIO[(agree_count, disagree_count, unsure_count)]
   */
  def getValidationProgress(missionId: Int): DBIO[(Int, Int, Int)] = {
    validations
      .filter(_.missionId === missionId)
      .groupBy(_.validationResult)
      .map { case (result, group) => (result, group.length) }
      .result
      .map { results =>
        val agreeCount    = results.find(_._1 == ValidationOption.Agree).map(_._2).getOrElse(0)
        val disagreeCount = results.find(_._1 == ValidationOption.Disagree).map(_._2).getOrElse(0)
        val unsureCount   = results.find(_._1 == ValidationOption.Unsure).map(_._2).getOrElse(0)
        (agreeCount, disagreeCount, unsureCount)
      }
  }

  /**
   * Get the user_ids of the users who placed the given labels.
   * @param labelIds
   */
  def usersValidated(labelIds: Seq[Int]): DBIO[Seq[String]] = {
    labelsUnfiltered.filter(_.labelId inSetBind labelIds).map(_.userId).groupBy(x => x).map(_._1).result
  }

  def getValidation(labelId: Int, userId: String): DBIO[Option[LabelValidation]] = {
    validations.filter(x => x.labelId === labelId && x.userId === userId).result.headOption
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
          FROM label
          WHERE label.deleted = FALSE
              AND label.tutorial = FALSE
              AND label.user_id = $userId
      ) "accuracy_subquery";""".as[Option[Double]].map(_.headOption.flatten)
  }

  /**
   * Select validation counts per user.
   * @return list of tuples (labeler_id, (labeler_role, labels_validated, agreed_count))
   */
  def getValidationCountsByUser: DBIO[Seq[(String, (String, Int, Int))]] = {
    val _labels = for {
      _label    <- labelTable.labelsWithExcludedUsers
      _user     <- users if _user.userId === _label.userId // User who placed the label.
      _userRole <- userRoles if _user.userId === _userRole.userId
      _role     <- roleTable if _userRole.roleId === _role.roleId
      if _label.correct.isDefined // Filter for labels marked as either correct or incorrect.
    } yield (_user.userId, _role.role, _label.correct)

    // Count the number of correct labels and total number marked as either correct or incorrect for each user.
    _labels
      .groupBy(l => (l._1, l._2))
      .map { case ((userId, role), group) =>
        (
          userId,
          (
            role,
            group.length, // # Correct or incorrect.
            group.map(l => Case.If(l._3.getOrElse(false) === true).Then(1).Else(0)).sum.getOrElse(0) // # Correct labels
          )
        )
      }
      .result
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
   * @return The total number of validations.
   */
  def countValidations: DBIO[Int] = validations.length.result

  /**
   * @return The total number of human validations (i.e., excluding AI validations).
   */
  def countHumanValidations: DBIO[Int] = humanValidations.length.result

  /**
   * @return The number of validations performed by this user.
   */
  def countValidations(userId: String): DBIO[Int] = validations.filter(_.userId === userId).length.result

  /**
   * Count validations of each label type, result, and human/AI in the time range. Includes counts for all subgroups.
   * @param timeInterval can be "today" or "week". If anything else, defaults to "all_time".
   */
  def countValidationsByResultAndLabelType(
      timeInterval: TimeInterval = TimeInterval.AllTime
  ): DBIO[Seq[ValidationCount]] = {
    // Filter by the given time interval.
    val validationsInTimeInterval = timeInterval match {
      case TimeInterval.Today => validations.filter(l => l.endTimestamp > OffsetDateTime.now().minusDays(1))
      case TimeInterval.Week  => validations.filter(l => l.endTimestamp >= OffsetDateTime.now().minusDays(7))
      case _                  => validations
    }

    // Join with labels to get label type. Group by validation result and label type and get counts.
    validationsInTimeInterval
      .join(labelsWithoutDeleted)
      .on(_.labelId === _.labelId)
      .join(sidewalkUserTable.sidewalkUserToRoleJoin)
      .on(_._1.userId === _._1.userId)
      .groupBy { case ((v, l), (u, ur, r)) => (l.labelTypeId, v.validationResult, r.role === "AI") }
      .map { case ((labelTypeId, valResult, isAi), group) => (labelTypeId, valResult, isAi, group.length) }
      .result
      .map { valCounts =>
        // We want to also calculate a sum for every possible subgroup b/w label_type, validation_result and validator.
        // Let's start by enumerating every subgroup combination. We include None for each of the three fields to
        // allow for "All" entries.
        val subgroupCombinations: Set[(Option[Int], Option[ValidationOption.Value], Option[Boolean])] = for {
          labelType <- validLabelTypeIds.map(Some(_)) ++ Seq(None)
          valResult <- ValidationOption.values.toSeq.map(Some(_)) ++ Seq(None)
          validator <- Seq(Some(true), Some(false), None)
        } yield (labelType, valResult, validator)

        // For each combination, filter matching records and sum their counts.
        subgroupCombinations.map { case (labTypeFilter, valResultFilter, validatorFilter) =>
          val filteredData = valCounts.filter { case (labelTypeId, valResult, isAi, _) =>
            // .forall returns true of the element matches or if the filter is None (which works perfectly for "All").
            labTypeFilter.forall(_ == labelTypeId) &&
            valResultFilter.forall(_ == valResult) &&
            validatorFilter.forall(_ == isAi)
          }
          val subgroupCount = filteredData.map(_._4).sum

          // Create the ValidationCount object for this subgroup.
          val labelType = labTypeFilter.map(labelTypeIdToLabelType).getOrElse("All")
          val validator = validatorFilter.map(isAi => if (isAi) "AI" else "Human").getOrElse("Both")
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
    humanValidations.map(_.endTimestamp.trunc("day")).groupBy(x => x).map(x => (x._1, x._2.length)).sortBy(_._1).result
  }

  /**
   * Per-user validation counts broken down by result (Agree/Disagree/Unsure), for the given users (the Contributors
   * leaderboard's top validators). Scoped to a small set of user ids so it stays cheap.
   *
   * @param userIds The users to break down.
   * @return DBIO[Seq[(userId, validationResult, count)]].
   */
  def getValidationResultCountsForUsers(
      userIds: Seq[String]
  ): DBIO[Seq[(String, ValidationOption.Value, Int)]] = {
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
   * @return DBIO[Seq[(isAi, validationResult, count)]].
   */
  def getValidationCountsByValidatorRole: DBIO[Seq[(Boolean, ValidationOption.Value, Int)]] = {
    (for {
      _validation <- validations
      _userRole   <- userRoles if _validation.userId === _userRole.userId
      _role       <- roleTable if _userRole.roleId === _role.roleId
    } yield (_role.role === "AI", _validation.validationResult))
      .groupBy(r => (r._1, r._2))
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
   * @return DBIO[Seq[(labelId, labelType, username, validationResult, endTimestamp)]], most recent first.
   */
  def getRecentValidations(n: Int): DBIO[Seq[(Int, String, String, ValidationOption.Value, OffsetDateTime)]] = {
    (for {
      _validation <- validations
      _user       <- sidewalkUserTable.humanUsers if _validation.userId === _user.userId
      _label      <- labelsWithoutDeleted if _validation.labelId === _label.labelId
      _labelType  <- labelTypeTable if _label.labelTypeId === _labelType.labelTypeId
    } yield (_validation.labelId, _labelType.labelType, _user.username, _validation.validationResult,
      _validation.endTimestamp))
      .sortBy(_._5.desc)
      .take(n)
      .result
  }

  /**
   * Gets validation data for API with filters applied. Returns raw tuples to be converted to ValidationDataForApi.
   *
   * @param filters The filters to apply to the validation data.
   * @return A query for retrieving filtered validation data as tuples.
   */
  def getValidationsForApi(
      filters: ValidationFiltersForApi
  ): Query[_, (LabelValidation, Label, LabelType, Role), Seq] = {
    for {
      validation             <- validations
      label                  <- labelsUnfiltered if validation.labelId === label.labelId
      labelType              <- labelTypeTable if label.labelTypeId === labelType.labelTypeId
      (user, userRole, role) <- sidewalkUserTable.sidewalkUserToRoleJoin if validation.userId === user.userId

      // Apply filters.
      if filters.labelId.map(validation.labelId === _).getOrElse(true: Rep[Boolean]) &&
        filters.userId.map(user.userId === _).getOrElse(true: Rep[Boolean]) &&
        filters.validationResult.map(validation.validationResult === _).getOrElse(true: Rep[Boolean]) &&
        filters.labelTypeId.map(label.labelTypeId === _).getOrElse(true: Rep[Boolean]) &&
        filters.validationTimestamp.map(validation.startTimestamp >= _).getOrElse(true: Rep[Boolean]) &&
        filters.source.map(validation.source === _).getOrElse(true: Rep[Boolean])

      // Apply changed tags filter (oldTags != newTags or oldTags == newTags).
      // Filter on whether tags were changed during the validations (oldTags != newTags).
      if filters.changedTags
        .map { changed => (validation.oldTags =!= validation.newTags) === changed }
        .getOrElse(true: Rep[Boolean])

      // Apply changed severity levels filter (oldSeverity != newSeverity or oldSeverity == newSeverity).
      // Note: Works slightly different from tags because oldSeverity and newSeverity are Options.
      if filters.changedSeverityLevels
        .map { changed =>
          val severityChanged = (validation.oldSeverity =!= validation.newSeverity).getOrElse(false: Rep[Boolean])
          severityChanged === changed
        }
        .getOrElse(true: Rep[Boolean])

    } yield (validation, label, labelType, role)
  }

  /**
   * Converts a tuple from the database query to ValidationDataForApi. A helper method to be used in the service layer.
   *
   * TODO try doing something like TupleConverter in LabelTable.scala. Need a more general solution.
   */
  def tupleToValidationDataForApi(
      tuple: (LabelValidation, Label, LabelType, Role)
  ): ValidationDataForApi = {
    val (validation, label, labelType, role) = tuple
    ValidationDataForApi(
      labelValidationId = validation.labelValidationId,
      labelId = validation.labelId,
      labelTypeId = label.labelTypeId,
      labelType = labelType.labelType,
      validationResult = validation.validationResult,
      oldSeverity = validation.oldSeverity,
      newSeverity = validation.newSeverity,
      oldTags = validation.oldTags,
      newTags = validation.newTags,
      userId = validation.userId,
      validatorType = if (role.role == "AI") "AI" else "Human",
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
    validations
      .join(sidewalkUserTable.sidewalkUserToRoleJoin)
      .on(_.userId === _._1.userId)
      .groupBy { case (v, (u, ur, r)) => (v.validationResult, r.role === "AI") }
      .map { case ((valResult, isAi), group) => (valResult, isAi, group.length) }
      .result
      .map { results: Seq[(ValidationOption.Value, Boolean, Int)] =>
        // Create a ValidationResultTypeForApi object for each validation result type.
        ValidationOption.values.toSeq
          .map { valResult =>
            val currValCounts   = results.filter(_._1 == valResult)
            val humanCount: Int = currValCounts.find(_._2 == false).map(_._3).getOrElse(0)
            val aiCount: Int    = currValCounts.find(_._2 == true).map(_._3).getOrElse(0)
            ValidationResultTypeForApi(
              name = valResult.toString,
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
   * schemas across different city deployments ('Agree', 'Disagree', 'Unsure').
   *
   * @param startDate        Inclusive lower bound on end_timestamp (Pacific date); no bound if None.
   * @param endDate          Inclusive upper bound on end_timestamp; no bound if None.
   * @param filterLowQuality If true, restrict to user_stat.high_quality users; otherwise exclude
   *                         only user_stat.excluded users.
   * @return                 Sequence of (date, labelType, humanAgree, humanDisagree, humanUnsure,
   *                         aiAgree, aiDisagree, aiUnsure), sorted by date then label type.
   */
  def getDailyValidationStats(
      startDate: Option[LocalDate],
      endDate: Option[LocalDate],
      filterLowQuality: Boolean
  ): DBIO[Seq[(LocalDate, String, Int, Int, Int, Int, Int, Int)]] = {
    val userFilter   = if (filterLowQuality) "user_stat.high_quality" else "NOT user_stat.excluded"
    val whereClauses = scala.collection.mutable.ListBuffer(
      "label.deleted = FALSE",
      userFilter
    )
    startDate.foreach(d => whereClauses += s"label_validation.end_timestamp >= '$d'::date")
    endDate.foreach(d => whereClauses += s"label_validation.end_timestamp < ('$d'::date + INTERVAL '1 day')")
    val where = whereClauses.mkString(" AND ")

    implicit val getResult: GetResult[(LocalDate, String, Int, Int, Int, Int, Int, Int)] =
      GetResult(r =>
        (LocalDate.parse(r.nextString()), r.nextString(), r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt(),
          r.nextInt(), r.nextInt())
      )

    sql"""
      SELECT CAST((label_validation.end_timestamp AT TIME ZONE 'US/Pacific')::date AS TEXT) AS date,
             label_type.label_type,
             COUNT(CASE WHEN role.role IS DISTINCT FROM 'AI' AND label_validation.validation_result::text = 'Agree'
                        THEN 1 END) AS human_agree,
             COUNT(CASE WHEN role.role IS DISTINCT FROM 'AI' AND label_validation.validation_result::text = 'Disagree'
                        THEN 1 END) AS human_disagree,
             COUNT(CASE WHEN role.role IS DISTINCT FROM 'AI' AND label_validation.validation_result::text = 'Unsure'
                        THEN 1 END) AS human_unsure,
             COUNT(CASE WHEN role.role = 'AI' AND label_validation.validation_result::text = 'Agree'
                        THEN 1 END) AS ai_agree,
             COUNT(CASE WHEN role.role = 'AI' AND label_validation.validation_result::text = 'Disagree'
                        THEN 1 END) AS ai_disagree,
             COUNT(CASE WHEN role.role = 'AI' AND label_validation.validation_result::text = 'Unsure'
                        THEN 1 END) AS ai_unsure
      FROM label_validation
      INNER JOIN label      ON label_validation.label_id    = label.label_id
      INNER JOIN label_type ON label.label_type_id          = label_type.label_type_id
      INNER JOIN user_stat  ON label_validation.user_id     = user_stat.user_id
      LEFT  JOIN sidewalk_login.user_role ON label_validation.user_id = user_role.user_id
      LEFT  JOIN sidewalk_login.role      ON user_role.role_id        = role.role_id
      WHERE #$where
      GROUP BY (label_validation.end_timestamp AT TIME ZONE 'US/Pacific')::date, label_type.label_type
      ORDER BY date ASC, label_type.label_type
    """.as[(LocalDate, String, Int, Int, Int, Int, Int, Int)]
  }
}
