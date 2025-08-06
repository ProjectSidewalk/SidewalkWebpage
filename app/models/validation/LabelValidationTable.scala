package models.validation

import com.google.inject.ImplementedBy
import models.api.{ValidationDataForApi, ValidationFiltersForApi, ValidationResultTypeForApi}
import models.label.LabelTypeEnum.{labelTypeIdToLabelType, validLabelTypeIds, validLabelTypes}
import models.label._
import models.user.SidewalkUserTable.aiUserId
import models.user.{RoleTableDef, SidewalkUserTableDef, UserRoleTableDef}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import models.validation.LabelValidationTable.validationOptions
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import service.TimeInterval
import service.TimeInterval.TimeInterval

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class LabelValidation(
    labelValidationId: Int,
    labelId: Int,
    validationResult: Int,
    oldSeverity: Option[Int],
    newSeverity: Option[Int],
    oldTags: List[String],
    newTags: List[String],
    userId: String,
    missionId: Int,
    // NOTE: canvas_x and canvas_y are null when the label is not visible when validation occurs.
    canvasX: Option[Int],
    canvasY: Option[Int],
    heading: Float,
    pitch: Float,
    zoom: Float,
    canvasHeight: Int,
    canvasWidth: Int,
    startTimestamp: OffsetDateTime,
    endTimestamp: OffsetDateTime,
    source: String
)

case class ValidationCount(
    count: Int,
    timeInterval: TimeInterval,
    labelType: String,
    validationResult: String,
    validatorType: String
) {
  require((validLabelTypes ++ Seq("All")).contains(labelType))
  require((validationOptions.values.toSeq ++ Seq("All")).contains(validationResult))
  require(Seq("AI", "Human", "Both").contains(validatorType))
}

/**
 * Stores data from each validation interaction.
 * https://www.programcreek.com/scala/slick.lifted.ForeignKeyQuery
 * @param tag
 */
class LabelValidationTableDef(tag: slick.lifted.Tag) extends Table[LabelValidation](tag, "label_validation") {
  def labelValidationId: Rep[Int]         = column[Int]("label_validation_id", O.AutoInc)
  def labelId: Rep[Int]                   = column[Int]("label_id")
  def validationResult: Rep[Int]          = column[Int]("validation_result") // 1 = Agree, 2 = Disagree, 3 = Unsure
  def oldSeverity: Rep[Option[Int]]       = column[Option[Int]]("old_severity")
  def newSeverity: Rep[Option[Int]]       = column[Option[Int]]("new_severity")
  def oldTags: Rep[List[String]]          = column[List[String]]("old_tags")
  def newTags: Rep[List[String]]          = column[List[String]]("new_tags")
  def userId: Rep[String]                 = column[String]("user_id")
  def missionId: Rep[Int]                 = column[Int]("mission_id")
  def canvasX: Rep[Option[Int]]           = column[Option[Int]]("canvas_x")
  def canvasY: Rep[Option[Int]]           = column[Option[Int]]("canvas_y")
  def heading: Rep[Float]                 = column[Float]("heading")
  def pitch: Rep[Float]                   = column[Float]("pitch")
  def zoom: Rep[Float]                    = column[Float]("zoom")
  def canvasHeight: Rep[Int]              = column[Int]("canvas_height")
  def canvasWidth: Rep[Int]               = column[Int]("canvas_width")
  def startTimestamp: Rep[OffsetDateTime] = column[OffsetDateTime]("start_timestamp")
  def endTimestamp: Rep[OffsetDateTime]   = column[OffsetDateTime]("end_timestamp")
  def source: Rep[String]                 = column[String]("source")

