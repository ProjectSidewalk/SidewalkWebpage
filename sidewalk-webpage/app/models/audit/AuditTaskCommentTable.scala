package models.audit

import java.sql.Timestamp

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class AuditTaskComment(auditTaskCommentId: Int, edgeId: Int, userId: String, ipAddress: String,
                            gsvPanoramaId: Option[String], heading: Option[Double], pitch: Option[Double],
                            zoom: Option[Int], timestamp: Timestamp, comment: String)

class AuditTaskCommentTable(tag: Tag) extends Table[AuditTaskComment](tag, Some("sidewalk"), "audit_task_comment") {
  def auditTaskCommentId = column[Int]("audit_task_comment_id", O.PrimaryKey, O.AutoInc)
  def edgeId = column[Int]("edge_id", O.NotNull)
  def userId = column[String]("user_id", O.NotNull)
  def ipAddress = column[String]("ip_address", O.NotNull)
  def gsvPanoramaId = column[Option[String]]("gsv_panorama_id", O.Nullable)
  def heading = column[Option[Double]]("heading", O.Nullable)
  def pitch = column[Option[Double]]("pitch", O.Nullable)
  def zoom = column[Option[Int]]("zoom", O.Nullable)
  def timestamp = column[Timestamp]("timestamp", O.NotNull)
  def comment = column[String]("comment", O.NotNull)

  def * = (auditTaskCommentId, edgeId, userId, ipAddress, gsvPanoramaId, heading, pitch, zoom, timestamp, comment) <>
    ((AuditTaskComment.apply _).tupled, AuditTaskComment.unapply)
}

object AuditTaskCommentTable {
  val db = play.api.db.slick.DB
  val auditTaskComments = TableQuery[AuditTaskCommentTable]

  def save(comment: AuditTaskComment): Int = db.withTransaction { implicit session =>
    val auditTaskCommentId: Int =
      (auditTaskComments returning auditTaskComments.map(_.auditTaskCommentId)) += comment
    auditTaskCommentId
  }
}
