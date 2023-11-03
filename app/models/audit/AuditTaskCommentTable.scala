package models.audit

import java.sql.Timestamp
import models.daos.slick.DBTableDefinitions.UserTable
import models.mission.{Mission, MissionTable}
import models.utils.MyPostgresDriver.simple._
import models.utils.CommonUtils.ordered
import models.validation.ValidationTaskCommentTable
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class AuditTaskComment(auditTaskCommentId: Int, auditTaskId: Int, missionId: Int, edgeId: Int, username: String,
                            ipAddress: String, gsvPanoramaId: Option[String], heading: Option[Double],
                            pitch: Option[Double], zoom: Option[Int], lat: Option[Double], lng: Option[Double],
                            timestamp: Timestamp, comment: String)
case class GenericComment(commentType: String, username: String, gsvPanoramaId: Option[String], timestamp: Timestamp, comment: String, heading: Option[Double], pitch: Option[Double], zoom: Option[Int], labelId: Option[Int])

class AuditTaskCommentTable(tag: Tag) extends Table[AuditTaskComment](tag, "audit_task_comment") {
  def auditTaskCommentId = column[Int]("audit_task_comment_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId = column[Int]("audit_task_id", O.NotNull)
  def missionId = column[Int]("mission_id", O.NotNull)
  def edgeId = column[Int]("edge_id", O.NotNull)
  def userId = column[String]("user_id", O.NotNull)
  def ipAddress = column[String]("ip_address", O.NotNull)
  def gsvPanoramaId = column[Option[String]]("gsv_panorama_id", O.Nullable)
  def heading = column[Option[Double]]("heading", O.Nullable)
  def pitch = column[Option[Double]]("pitch", O.Nullable)
  def zoom = column[Option[Int]]("zoom", O.Nullable)
  def lat = column[Option[Double]]("lat", O.Nullable)
  def lng = column[Option[Double]]("lng", O.Nullable)
  def timestamp = column[Timestamp]("timestamp", O.NotNull)
  def comment = column[String]("comment", O.NotNull)

  def * = (auditTaskCommentId, auditTaskId, missionId, edgeId, userId, ipAddress, gsvPanoramaId, heading, pitch, zoom, lat, lng, timestamp, comment) <>
    ((AuditTaskComment.apply _).tupled, AuditTaskComment.unapply)

  def auditTask: ForeignKeyQuery[AuditTaskTable, AuditTask] =
    foreignKey("audit_task_comment_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTable])(_.auditTaskId)

  def mission: ForeignKeyQuery[MissionTable, Mission] =
    foreignKey("audit_task_comment_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)
}

object AuditTaskCommentTable {
  val db = play.api.db.slick.DB
  val auditTaskComments = TableQuery[AuditTaskCommentTable]
  val users = TableQuery[UserTable]

  /**
    * Get all task records of the given user.
    */
  def all(username: String): Option[List[AuditTaskComment]] = db.withTransaction { implicit session =>
    val comments = (for {
      (c, u) <- auditTaskComments.innerJoin(users).on(_.userId === _.userId).sortBy(_._1.timestamp.desc) if u.username === username
    } yield (c.auditTaskCommentId, c.auditTaskId, c.missionId, c.edgeId, u.username, c.ipAddress, c.gsvPanoramaId,
      c.heading, c.pitch, c.zoom, c.lat, c.lng, c.timestamp, c.comment)).list.map { c => AuditTaskComment.tupled(c) }

    Some(comments)
  }

  /**
    * Insert an audit_task_comment record.
    */
  def save(comment: AuditTaskComment): Int = db.withTransaction { implicit session =>
    val auditTaskCommentId: Int =
      (auditTaskComments returning auditTaskComments.map(_.auditTaskCommentId)) += comment
    auditTaskCommentId
  }

  /**
    * Take last n comments from either audit or validation comment tables.
    */
  def takeRightAuditAndValidationComments(n: Integer): List[GenericComment] = db.withSession { implicit session =>
    val auditComments = (for {
      (c, u) <- auditTaskComments.innerJoin(users).on(_.userId === _.userId).sortBy(_._1.timestamp.desc)
    } yield ("audit", u.username, c.gsvPanoramaId, c.timestamp, c.comment, c.heading, c.pitch, c.zoom, (None: Option[Int]))).take(n).list.map(GenericComment.tupled(_))

    val validationComments = (for {
      (c, u) <- ValidationTaskCommentTable.validationTaskComments.innerJoin(users).on(_.userId === _.userId).sortBy(_._1.timestamp.desc)
    } yield ("validation", u.username, c.gsvPanoramaId, c.timestamp, c.comment, c.heading, c.pitch, c.zoom, c.labelId)).take(n).list.map(c => GenericComment(c._1, c._2, Some(c._3), c._4, c._5, Some(c._6), Some(c._7), Some(c._8), Some(c._9)))

    (auditComments ++ validationComments).sortBy(_.timestamp).reverse.take(n)
  }
}