  def * = (labelValidationId, labelId, validationResult, oldSeverity, newSeverity, oldTags, newTags, userId, missionId,
    canvasX, canvasY, heading, pitch, zoom, canvasHeight, canvasWidth, startTimestamp, endTimestamp, source) <>
    ((LabelValidation.apply _).tupled, LabelValidation.unapply)

//  def label: ForeignKeyQuery[LabelTable, Label] =
//    foreignKey("label_validation_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
//
//  def user: ForeignKeyQuery[UserTable, DBUser] =
//    foreignKey("label_validation_user_id_fkey", userId, TableQuery[UserTableDef])(_.userId)
//
//  def mission: ForeignKeyQuery[MissionTable, Mission] =
//    foreignKey("label_validation_mission_id_fkey", missionId, TableQuery[MissionTableDef])(_.missionId)

//  def userLabelUnique: Index = index("label_validation_user_id_label_id_unique", (userId, labelId), unique = true)
}

/**
 * Companion object with constants that are shared throughout codebase.
 */
object LabelValidationTable {
  val validationOptions: Map[Int, String] = Map(1 -> "Agree", 2 -> "Disagree", 3 -> "Unsure")
}

@ImplementedBy(classOf[LabelValidationTable])
trait LabelValidationTableRepository {}

@Singleton
class LabelValidationTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    labelTable: LabelTable,
    implicit val ec: ExecutionContext
) extends LabelValidationTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val validations          = TableQuery[LabelValidationTableDef]
  val users                = TableQuery[SidewalkUserTableDef]
  val userRoles            = TableQuery[UserRoleTableDef]
  val roleTable            = TableQuery[RoleTableDef]
  val labelsUnfiltered     = TableQuery[LabelTableDef]
  val labelTypeTable       = TableQuery[LabelTypeTableDef]
  val humanValidations     = validations.filter(_.userId =!= aiUserId)
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
        val agreeCount    = results.find(_._1 == 1).map(_._2).getOrElse(0)
        val disagreeCount = results.find(_._1 == 2).map(_._2).getOrElse(0)
        val unsureCount   = results.find(_._1 == 3).map(_._2).getOrElse(0)
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
  def getUserAccuracy(userId: String): DBIO[Option[Float]] = {
    sql"""
      SELECT CASE WHEN validated_count > 9 THEN accuracy ELSE NULL END AS accuracy
      FROM (
          SELECT CAST(SUM(CASE WHEN correct THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(SUM(CASE WHEN correct THEN 1 ELSE 0 END) + SUM(CASE WHEN NOT correct THEN 1 ELSE 0 END), 0) AS accuracy,
                 COUNT(CASE WHEN correct IS NOT NULL THEN 1 END) AS validated_count
          FROM label
          WHERE label.deleted = FALSE
              AND label.tutorial = FALSE
              AND label.user_id = $userId
      ) "accuracy_subquery";""".as[Option[Float]].map(_.headOption.flatten)
  }

  /**
   * Select validation counts per user.
   * @return list of tuples (labeler_id, (labeler_role, labels_validated, agreed_count))
   */
  def getValidationCountsByUser: DBIO[Seq[(String, (String, Int, Int))]] = {
    val _labels = for {
      _label <- labelTable.labelsWithExcludedUsers
      _user  <- users if _user.username =!= "anonymous" && _user.userId === _label.userId // User who placed the label.
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
      .filter(_.labelValidationId =!= 3) // Exclude "unsure" validations.
      .groupBy(_.userId)
      .map { case (userId, group) =>
        // Sum up the agreed validations and total validations (just agreed + disagreed).
        val agreed = group.map { r => Case.If(r.validationResult === 1).Then(1).Else(0) }.sum.getOrElse(0)
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
      .groupBy { case (v, l) => (l.labelTypeId, v.validationResult, v.userId === aiUserId) }
      .map { case ((labelTypeId, valResult, isAi), group) => (labelTypeId, valResult, isAi, group.length) }
      .result
      .map { valCounts =>
        // We want to also calculate a sum for every possible subgroup b/w label_type, validation_result and validator.
        // Let's start by enumerating every subgroup combination. We include None for each of the three fields to
        // allow for "All" entries.
        val subgroupCombinations: Set[(Option[Int], Option[Int], Option[Boolean])] = for {
          labelType <- validLabelTypeIds.map(Some(_)) ++ Seq(None)
          valResult <- validationOptions.keys.map(Some(_)) ++ Seq(None)
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
          val valOption = valResultFilter.map(validationOptions).getOrElse("All")
          val validator = validatorFilter.map(isAi => if (isAi) "AI" else "Human").getOrElse("Both")
          ValidationCount(subgroupCount, timeInterval, labelType, valOption, validator)
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
   * Gets validation data for API with filters applied. Returns raw tuples to be converted to ValidationDataForApi.
   *
   * @param filters The filters to apply to the validation data.
   * @return A query for retrieving filtered validation data as tuples.
   */
  def getValidationsForApi(filters: ValidationFiltersForApi): Query[_, (LabelValidation, Label, LabelType), Seq] = {
    for {
      validation <- validations
      label      <- labelsUnfiltered if validation.labelId === label.labelId
      labelType  <- labelTypeTable if label.labelTypeId === labelType.labelTypeId

      // Apply filters.
      if filters.labelId.map(validation.labelId === _).getOrElse(true: Rep[Boolean]) &&
        filters.userId.map(validation.userId === _).getOrElse(true: Rep[Boolean]) &&
        filters.validationResult.map(validation.validationResult === _).getOrElse(true: Rep[Boolean]) &&
        filters.labelTypeId.map(label.labelTypeId === _).getOrElse(true: Rep[Boolean]) &&
        filters.validationTimestamp.map(validation.startTimestamp >= _).getOrElse(true: Rep[Boolean])

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

    } yield (validation, label, labelType)
  }

  /**
   * Converts a tuple from the database query to ValidationDataForApi. A helper method to be used in the service layer.
   *
   * TODO try doing something like TupleConverter in LabelTable.scala. Need a more general solution.
   */
  def tupleToValidationDataForApi(
      tuple: (LabelValidation, models.label.Label, models.label.LabelType)
  ): ValidationDataForApi = {
    val (validation, label, labelType) = tuple
    ValidationDataForApi(
      labelValidationId = validation.labelValidationId,
      labelId = validation.labelId,
      labelTypeId = label.labelTypeId,
      labelType = labelType.labelType,
      validationResult = validation.validationResult,
      // Convert validation result to string using the companion object mapping.
      validationResultString = LabelValidationTable.validationOptions.getOrElse(validation.validationResult, "Unknown"),
      oldSeverity = validation.oldSeverity,
      newSeverity = validation.newSeverity,
      oldTags = validation.oldTags,
      newTags = validation.newTags,
      userId = validation.userId,
      validatorType = if (validation.userId == aiUserId) "AI" else "Human",
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
   * Retrieves all validation result types with their counts.
   *
   * @return A database action that, when executed, will return a sequence of ValidationResultTypeForApi objects.
   */
  def getValidationResultTypes: DBIO[Seq[ValidationResultTypeForApi]] = {
    validations
      .groupBy(_.validationResult)
      .map { case (result, group) => (result, group.length) }
      .result
      .map { results =>
        val resultTypesWithCounts = results.map { case (resultId, count) =>
          ValidationResultTypeForApi(
            id = resultId,
            name = LabelValidationTable.validationOptions.getOrElse(resultId, "Unknown"),
            count = count
          )
        }

        // Ensure all validation types are returned even if no validations of that type exist.
        val existingIds: Set[Int] = resultTypesWithCounts.map(_.id).toSet
        val missingTypes          = LabelValidationTable.validationOptions
          .filterNot { case (id, _) => existingIds.contains(id) }
          .map { case (id, name) => ValidationResultTypeForApi(id, name, 0) }

        (resultTypesWithCounts ++ missingTypes).sortBy(_.id)
      }
  }
}
