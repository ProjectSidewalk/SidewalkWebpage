package models.attribute

/**
  * Created by misaugstad on 4/27/17.
  */

import models.audit.{AuditTaskEnvironmentTable, AuditTaskTable}
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.{LabelTable, ProblemTemporarinessTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.db.slick
import play.api.libs.json.{JsObject, Json}

import scala.slick.lifted.{ForeignKeyQuery, ProvenShape}
import scala.slick.jdbc.{StaticQuery => Q}
import scala.language.postfixOps

case class UserLabelToCluster(labelId: Int,
                              labelType: String,
                              lat: Option[Float],
                              lng: Option[Float],
                              severity: Option[Int],
                              temporary: Boolean) {
  /**
    * This method converts the data into the JSON format
    *
    * @return
    */
  def toJSON: JsObject = {
    Json.obj(
      "label_id" -> labelId,
      "label_type" -> labelType,
      "lat" -> lat,
      "lng" -> lng,
      "severity" -> severity,
      "temporary" -> temporary
    )
  }
}

case class UserClusteringSession(userClusteringSessionId: Int,
                                 isAnonymous: Boolean, userId: Option[String], ipAddress: Option[String],
                                 timeCreated: java.sql.Timestamp)


class UserClusteringSessionTable(tag: Tag) extends Table[UserClusteringSession](tag, Some("sidewalk"), "user_clustering_session") {
  def userClusteringSessionId: Column[Int] = column[Int]("user_clustering_session_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def isAnonymous: Column[Boolean] = column[Boolean]("is_anonymous", O.NotNull)
  def userId: Column[Option[String]] = column[Option[String]]("user_id")
  def ipAddress: Column[Option[String]] = column[Option[String]]("ip_address")
  def timeCreated: Column[java.sql.Timestamp] = column[java.sql.Timestamp]("time_created", O.NotNull)

  def * : ProvenShape[UserClusteringSession] = (userClusteringSessionId, isAnonymous, userId, ipAddress, timeCreated) <>
    ((UserClusteringSession.apply _).tupled, UserClusteringSession.unapply)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("user_clustering_session_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
}

/**
  * Data access object for the UserClusteringSessionTable table
  */
object UserClusteringSessionTable {
  val db: slick.Database = play.api.db.slick.DB
  val userClusteringSessions: TableQuery[UserClusteringSessionTable] = TableQuery[UserClusteringSessionTable]

  def getAllSessions: List[UserClusteringSession] = db.withTransaction { implicit session =>
    userClusteringSessions.list
  }

  /**
    * Returns labels that were placed by the specified user, in the form needed for clustering.
    *
    * @param userId
    * @return
    */
  def getRegisteredUserLabelsToCluster(userId: String): List[UserLabelToCluster] = db.withSession { implicit session =>

    val labels = for {
      _tasks <- AuditTaskTable.auditTasks if _tasks.userId === userId
      _labs <- LabelTable.labelsWithoutDeletedOrOnboarding if _labs.auditTaskId === _tasks.auditTaskId
      _latlngs <- LabelTable.labelPoints if _labs.labelId === _latlngs.labelId
      _types <- LabelTable.labelTypes if _labs.labelTypeId === _types.labelTypeId
    } yield (_labs.labelId, _types.labelType, _latlngs.lat, _latlngs.lng)

    // Left joins to get severity for any labels that have them
    val labelsWithSeverity = for {
      (_labs, _severity) <- labels.leftJoin(LabelTable.severities).on(_._1 === _.labelId)
    } yield (_labs._1, _labs._2, _labs._3, _labs._4, _severity.severity.?)

    // Left joins to get temporariness for any labels that have them (those that don't are marked as temporary=false)
    val labelsWithTemporariness = for {
      (_labs, _temporariness) <- labelsWithSeverity.leftJoin(ProblemTemporarinessTable.problemTemporarinesses).on(_._1 === _.labelId)
    } yield (_labs._1, _labs._2, _labs._3, _labs._4, _labs._5, _temporariness.temporaryProblem.?.getOrElse(false))

    labelsWithTemporariness.list.map(UserLabelToCluster.tupled)
  }

  /**
    * Returns labels that were placed by the specified user, in the form needed for clustering.
    *
    * @param ipAddress
    * @return
    */
  def getAnonymousUserLabelsToCluster(ipAddress: String): List[UserLabelToCluster] = db.withSession { implicit session =>

    val userAudits: Set[Int] =
      AuditTaskEnvironmentTable.auditTaskEnvironments
        .filter(_.ipAddress === ipAddress)
        .map(_.auditTaskId)
        .list.toSet

    val labels = for {
      _tasks <- AuditTaskTable.auditTasks if _tasks.auditTaskId inSet userAudits
      _labs <- LabelTable.labelsWithoutDeletedOrOnboarding if _labs.auditTaskId === _tasks.auditTaskId
      _latlngs <- LabelTable.labelPoints if _labs.labelId === _latlngs.labelId
      _types <- LabelTable.labelTypes if _labs.labelTypeId === _types.labelTypeId
    } yield (_labs.labelId, _types.labelType, _latlngs.lat, _latlngs.lng)

    // Left joins to get severity for any labels that have them
    val labelsWithSeverity = for {
      (_labs, _severity) <- labels.leftJoin(LabelTable.severities).on(_._1 === _.labelId)
    } yield (_labs._1, _labs._2, _labs._3, _labs._4, _severity.severity.?)

    // Left joins to get temporariness for any labels that have them (those that don't are marked as temporary=false)
    val labelsWithTemporariness = for {
      (_labs, _temporariness) <- labelsWithSeverity.leftJoin(ProblemTemporarinessTable.problemTemporarinesses).on(_._1 === _.labelId)
    } yield (_labs._1, _labs._2, _labs._3, _labs._4, _labs._5, _temporariness.temporaryProblem.?.getOrElse(false))

    labelsWithTemporariness.list.map(UserLabelToCluster.tupled)
  }

  /**
    * Truncates user_clustering_session, user_attribute, user_attribute_label, and global_attribute_user_attribute.
    */
  def truncateTable(): Unit = db.withTransaction { implicit session =>
    Q.updateNA("TRUNCATE TABLE user_clustering_session CASCADE").execute
  }

  def save(newSess: UserClusteringSession): Int = db.withTransaction { implicit session =>
    val newId: Int = (userClusteringSessions returning userClusteringSessions.map(_.userClusteringSessionId)) += newSess
    newId
  }
}
