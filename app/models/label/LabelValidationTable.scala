package models.label

import models.utils.MyPostgresDriver.simple._
import models.audit.AuditTaskTable
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.mission.{Mission, MissionTable}
import models.user.{RoleTable, UserRoleTable}
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}

import scala.slick.jdbc.{GetResult, StaticQuery => Q}
import scala.slick.lifted.ForeignKeyQuery

case class LabelValidation(validationId: Int,
                           labelId: Int,
                           labelValidationId: Int,
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
                           endTimestamp: java.sql.Timestamp)


/**
  * Stores data from each validation interaction
  * https://www.programcreek.com/scala/slick.lifted.ForeignKeyQuery
  * @param tag
  */
class LabelValidationTable (tag: slick.lifted.Tag) extends Table[LabelValidation](tag, Some("sidewalk"), "label_validation") {
  def labelValidationId = column[Int]("label_validation_id", O.AutoInc)
  def labelId = column[Int]("label_id", O.NotNull)
  def validationResult = column[Int]("validation_result", O.NotNull) // 1 = Agree, 2 = Disagree, 3 = Unsure
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

  def * = (labelValidationId, labelId, validationResult, userId, missionId, canvasX, canvasY,
    heading, pitch, zoom, canvasHeight, canvasWidth, startTimestamp, endTimestamp) <>
    ((LabelValidation.apply _).tupled, LabelValidation.unapply)

