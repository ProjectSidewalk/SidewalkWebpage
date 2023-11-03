package models.label

import java.util.UUID
import models.utils.MyPostgresDriver.simple._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.mission.{Mission, MissionTable}
import models.user.{RoleTable, UserRoleTable, UserStatTable}
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}
import scala.slick.jdbc.{StaticQuery => Q}
import scala.slick.lifted.ForeignKeyQuery

case class LabelValidation(labelValidationId: Int,
                           labelId: Int,
                           validationResult: Int,
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
                           startTimestamp: java.sql.Timestamp,
                           endTimestamp: java.sql.Timestamp,
                           source: String)


/**
  * Stores data from each validation interaction.
  * https://www.programcreek.com/scala/slick.lifted.ForeignKeyQuery
  * @param tag
  */
class LabelValidationTable (tag: slick.lifted.Tag) extends Table[LabelValidation](tag, "label_validation") {
  def labelValidationId = column[Int]("label_validation_id", O.AutoInc)
  def labelId = column[Int]("label_id", O.NotNull)
  def validationResult = column[Int]("validation_result", O.NotNull) // 1 = Agree, 2 = Disagree, 3 = Notsure
  def userId = column[String]("user_id", O.NotNull)
  def missionId = column[Int]("mission_id", O.NotNull)
  def canvasX = column[Option[Int]]("canvas_x", O.Nullable)
  def canvasY = column[Option[Int]]("canvas_y", O.Nullable)
  def heading = column[Float]("heading", O.NotNull)
  def pitch = column[Float]("pitch", O.NotNull)
  def zoom = column[Float]("zoom", O.NotNull)
  def canvasHeight = column[Int]("canvas_height", O.NotNull)
  def canvasWidth = column[Int]("canvas_width", O.NotNull)
  def startTimestamp = column[java.sql.Timestamp]("start_timestamp", O.NotNull)
  def endTimestamp = column[java.sql.Timestamp]("end_timestamp", O.NotNull)
  def source = column[String]("source", O.NotNull)

  def * = (labelValidationId, labelId, validationResult, userId, missionId, canvasX, canvasY,
    heading, pitch, zoom, canvasHeight, canvasWidth, startTimestamp, endTimestamp, source) <>
    ((LabelValidation.apply _).tupled, LabelValidation.unapply)

