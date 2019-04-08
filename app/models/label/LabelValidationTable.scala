package models.label

import java.sql.Timestamp
import java.util.{Calendar, UUID}

import models.utils.MyPostgresDriver.simple._
import models.audit.AuditTaskTable
import models.daos.slick.DBTableDefinitions.UserTable
import models.label.LabelTable.{auditTasks, db, labelsWithoutDeleted, roleTable, userRoles, users}
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
                           canvasX: Int,
                           canvasY: Int,
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
  def canvasX = column[Int]("canvas_x", O.NotNull)
  def canvasY = column[Int]("canvas_y", O.NotNull)
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
}

/**
  * Data access table for label validation table
  */
object LabelValidationTable {
  val db = play.api.db.slick.DB
  val labelValidationTable = TableQuery[LabelValidationTable]
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
    validationLabels.filter(_.missionId === missionId).filter(_.validationResult === result).list.size
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

  def getOwnValidationCounts: Map[String, Int] = db.withSession { implicit session =>
    LabelValidationTable.labelValidationTable
      .innerJoin(LabelTable.labels).on(_.labelId === _.labelId)
      .innerJoin(AuditTaskTable.auditTasks).on(_._2.auditTaskId === _.auditTaskId)
      .groupBy(_._2.userId).map { case (_userId, group) => (_userId, group.length) }.list.toMap // _2.userId is the userId from "audit_task"
  }

  def getOwnValidationAgreedCounts: Map[String, Int] = db.withSession { implicit session =>
    LabelValidationTable.labelValidationTable.filter(_.validationResult === 1)
      .innerJoin(LabelTable.labels).on(_.labelId === _.labelId)
      .innerJoin(AuditTaskTable.auditTasks).on(_._2.auditTaskId === _.auditTaskId)
      .groupBy(_._2.userId).map { case (_userId, group) => (_userId, group.length) }.list.toMap
  }

  /**
    * Select label counts per user.
    *
    * @return list of tuples of (user_id, role, validation_count, validation_agreed)
    */
  def getValidationCountsPerUser: List[(String, String, Int, Int)] = db.withSession { implicit session =>
    val audits = for {
      _validation <- labelValidationTable
      _label <- labelsWithoutDeleted if _label.labelId === _validation.labelId
      _audit <- auditTasks if _label.auditTaskId === _audit.auditTaskId
      _user <- users if _user.username =!= "anonymous" && _user.userId === _validation.userId
      _userRole <- userRoles if _user.userId === _userRole.userId
      _role <- roleTable if _userRole.roleId === _role.roleId
    } yield (_user.userId, _role.role, _validation.labelId, _validation.validationResult)

    // Counts the number of labels for each user by grouping by user_id and role.
    audits.groupBy(l => (l._1, l._2, l._4)).map{ case ((uId, role, result), group) => (uId, role, result, group.length) }.list
  }

  def getValidationsByDate: List[ValidationCountPerDay] = db.withSession { implicit session =>
    val selectValidationCountQuery = Q.queryNA[(String, Int)](
      """SELECT calendar_date::date, COUNT(label_id)
        |FROM
        |(
        |    SELECT current_date - (n || ' day')::INTERVAL AS calendar_date
        |    FROM generate_series(0, current_date - '12/17/2018') n
        |) AS calendar
        |LEFT JOIN sidewalk.label_validation ON label_validation.end_timestamp::date = calendar_date::date
        |GROUP BY calendar_date
        |ORDER BY calendar_date""".stripMargin
    )

    selectValidationCountQuery.list.map(x => ValidationCountPerDay.tupled(x))

    /*labelValidationTable.groupBy(x => {
      var c : Calendar = Calendar.getInstance()
      c.setTimeInMillis(x.endTimestamp.getTime)
      c.set(Calendar.HOUR_OF_DAY, 0)
      c.set(Calendar.MINUTE, 0)
      c.set(Calendar.SECOND, 0)
      c.set(Calendar.MILLISECOND, 0)
      c
    }).map { case (_date, group) => (_date, group.length) }.list*/
  }
}
