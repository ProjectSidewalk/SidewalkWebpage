package models.label

import com.google.inject.ImplementedBy
import models.label.LabelValidationTable.validationOptions

import java.util.UUID
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import models.mission.{Mission, MissionTable}
import models.user.{RoleTable, RoleTableDef, SidewalkUserTableDef, UserRoleTable, UserRoleTableDef, UserStatTableDef}
import models.utils.MyPostgresDriver
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}

import java.sql.Timestamp
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

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
                           startTimestamp: Timestamp,
                           endTimestamp: Timestamp,
                           source: String)


/**
  * Stores data from each validation interaction.
  * https://www.programcreek.com/scala/slick.lifted.ForeignKeyQuery
  * @param tag
  */
class LabelValidationTableDef(tag: slick.lifted.Tag) extends Table[LabelValidation](tag, "label_validation") {
  def labelValidationId: Rep[Int] = column[Int]("label_validation_id", O.AutoInc)
  def labelId: Rep[Int] = column[Int]("label_id")
  def validationResult: Rep[Int] = column[Int]("validation_result") // 1 = Agree, 2 = Disagree, 3 = Unsure
  def oldSeverity: Rep[Option[Int]] = column[Option[Int]]("old_severity")
  def newSeverity: Rep[Option[Int]] = column[Option[Int]]("new_severity")
  def oldTags: Rep[List[String]] = column[List[String]]("old_tags")
  def newTags: Rep[List[String]] = column[List[String]]("new_tags")
  def userId: Rep[String] = column[String]("user_id")
  def missionId: Rep[Int] = column[Int]("mission_id")
  def canvasX: Rep[Option[Int]] = column[Option[Int]]("canvas_x")
  def canvasY: Rep[Option[Int]] = column[Option[Int]]("canvas_y")
  def heading: Rep[Float] = column[Float]("heading")
  def pitch: Rep[Float] = column[Float]("pitch")
  def zoom: Rep[Float] = column[Float]("zoom")
  def canvasHeight: Rep[Int] = column[Int]("canvas_height")
  def canvasWidth: Rep[Int] = column[Int]("canvas_width")
  def startTimestamp: Rep[Timestamp] = column[Timestamp]("start_timestamp")
  def endTimestamp: Rep[Timestamp] = column[Timestamp]("end_timestamp")
  def source: Rep[String] = column[String]("source")

  def * = (labelValidationId, labelId, validationResult, oldSeverity, newSeverity,
    oldTags, newTags, userId, missionId, canvasX, canvasY, heading, pitch, zoom, canvasHeight, canvasWidth,
    startTimestamp, endTimestamp, source) <>
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
trait LabelValidationTableRepository {
  def countValidationsFromUserAndLabel(userId: String, labelId: Int): DBIO[Int]
  def getValidation(labelId: Int, userId: String): DBIO[Option[LabelValidation]]
}

@Singleton
class LabelValidationTable @Inject()(
                                      protected val dbConfigProvider: DatabaseConfigProvider,
                                      implicit val ec: ExecutionContext
                                    ) extends LabelValidationTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val validationLabels = TableQuery[LabelValidationTableDef]
  val users = TableQuery[SidewalkUserTableDef]
  val userRoles = TableQuery[UserRoleTableDef]
  val roleTable = TableQuery[RoleTableDef]
  val labelsUnfiltered = TableQuery[LabelTableDef]
  val labelsWithoutDeleted = labelsUnfiltered.filter(_.deleted === false)

  /**
   * A function to count all validations by the given user for the given label.
   * There should only ever be a maximum of one.
   *
   * @param userId
   * @param labelId The ID of the label
   * @return An integer with the count
   */
  def countValidationsFromUserAndLabel(userId: String, labelId: Int): DBIO[Int] = {
    validationLabels.filter(v => v.userId === userId && v.labelId === labelId).length.result
  }