  def label: ForeignKeyQuery[LabelTable, Label] =
    foreignKey("label_validation_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("label_validation_user_id_fkey", userId, TableQuery[UserTable])(_.userId)

  def mission: ForeignKeyQuery[MissionTable, Mission] =
    foreignKey("label_validation_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)
}

/**
  * Data access table for label_validation table.
  */
object LabelValidationTable {
  val db = play.api.db.slick.DB
  val validationLabels = TableQuery[LabelValidationTable]
  val users = TableQuery[UserTable]
  val userRoles = TableQuery[UserRoleTable]
  val roleTable = TableQuery[RoleTable]
  val labels = TableQuery[LabelTable]
  val labelsWithoutDeleted = labels.filter(_.deleted === false)

  val validationOptions: Map[Int, String] = Map(1 -> "Agree", 2 -> "Disagree", 3 -> "NotSure")

  /**
    * Returns how many agree, disagree, or notsure validations a user entered for a given mission.
    *
    * @param missionId  Mission ID of mission
    * @param result     Validation result (1 - agree, 2 - disagree, 3 - notsure)
    * @return           Number of labels that were
    */
  def countResultsFromValidationMission(missionId: Int, result: Int): Int = db.withSession { implicit session =>
    validationLabels.filter(_.missionId === missionId).filter(_.validationResult === result).length.run
  }

  /**
    * Gets additional information about the number of label validations for the current mission.
    *
    * @param missionId  Mission ID of the current mission
    * @return           JSON Object with information about agree/disagree/not sure counts
    */
  def getValidationProgress (missionId: Int): JsObject = {
    val agreeCount: Int = countResultsFromValidationMission(missionId, 1)
    val disagreeCount: Int = countResultsFromValidationMission(missionId, 2)
    val notSureCount: Int = countResultsFromValidationMission(missionId, 3)

    Json.obj(
      "agree_count" -> agreeCount,
      "disagree_count" -> disagreeCount,
      "not_sure_count" -> notSureCount
    )
  }

  case class ValidationCountPerDay(date: String, count: Int)

  /**
    * Get the user_ids of the users who placed the given labels.
    *
    * @param labelIds
    * @return
    */
  def usersValidated(labelIds: List[Int]): List[String] = db.withSession { implicit session =>
    (for {
      l <- labels
      m <- MissionTable.missions if l.missionId === m.missionId
      if l.labelId inSet labelIds
    } yield m.userId).groupBy(x => x).map(_._1).list
  }

  /**
   * Updates or inserts a validation in the label_validation table. Also updates validation counts in the label table.
   */
  def insertOrUpdate(label: LabelValidation): Int = db.withTransaction { implicit session =>
    val oldValidation: Option[LabelValidation] =
      validationLabels.filter(x => x.labelId === label.labelId && x.userId === label.userId).firstOption

    val excludedUser: Boolean = UserStatTable.userStats.filter(_.userId === label.userId).map(_.excluded).first
    val userThatAppliedLabel: String =
    labels.filter(_.labelId === label.labelId)
      .innerJoin(MissionTable.missions).on(_.missionId === _.missionId)
      .map(_._2.userId)
      .list.head

    // If there was already a validation, update all the columns that might have changed. O/w just make a new entry.
    oldValidation match {
      case Some(oldLabel) =>
        // Update val counts in label table if they're not validating their own label and aren't an excluded user.
        if (userThatAppliedLabel != label.userId & !excludedUser)
          updateValidationCounts(label.labelId, label.validationResult, Some(oldLabel.validationResult))

        // Update relevant columns in the label_validation table.
        val updateQuery = for {
          v <- validationLabels if v.labelId === label.labelId &&v.userId === label.userId
        } yield (
          v.validationResult, v.missionId, v.canvasX, v.canvasY, v.heading, v.pitch, v.zoom,
          v.canvasHeight, v.canvasWidth, v.startTimestamp, v.endTimestamp, v.source
        )
        updateQuery.update((
          label.validationResult, label.missionId, label.canvasX, label.canvasY, label.heading, label.pitch, label.zoom,
          label.canvasHeight, label.canvasWidth, label.startTimestamp, label.endTimestamp, label.source
        ))
      case None =>
        // Update val counts in label table if they're not validating their own label and aren't an excluded user.
        if (userThatAppliedLabel != label.userId & !excludedUser)
          updateValidationCounts(label.labelId, label.validationResult, None)

        // Insert a new validation into the label_validation table.
        (validationLabels returning validationLabels.map(_.labelValidationId)) += label
    }
  }

  /**
   * Updates the validation counts and correctness columns in the label table given a new incoming validation.
   *
   * @param labelId label_id of the label with a new validation
   * @param newValidationResult the new validation: 1 meaning agree, 2 meaning disagree, and 3 meaning not sure
   * @param oldValidationResult the old validation if the user had validated this label in the past
   */
  def updateValidationCounts(labelId: Int, newValidationResult: Int, oldValidationResult: Option[Int]): Int = db.withSession { implicit session =>
    // Get the validation counts that are in the database right now.
    val oldCounts: (Int, Int, Int) =
      labels.filter(_.labelId === labelId)
        .map(l => (l.agreeCount, l.disagreeCount, l.notsureCount)).first

    // Add 1 to the correct count for the new validation.
    val countsWithNewVal: (Int, Int, Int) = newValidationResult match {
      case 1 => (oldCounts._1 + 1, oldCounts._2, oldCounts._3)
      case 2 => (oldCounts._1, oldCounts._2 + 1, oldCounts._3)
      case 3 => (oldCounts._1, oldCounts._2, oldCounts._3 + 1)
    }

    // If there was a previous validation from this user, subtract 1 for that old validation. O/w use previous result.
    val countsWithoutOldVal: (Int, Int, Int) = oldValidationResult match {
      case Some(oldVal) => oldVal match {
        case 1 => (countsWithNewVal._1 - 1, countsWithNewVal._2, countsWithNewVal._3)
        case 2 => (countsWithNewVal._1, countsWithNewVal._2 - 1, countsWithNewVal._3)
        case 3 => (countsWithNewVal._1, countsWithNewVal._2, countsWithNewVal._3 - 1)
      }
      case None => countsWithNewVal
    }

    // Determine whether the label is correct. Agree > disagree = correct; disagree > agree = incorrect; o/w null.
    val labelCorrect: Option[Boolean] = {
      if (countsWithoutOldVal._1 > countsWithoutOldVal._2) Some(true)
      else if (countsWithoutOldVal._2 > countsWithoutOldVal._1) Some(false)
      else None
    }

    // Update the agree_count, disagree_count, notsure_count, and correct columns in the label table.
    labels
      .filter(_.labelId === labelId)
      .map(l => (l.agreeCount, l.disagreeCount, l.notsureCount, l.correct))
      .update((countsWithoutOldVal._1, countsWithoutOldVal._2, countsWithoutOldVal._3, labelCorrect))
  }

  /**
   * Calculates and returns the user accuracy for the supplied userId. The accuracy calculation is performed if and only
   * if 10 of the user's labels have been validated. A label is considered validated if it has either more agree
   * votes than disagree votes, or more disagree votes than agree votes.
   */
  def getUserAccuracy(userId: UUID): Option[Float] = db.withSession { implicit session =>
    val accuracyQuery = Q.query[String, Option[Float]](
      """SELECT CASE WHEN validated_count > 9 THEN accuracy ELSE NULL END AS accuracy
        |FROM (
        |    SELECT CAST(SUM(CASE WHEN correct THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(SUM(CASE WHEN correct THEN 1 ELSE 0 END) + SUM(CASE WHEN NOT correct THEN 1 ELSE 0 END), 0) AS accuracy,
        |           COUNT(CASE WHEN correct IS NOT NULL THEN 1 END) AS validated_count
        |    FROM mission
        |    INNER JOIN label ON mission.mission_id = label.mission_id
        |    WHERE label.deleted = FALSE
        |        AND label.tutorial = FALSE
        |        AND mission.user_id = ?
        |) "accuracy_subquery";""".stripMargin
    )
    accuracyQuery(userId.toString).firstOption.flatten
  }

  /**
    * Select validation counts per user.
    *
    * @return list of tuples (labeler_id, labeler_role, labels_validated, agreed_count, disagreed_count, notsure_count)
    */
  def getValidationCountsPerUser: List[(String, String, Int, Int, Int, Int)] = db.withSession { implicit session =>
    val labels = for {
      _label <- LabelTable.labelsWithExcludedUsers
      _mission <- MissionTable.missions if _label.missionId === _mission.missionId
      _user <- users if _user.username =!= "anonymous" && _user.userId === _mission.userId // User who placed the label
      _userRole <- userRoles if _user.userId === _userRole.userId
      _role <- roleTable if _userRole.roleId === _role.roleId
      if _label.agreeCount > 0 || _label.disagreeCount > 0 || _label.notsureCount > 0 // Filter for labels w/ validation
    } yield (_user.userId, _role.role, _label.correct)

    // Count the number of correct/incorrect/notsure labels for each user.
    labels.groupBy(l => (l._1, l._2)).map { case ((userId, role), group) => (
      userId,
      role,
      group.length,
      group.map(l => Case.If(l._3.getOrElse(false) === true).Then(1).Else(0)).sum.getOrElse(0), // # correct labels
      group.map(l => Case.If(l._3.getOrElse(true) === false).Then(1).Else(0)).sum.getOrElse(0), // # incorrect labels
      group.map(l => Case.If(l._3.isEmpty).Then(1).Else(0)).sum.getOrElse(0)                    // # notsure labels
    )}.list
  }

  /**
    * Count number of validations supplied per user.
    *
    * @return list of tuples of (labeler_id, validation_count, validation_agreed_count)
    */
  def getValidatedCountsPerUser: List[(String, Int, Int)] = db.withSession { implicit session =>
    val validations = for {
      _validation <- validationLabels
      _validationUser <- users if _validationUser.userId === _validation.userId
      _userRole <- userRoles if _validationUser.userId === _userRole.userId
      if _validationUser.username =!= "anonymous"
    } yield (_validationUser.userId, _validation.validationResult)

    // Counts the number of labels for each user by grouping by user_id and role.
    validations.groupBy(l => l._1).map {
      case (uId, group) => {
        // Sum up the agreed results
        val agreed = group.map { r =>
          Case.If(r._2 === 1).Then(1).Else(0) // Only count it if the result was "agree"
        }.sum.getOrElse(0)

        // group.length is the total # of validations
        (uId, group.length, agreed)
      }
    }.list
  }

  /**
    * @return count of validations for the given label type
    */
  def countValidations(labelType: String): Int = db.withSession { implicit session =>
    val typeID = LabelTypeTable.labelTypeToId(labelType)

    validationLabels.innerJoin(labelsWithoutDeleted).on(_.labelId === _.labelId)
      .filter(_._2.labelTypeId === typeID)
      .length.run
  }

  /**
    * @return count of validations for the given validation result and label type
    */
  def countValidationsByResult(result: Int, labelType: String): Int = db.withSession { implicit session =>
    val typeID = LabelTypeTable.labelTypeToId(labelType)

    validationLabels.innerJoin(labelsWithoutDeleted).on(_.labelId === _.labelId)
      .filter(_._2.labelTypeId === typeID)
      .filter(_._1.validationResult === result)
      .length.run
  }

  /**
   * Counts the number of validations performed by this user (given the supplied userId).
   *
   * @returns the number of validations performed by this user
   */
  def countValidations(userId: UUID): Int = db.withSession { implicit session =>
    validationLabels.filter(_.userId === userId.toString).length.run
  }

  /**
    * @return total number of validations
    */
  def countValidations: Int = db.withTransaction(implicit session =>
    validationLabels.length.run
  )

  /**
    * @return total number of validations with a given result
    */
  def countValidationsByResult(result: Int): Int = db.withTransaction(implicit session =>
    validationLabels.filter(_.validationResult === result).length.run
  )

  /**
    * @return total number of today's validations
    */
  def countTodayValidations: Int = db.withSession { implicit session =>
    val countQuery = Q.queryNA[(Int)](
      """SELECT COUNT(v.label_id)
        |FROM label_validation v
        |WHERE (v.end_timestamp AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date""".stripMargin
    )
    countQuery.first
  }

  /**
    * @return total number of the past week's validations
    */
  def countPastWeekValidations: Int = db.withSession { implicit session =>
    val countQuery = Q.queryNA[(Int)](
      """SELECT COUNT(v.label_id)
        |FROM label_validation v
        |WHERE (v.end_timestamp AT TIME ZONE 'US/Pacific') > (NOW() AT TIME ZONE 'US/Pacific') - interval '168 hours'""".stripMargin
    )
    countQuery.first
  }

  /**
    * @return total number of today's validations with a given result
    */
  def countTodayValidationsByResult(result: Int): Int = db.withSession { implicit session =>
    val countQuery = Q.queryNA[(Int)](
      s"""SELECT COUNT(v.label_id)
        |FROM label_validation v
        |WHERE (v.end_timestamp AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date
        |   AND v.validation_result = $result""".stripMargin
    )
    countQuery.first
  }

  /**
    * @return total number of the past week's validations with a given result
    */
  def countPastWeekValidationsByResult(result: Int): Int = db.withSession { implicit session =>
    val countQuery = Q.queryNA[(Int)](
      s"""SELECT COUNT(v.label_id)
         |FROM label_validation v
         |WHERE (v.end_timestamp AT TIME ZONE 'US/Pacific') > (NOW() AT TIME ZONE 'US/Pacific') - interval '168 hours'
         |   AND v.validation_result = $result""".stripMargin
    )
    countQuery.first
  }

  /**
    * @return number of validations per date
    */
  def getValidationsByDate: List[ValidationCountPerDay] = db.withSession { implicit session =>
    val selectValidationCountQuery = Q.queryNA[(String, Int)](
      """SELECT calendar_date, COUNT(label_validation_id)
        |FROM
        |(
        |    SELECT label_validation_id, end_timestamp::date AS calendar_date
        |    FROM label_validation
        |) AS calendar
        |GROUP BY calendar_date
        |ORDER BY calendar_date""".stripMargin
    )

    selectValidationCountQuery.list.map(x => ValidationCountPerDay.tupled(x))
  }
}
