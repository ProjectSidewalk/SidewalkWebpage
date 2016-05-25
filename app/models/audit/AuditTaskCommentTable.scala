package models.audit

import java.sql.Timestamp

import models.daos.slick.DBTableDefinitions.UserTable
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class AuditTaskComment(auditTaskCommentId: Int, edgeId: Int, userId: String, ipAddress: String,
                            gsvPanoramaId: Option[String], heading: Option[Double], pitch: Option[Double],
                            zoom: Option[Int], lat: Option[Double], lng: Option[Double], timestamp: Timestamp, comment: String)

class AuditTaskCommentTable(tag: Tag) extends Table[AuditTaskComment](tag, Some("sidewalk"), "audit_task_comment") {
  def auditTaskCommentId = column[Int]("audit_task_comment_id", O.PrimaryKey, O.AutoInc)
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

  def * = (auditTaskCommentId, edgeId, userId, ipAddress, gsvPanoramaId, heading, pitch, zoom, lat, lng, timestamp, comment) <>
    ((AuditTaskComment.apply _).tupled, AuditTaskComment.unapply)
}

object AuditTaskCommentTable {
  val db = play.api.db.slick.DB
  val auditTaskComments = TableQuery[AuditTaskCommentTable]
  val users = TableQuery[UserTable]

  /**
    * Get all task records of the given user
    * @param username Username
    * @return
    */
  def all(username: String): Option[List[AuditTaskComment]] = db.withTransaction { implicit session =>
    val comments = (for {
      (c, u) <- auditTaskComments.innerJoin(users).on(_.userId === _.userId).sortBy(_._1.timestamp.desc) if u.username === username
    } yield (c.auditTaskCommentId, c.edgeId, u.username, c.ipAddress, c.gsvPanoramaId,
      c.heading, c.pitch, c.zoom, c.lat, c.lng, c.timestamp, c.comment)).list.map { c => AuditTaskComment.tupled(c) }

    Some(comments)
  }

  /**
    * Insert a task record
    * @param comment AuditTaskComment object
    * @return
    */
  def save(comment: AuditTaskComment): Int = db.withTransaction { implicit session =>
    val auditTaskCommentId: Int =
      (auditTaskComments returning auditTaskComments.map(_.auditTaskCommentId)) += comment
    auditTaskCommentId
  }

  /**
    * Take the last n items
    * @param n
    * @return
    */
  def takeRight(n: Integer): List[AuditTaskComment] = db.withTransaction { implicit session =>
    val comments = (for {
      (c, u) <- auditTaskComments.innerJoin(users).on(_.userId === _.userId).sortBy(_._1.timestamp.desc)
    } yield (c.auditTaskCommentId, c.edgeId, u.username, c.ipAddress, c.gsvPanoramaId,
      c.heading, c.pitch, c.zoom, c.lat, c.lng, c.timestamp, c.comment)).list.map { c => AuditTaskComment.tupled(c) }

    comments.take(n)
  }
}