  /**
    * Gets additional information about the number of label validations for the current mission.
    *
    * @param missionId  Mission ID of the current mission
    * @return           DBIO[(agree_count, disagree_count, unsure_count)]
    */
  def getValidationProgress(missionId: Int): DBIO[(Int, Int, Int)] = {
    validationLabels.filter(_.missionId === missionId).groupBy(_.validationResult).map {
      case (result, group) => (result, group.length)
    }.result.map { results =>
      val agreeCount = results.find(_._1 == 1).map(_._2).getOrElse(0)
      val disagreeCount = results.find(_._1 == 2).map(_._2).getOrElse(0)
      val unsureCount = results.find(_._1 == 3).map(_._2).getOrElse(0)
      (agreeCount, disagreeCount, unsureCount)
    }

//    Json.obj(
//      "agree_count" -> agreeCount,
//      "disagree_count" -> disagreeCount,
//      "unsure_count" -> unsureCount
//    )
  }

//  case class ValidationCountPerDay(date: String, count: Int)

  /**
    * Get the user_ids of the users who placed the given labels.
    *
    * @param labelIds
    * @return
    */
  def usersValidated(labelIds: Seq[Int]): DBIO[Seq[String]] = {
    labelsUnfiltered.filter(_.labelId inSet labelIds).map(_.userId).groupBy(x => x).map(_._1).result
  }

  def getValidation(labelId: Int, userId: String): DBIO[Option[LabelValidation]] = {
    validationLabels.filter(x => x.labelId === labelId && x.userId === userId).result.headOption
  }

//  /**
//   * Calculates and returns the user accuracy for the supplied userId. The accuracy calculation is performed if and only
//   * if 10 of the user's labels have been validated. A label is considered validated if it has either more agree
//   * votes than disagree votes, or more disagree votes than agree votes.
//   */
//  def getUserAccuracy(userId: UUID): Option[Float] = {
//    val accuracyQuery = Q.query[String, Option[Float]](
//      """SELECT CASE WHEN validated_count > 9 THEN accuracy ELSE NULL END AS accuracy
//        |FROM (
//        |    SELECT CAST(SUM(CASE WHEN correct THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(SUM(CASE WHEN correct THEN 1 ELSE 0 END) + SUM(CASE WHEN NOT correct THEN 1 ELSE 0 END), 0) AS accuracy,
//        |           COUNT(CASE WHEN correct IS NOT NULL THEN 1 END) AS validated_count
//        |    FROM label
//        |    WHERE label.deleted = FALSE
//        |        AND label.tutorial = FALSE
//        |        AND label.user_id = ?
//        |) "accuracy_subquery";""".stripMargin
//    )
//    accuracyQuery(userId.toString).firstOption.flatten
//  }
//
//  /**
//    * Select validation counts per user.
//    *
//    * @return list of tuples (labeler_id, labeler_role, labels_validated, agreed_count)
//    */
//  def getValidationCountsPerUser: List[(String, String, Int, Int)] = {
//    val _labels = for {
//      _label <- LabelTable.labelsWithExcludedUsers
//      _user <- users if _user.username =!= "anonymous" && _user.userId === _label.userId // User who placed the label.
//      _userRole <- userRoles if _user.userId === _userRole.userId
//      _role <- roleTable if _userRole.roleId === _role.roleId
//      if _label.correct.isDefined // Filter for labels marked as either correct or incorrect.
//    } yield (_user.userId, _role.role, _label.correct)
//
//    // Count the number of correct labels and total number marked as either correct or incorrect for each user.
//    _labels.groupBy(l => (l._1, l._2)).map { case ((userId, role), group) => (
//      userId,
//      role,
//      group.length, // # Correct or incorrect.
//      group.map(l => Case.If(l._3.getOrElse(false) === true).Then(1).Else(0)).sum.getOrElse(0) // # Correct labels.
//    )}.list
//  }
//
//  /**
//    * Count number of validations supplied per user.
//    *
//    * @return list of tuples of (labeler_id, validation_count, validation_agreed_count, validation_disagreed_count)
//    */
//  def getValidatedCountsPerUser: List[(String, Int, Int)] = {
//    val validations = for {
//      _validation <- validationLabels
//      _validationUser <- users if _validationUser.userId === _validation.userId
//      _userRole <- userRoles if _validationUser.userId === _userRole.userId
//      if _validationUser.username =!= "anonymous"
//      if _validation.labelValidationId =!= 3 // Exclude "unsure" validations.
//    } yield (_validationUser.userId, _validation.validationResult)
//
//    // Counts the number of labels for each user by grouping by user_id and role.
//    validations.groupBy(l => l._1).map {
//      case (uId, group) => {
//        // Sum up the agreed validations and total validations (just agreed + disagreed).
//        val agreed = group.map { r => Case.If(r._2 === 1).Then(1).Else(0) }.sum.getOrElse(0)
//        (uId, group.length, agreed)
//      }
//    }.list
//  }
//
//  /**
//    * @return count of validations for the given label type
//    */
//  def countValidations(labelType: String): Int = {
//    val typeID = LabelTypeTable.labelTypeToId(labelType)
//
//    validationLabels.innerJoin(labelsWithoutDeleted).on(_.labelId === _.labelId)
//      .filter(_._2.labelTypeId === typeID)
//      .size.run
//  }
//
//  /**
//    * @return count of validations for the given validation result and label type
//    */
//  def countValidationsByResult(result: Int, labelType: String): Int = {
//    val typeID = LabelTypeTable.labelTypeToId(labelType)
//
//    validationLabels.innerJoin(labelsWithoutDeleted).on(_.labelId === _.labelId)
//      .filter(_._2.labelTypeId === typeID)
//      .filter(_._1.validationResult === result)
//      .size.run
//  }