  def label: ForeignKeyQuery[LabelTable, Label] =
    foreignKey("label_validation_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("label_validation_user_id_fkey", userId, TableQuery[UserTable])(_.userId)

  def mission: ForeignKeyQuery[MissionTable, Mission] =
    foreignKey("label_validation_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)
}

/**
  * Data access table for label validation table
  */
object LabelValidationTable {
  val db = play.api.db.slick.DB
  val users = TableQuery[UserTable]
  val userRoles = TableQuery[UserRoleTable]
  val roleTable = TableQuery[RoleTable]
  val auditTasks = TableQuery[AuditTaskTable]
  val labels = TableQuery[LabelTable]
  val labelsWithoutDeleted = labels.filter(_.deleted === false)

  val validationLabels = TableQuery[LabelValidationTable]

  /**
    * Returns how many agree, disagree, or unsure validations a user entered for a given mission
    * @param missionId  Mission ID of mission
    * @param result     Validation result (1 - agree, 2 - disagree, 3 - unsure)
    * @return           Number of labels that were
    */
  def countResultsFromValidationMission(missionId: Int, result: Int): Int = db.withSession { implicit session =>
    validationLabels.filter(_.missionId === missionId).filter(_.validationResult === result).length.run
  }

  /**
    * Gets a JSON object that holds additional information about the number of label validation
    * results for the current mission
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

  def save(label: LabelValidation): Int = db.withTransaction { implicit session =>
    val labelValidationId: Int =
      (validationLabels returning validationLabels.map(_.labelValidationId)) += label
    labelValidationId
  }

  /**
    * Select validation counts per user.
    *
    * @return list of tuples of (labeler_id, validator_role, validation_count, validation_agreed_count, validation_disagreed_count, validation_unsure_count)
    */
  def getValidationCountsPerUser: List[(String, String, Int, Int, Int, Int)] = db.withSession { implicit session =>
    val audits = for {
      _validation <- validationLabels
      _label <- labelsWithoutDeleted if _label.labelId === _validation.labelId
      _mission <- MissionTable.auditMissions if _label.missionId === _mission.missionId
      _user <- users if _user.username =!= "anonymous" && _user.userId === _mission.userId // User who placed the label
      _userRole <- userRoles if _user.userId === _userRole.userId
      _role <- roleTable if _userRole.roleId === _role.roleId
    } yield (_user.userId, _role.role, _validation.labelId, _validation.validationResult)

    // Counts the number of labels for each user by grouping by user_id and role.
    audits.groupBy(l => (l._1, l._2)).map {
      case ((uId, role), group) => {
        // Sum up the agreed results
        val agreed = group.map { r =>
          Case.If(r._4 === 1).Then(1).Else(0) // Only count it if the result was "agree"
        }.sum.getOrElse(0)

        // Sum up the disagreed results
        val disagreed = group.map { r =>
          Case.If(r._4 === 2).Then(1).Else(0) // Only count it if the result was "disagree"
        }.sum.getOrElse(0)

        // Sum up the unsure results
        val unsure = group.map { r =>
          Case.If(r._4 === 3).Then(1).Else(0) // Only count it if the result was "unsure"
        }.sum.getOrElse(0)

        // group.length is the total # of validations
        (uId, role, group.length, agreed, disagreed, unsure)
      }
    }.list
  }

  /**
    * Count number of labels the user has validated per user.
    *
    * @return list of tuples of (labeler_id, validation_count, validation_agreed_count)
    */
  def getValidatedCountsPerUser: List[(String, Int, Int)] = db.withSession { implicit session =>
    val audits = for {
      _validation <- validationLabels
      _label <- labelsWithoutDeleted if _label.labelId === _validation.labelId
      _mission <- MissionTable.auditMissions if _label.missionId === _mission.missionId
      _user <- users if _user.username =!= "anonymous" && _user.userId === _mission.userId // User who placed the label
      _validationUser <- users if _validationUser.username =!= "anonymous" && _validationUser.userId === _validation.userId // User who did the validation
      _userRole <- userRoles if _validationUser.userId === _userRole.userId
      _role <- roleTable if _userRole.roleId === _role.roleId
    } yield (_validationUser.userId, _validation.validationResult)

    // Counts the number of labels for each user by grouping by user_id and role.
    audits.groupBy(l => l._1).map {
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
  def countValidationsByLabelType(labelType: String): Int = db.withSession { implicit session =>
    val typeID = LabelTypeTable.labelTypeToId(labelType)

    validationLabels.innerJoin(labelsWithoutDeleted).on(_.labelId === _.labelId)
      .filter(_._2.labelTypeId === typeID)
      .size.run
  }

  /**
    * @return count of validations for the given validation result and label type
    */
  def countValidationsByResultAndLabelType(result: Int, labelType: String): Int = db.withSession { implicit session =>
    val typeID = LabelTypeTable.labelTypeToId(labelType)

    validationLabels.innerJoin(labelsWithoutDeleted).on(_.labelId === _.labelId)
      .filter(_._2.labelTypeId === typeID)
      .filter(_._1.validationResult === result)
      .size.run
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
  def countValidationsBasedOnResult(result: Int): Int = db.withTransaction(implicit session =>
    validationLabels.filter(_.validationResult === result).length.run
  )

  /**
    * @return total number of today's validations
    */
  def countTodayValidations: Int = db.withSession { implicit session =>
    val countQuery = Q.queryNA[(Int)](
      """SELECT v.label_id
        |FROM sidewalk.label_validation v
        |WHERE v.end_timestamp::date = now()::date""".stripMargin
    )
    countQuery.list.size
  }

  /**
    * @return total number of yesterday's validations
    */
  def countYesterdayValidations: Int = db.withSession { implicit session =>
    val countQuery = Q.queryNA[(Int)](
      """SELECT v.label_id
        |FROM sidewalk.label_validation v
        |WHERE v.end_timestamp::date = now()::date - interval '1' day""".stripMargin
    )
    countQuery.list.size
  }

  /**
    * @return total number of today's validations with a given result
    */
  def countTodayValidationsBasedOnResult(result: Int): Int = db.withSession { implicit session =>
    val countQuery = Q.queryNA[(Int)](
      s"""SELECT v.label_id
        |FROM sidewalk.label_validation v
        |WHERE v.end_timestamp::date = now()::date
        |   AND v.validation_result = $result""".stripMargin
    )
    countQuery.list.size
  }

  /**
    * @return total number of yesterday's validations with a given result
    */
  def countYesterdayValidationsBasedOnResult(result: Int): Int = db.withSession { implicit session =>
    val countQuery = Q.queryNA[(Int)](
      s"""SELECT v.label_id
         |FROM sidewalk.label_validation v
         |WHERE v.end_timestamp::date = now()::date - interval '1' day
         |   AND v.validation_result = $result""".stripMargin
    )
    countQuery.list.size
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
        |    WHERE label_validation IS NOT NULL
        |) AS calendar
        |GROUP BY calendar_date
        |ORDER BY calendar_date""".stripMargin
    )

    selectValidationCountQuery.list.map(x => ValidationCountPerDay.tupled(x))
  }
}
