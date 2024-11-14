package models.label

import java.util.UUID
import models.utils.MyPostgresDriver.simple._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.mission.{Mission, MissionTable}
import models.user.{RoleTable, UserRoleTable, UserStatTable}
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}
import scala.slick.jdbc.{StaticQuery => Q}
import scala.slick.lifted.{ForeignKeyQuery, Index}

case class LabelValidation(labelValidationId: Int,
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
  def validationResult = column[Int]("validation_result", O.NotNull) // 1 = Agree, 2 = Disagree, 3 = Unsure
  def oldSeverity = column[Option[Int]]("old_severity", O.Nullable)
  def newSeverity = column[Option[Int]]("new_severity", O.Nullable)
  def oldTags = column[List[String]]("old_tags", O.NotNull)
  def newTags = column[List[String]]("new_tags", O.NotNull)
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

  def * = (labelValidationId, labelId, validationResult, oldSeverity, newSeverity,
    oldTags, newTags, userId, missionId, canvasX, canvasY, heading, pitch, zoom, canvasHeight, canvasWidth,
    startTimestamp, endTimestamp, source) <>
    ((LabelValidation.apply _).tupled, LabelValidation.unapply)

  def label: ForeignKeyQuery[LabelTable, Label] =
    foreignKey("label_validation_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("label_validation_user_id_fkey", userId, TableQuery[UserTable])(_.userId)

  def mission: ForeignKeyQuery[MissionTable, Mission] =
    foreignKey("label_validation_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)

  def userLabelUnique: Index = index("label_validation_user_id_label_id_unique", (userId, labelId), unique = true)
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
  val labelsUnfiltered = TableQuery[LabelTable]
  val labelsWithoutDeleted = labelsUnfiltered.filter(_.deleted === false)

  val validationOptions: Map[Int, String] = Map(1 -> "Agree", 2 -> "Disagree", 3 -> "Unsure")

  /**
   * A function to count all validations by the given user for the given label.
   * There should only ever be a maximum of one.
   *
   * @param userId
   * @param labelId The ID of the label
   * @return An integer with the count
   */
  def countValidationsFromUserAndLabel(userId: UUID, labelId: Int): Int = db.withSession { implicit session =>
    validationLabels.filter(v => v.userId === userId.toString && v.labelId === labelId).length.run
  }
  
  /**
    * Returns how many agree, disagree, or unsure validations a user entered for a given mission.
    *
    * @param missionId  Mission ID of mission
    * @param result     Validation result (1 - agree, 2 - disagree, 3 - unsure)
    * @return           Number of labels that were
    */
  def countResultsFromValidationMission(missionId: Int, result: Int): Int = db.withSession { implicit session =>
    validationLabels.filter(_.missionId === missionId).filter(_.validationResult === result).length.run
  }

  /**
    * Gets additional information about the number of label validations for the current mission.
    *
    * @param missionId  Mission ID of the current mission
    * @return           JSON Object with information about agree/disagree/unsure counts
    */
  def getValidationProgress (missionId: Int): JsObject = {
    val agreeCount: Int = countResultsFromValidationMission(missionId, 1)
    val disagreeCount: Int = countResultsFromValidationMission(missionId, 2)
    val unsureCount: Int = countResultsFromValidationMission(missionId, 3)

    Json.obj(
      "agree_count" -> agreeCount,
      "disagree_count" -> disagreeCount,
      "unsure_count" -> unsureCount
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
    labelsUnfiltered.filter(_.labelId inSet labelIds).map(_.userId).groupBy(x => x).map(_._1).list
  }

  /**
   * Inserts into the label_validation table. Updates severity, tags, & validation counts in the label table.
   *
   * @return The label_validation_id of the inserted/updated validation.
   */
  def insert(labelVal: LabelValidation): Int = db.withTransaction { implicit session =>
    UserStatTable.addUserStatIfNew(UUID.fromString(labelVal.userId))
    val isExcludedUser: Boolean = UserStatTable.userStats.filter(_.userId === labelVal.userId).map(_.excluded).first
    val userThatAppliedLabel: String = labelsUnfiltered.filter(_.labelId === labelVal.labelId).map(_.userId).list.head

    // Update val counts in label table if they're not validating their own label and aren't an excluded user.
    if (userThatAppliedLabel != labelVal.userId & !isExcludedUser)
      updateValidationCounts(labelVal.labelId, Some(labelVal.validationResult), None)

    // Insert a new validation into the label_validation table.
    (validationLabels returning validationLabels.map(_.labelValidationId)) += labelVal
  }

  /**
   * Deletes a validation in the label_validation table. Also updates validation counts in the label table.
   */
  def deleteLabelValidation(labelId: Int, userId: String): Int = db.withTransaction { implicit session =>
    val oldValQuery = validationLabels.filter(x => x.labelId === labelId && x.userId === userId)
    val oldVal: LabelValidation = oldValQuery.first

    // Delete any changes from label_history table, updating label table accordingly (only needed if they marked Agree).
    if (oldVal.validationResult == 1) LabelTable.removeLabelHistoryForValidation(oldVal.labelValidationId)

    val excludedUser: Boolean = UserStatTable.userStats.filter(_.userId === userId).map(_.excluded).first
    val userThatAppliedLabel: String = labelsUnfiltered.filter(_.labelId === labelId).map(_.userId).list.head

    // Delete the old validation from the label_validation table.
    val rowsAffected: Int = oldValQuery.delete

    // Update validation counts.
    if (userThatAppliedLabel != userId & !excludedUser)
      updateValidationCounts(labelId, None, Some(oldVal.validationResult))

    rowsAffected
  }

  /**
   * Updates the validation counts and correctness columns in the label table given a new incoming validation.
   *
   * @param labelId label_id of the label with a new validation
   * @param newValidationResult the new validation: 1 meaning agree, 2 meaning disagree, and 3 meaning unsure
   * @param oldValidationResult the old validation if the user had validated this label in the past
   */
  def updateValidationCounts(labelId: Int, newValidationResult: Option[Int], oldValidationResult: Option[Int])(implicit session: Session): Int = {
    require(newValidationResult.isEmpty || List(1, 2, 3).contains(newValidationResult.get), "New validation results can only be 1, 2, or 3.")
    require(oldValidationResult.isEmpty || List(1, 2, 3).contains(oldValidationResult.get), "Old validation results can only be 1, 2, or 3.")

    // Get the validation counts that are in the database right now.
    val oldCounts: (Int, Int, Int) =
      labelsUnfiltered.filter(_.labelId === labelId).map(l => (l.agreeCount, l.disagreeCount, l.unsureCount)).first

    // Add 1 to the correct count for the new validation. In case of delete, no match is found.
    val countsWithNewVal: (Int, Int, Int) = newValidationResult match {
      case Some(1) => (oldCounts._1 + 1, oldCounts._2, oldCounts._3)
      case Some(2) => (oldCounts._1, oldCounts._2 + 1, oldCounts._3)
      case Some(3) => (oldCounts._1, oldCounts._2, oldCounts._3 + 1)
      case _ => oldCounts
    }

    // If there was a previous validation from this user, subtract 1 for that old validation. O/w use previous result.
    val countsWithoutOldVal: (Int, Int, Int) = oldValidationResult match {
      case Some(1) => (countsWithNewVal._1 - 1, countsWithNewVal._2, countsWithNewVal._3)
      case Some(2) => (countsWithNewVal._1, countsWithNewVal._2 - 1, countsWithNewVal._3)
      case Some(3) => (countsWithNewVal._1, countsWithNewVal._2, countsWithNewVal._3 - 1)
      case _ => countsWithNewVal
    }

    // Determine whether the label is correct. Agree > disagree = correct; disagree > agree = incorrect; o/w null.
    val labelCorrect: Option[Boolean] = {
      if (countsWithoutOldVal._1 > countsWithoutOldVal._2) Some(true)
      else if (countsWithoutOldVal._2 > countsWithoutOldVal._1) Some(false)
      else None
    }

    // Update the agree_count, disagree_count, unsure_count, and correct columns in the label table.
    labelsUnfiltered
      .filter(_.labelId === labelId)
      .map(l => (l.agreeCount, l.disagreeCount, l.unsureCount, l.correct))
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
        |    FROM label
        |    WHERE label.deleted = FALSE
        |        AND label.tutorial = FALSE
        |        AND label.user_id = ?
        |) "accuracy_subquery";""".stripMargin
    )
    accuracyQuery(userId.toString).firstOption.flatten
  }

  /**
    * Select validation counts per user.
    *
    * @return list of tuples (labeler_id, labeler_role, labels_validated, agreed_count)
    */
  def getValidationCountsPerUser: List[(String, String, Int, Int)] = db.withSession { implicit session =>
    val _labels = for {
      _label <- LabelTable.labelsWithExcludedUsers
      _user <- users if _user.username =!= "anonymous" && _user.userId === _label.userId // User who placed the label.
      _userRole <- userRoles if _user.userId === _userRole.userId
      _role <- roleTable if _userRole.roleId === _role.roleId
      if _label.correct.isDefined // Filter for labels marked as either correct or incorrect.
    } yield (_user.userId, _role.role, _label.correct)

    // Count the number of correct labels and total number marked as either correct or incorrect for each user.
    _labels.groupBy(l => (l._1, l._2)).map { case ((userId, role), group) => (
      userId,
      role,
      group.length, // # Correct or incorrect.
      group.map(l => Case.If(l._3.getOrElse(false) === true).Then(1).Else(0)).sum.getOrElse(0) // # Correct labels.
    )}.list
  }

  /**
    * Count number of validations supplied per user.
    *
    * @return list of tuples of (labeler_id, validation_count, validation_agreed_count, validation_disagreed_count)
    */
  def getValidatedCountsPerUser: List[(String, Int, Int)] = db.withSession { implicit session =>
    val validations = for {
      _validation <- validationLabels
      _validationUser <- users if _validationUser.userId === _validation.userId
      _userRole <- userRoles if _validationUser.userId === _userRole.userId
      if _validationUser.username =!= "anonymous"
      if _validation.labelValidationId =!= 3 // Exclude "unsure" validations.
    } yield (_validationUser.userId, _validation.validationResult)

    // Counts the number of labels for each user by grouping by user_id and role.
    validations.groupBy(l => l._1).map {
      case (uId, group) => {
        // Sum up the agreed validations and total validations (just agreed + disagreed).
        val agreed = group.map { r => Case.If(r._2 === 1).Then(1).Else(0) }.sum.getOrElse(0)
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
    val countQuery = Q.queryNA[Int](
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
    val countQuery = Q.queryNA[Int](
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
    val countQuery = Q.queryNA[Int](
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
    val countQuery = Q.queryNA[Int](
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