  /**
   * @returns The number of validations performed by this user.
   */
  def countValidations(userId: String): DBIO[Int] = validationLabels.filter(_.userId === userId).length.result

  /**
    * @return The total number of validations.
    */
  def countValidations: DBIO[Int] = validationLabels.length.result

//  /**
//    * @return total number of validations with a given result
//    */
//  def countValidationsByResult(result: Int): Int = db.withSession(implicit session =>
//    validationLabels.filter(_.validationResult === result).size.run
//  )
//
//  /**
//    * @return total number of today's validations
//    */
//  def countTodayValidations: Int = {
//    val countQuery = Q.queryNA[Int](
//      """SELECT COUNT(v.label_id)
//        |FROM label_validation v
//        |WHERE (v.end_timestamp AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date""".stripMargin
//    )
//    countQuery.first
//  }
//
//  /**
//    * @return total number of the past week's validations
//    */
//  def countPastWeekValidations: Int = {
//    val countQuery = Q.queryNA[Int](
//      """SELECT COUNT(v.label_id)
//        |FROM label_validation v
//        |WHERE (v.end_timestamp AT TIME ZONE 'US/Pacific') > (NOW() AT TIME ZONE 'US/Pacific') - interval '168 hours'""".stripMargin
//    )
//    countQuery.first
//  }
//
//  /**
//    * @return total number of today's validations with a given result
//    */
//  def countTodayValidationsByResult(result: Int): Int = {
//    val countQuery = Q.queryNA[Int](
//      s"""SELECT COUNT(v.label_id)
//        |FROM label_validation v
//        |WHERE (v.end_timestamp AT TIME ZONE 'US/Pacific')::date = (NOW() AT TIME ZONE 'US/Pacific')::date
//        |   AND v.validation_result = $result""".stripMargin
//    )
//    countQuery.first
//  }
//
//  /**
//    * @return total number of the past week's validations with a given result
//    */
//  def countPastWeekValidationsByResult(result: Int): Int = {
//    val countQuery = Q.queryNA[Int](
//      s"""SELECT COUNT(v.label_id)
//         |FROM label_validation v
//         |WHERE (v.end_timestamp AT TIME ZONE 'US/Pacific') > (NOW() AT TIME ZONE 'US/Pacific') - interval '168 hours'
//         |   AND v.validation_result = $result""".stripMargin
//    )
//    countQuery.first
//  }
//
//  /**
//    * @return number of validations per date
//    */
//  def getValidationsByDate: List[ValidationCountPerDay] = {
//    val selectValidationCountQuery = Q.queryNA[(String, Int)](
//      """SELECT calendar_date, COUNT(label_validation_id)
//        |FROM
//        |(
//        |    SELECT label_validation_id, end_timestamp::date AS calendar_date
//        |    FROM label_validation
//        |) AS calendar
//        |GROUP BY calendar_date
//        |ORDER BY calendar_date""".stripMargin
//    )
//
//    selectValidationCountQuery.list.map(x => ValidationCountPerDay.tupled(x))
//  }
}
