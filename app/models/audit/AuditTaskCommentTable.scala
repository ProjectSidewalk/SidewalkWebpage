package models.audit

import java.sql.Timestamp

import models.daos.slickdaos.DBTableDefinitions.UserTable
import models.mission.MissionTable
import models.utils.MyPostgresDriver.api._

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

import scala.concurrent.ExecutionContext.Implicits.global

case class AuditTaskComment(auditTaskCommentId: Int, auditTaskId: Int, missionId: Int, edgeId: Int, userId: String,
  ipAddress: String, gsvPanoramaId: Option[String], heading: Option[Double],
  pitch: Option[Double], zoom: Option[Int], lat: Option[Double], lng: Option[Double],
  timestamp: Timestamp, comment: String)

class AuditTaskCommentTable(tag: Tag) extends Table[AuditTaskComment](tag, Some("sidewalk"), "audit_task_comment") {
  def auditTaskCommentId = column[Int]("audit_task_comment_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId = column[Int]("audit_task_id")
  def missionId = column[Int]("mission_id")
  def edgeId = column[Int]("edge_id")
  def userId = column[String]("user_id")
  def ipAddress = column[String]("ip_address")
  def gsvPanoramaId = column[Option[String]]("gsv_panorama_id")
  def heading = column[Option[Double]]("heading")
  def pitch = column[Option[Double]]("pitch")
  def zoom = column[Option[Int]]("zoom")
  def lat = column[Option[Double]]("lat")
  def lng = column[Option[Double]]("lng")
  def timestamp = column[Timestamp]("timestamp")
  def comment = column[String]("comment")

  def * = (auditTaskCommentId, auditTaskId, missionId, edgeId, userId, ipAddress, gsvPanoramaId, heading, pitch, zoom, lat, lng, timestamp, comment) <>
    ((AuditTaskComment.apply _).tupled, AuditTaskComment.unapply)

  def auditTask = foreignKey("audit_task_comment_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTable])(_.auditTaskId)

  def mission = foreignKey("audit_task_comment_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)
}

object AuditTaskCommentTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val auditTaskComments = TableQuery[AuditTaskCommentTable]
  val users = TableQuery[UserTable]

  /**
   * Get all task records of the given user
   * @param username Username
   * @return
   */
  def all(username: String): Future[Seq[AuditTaskComment]] = {
    val commentsQuery = for {
      (c, u) <- auditTaskComments.join(users).on(_.userId === _.userId).sortBy(_._1.timestamp.desc) if u.username === username
    } yield (c.auditTaskCommentId, c.auditTaskId, c.missionId, c.edgeId, u.username, c.ipAddress, c.gsvPanoramaId,
      c.heading, c.pitch, c.zoom, c.lat, c.lng, c.timestamp, c.comment)

    db.run(commentsQuery.result).map(commentList => commentList.map(AuditTaskComment.tupled))
  }

  /**
   * Insert an audit_task_comment record.
   *
   * @param comment AuditTaskComment object
   * @return
   */
  def save(comment: AuditTaskComment): Future[Int] = db.run {
    (auditTaskComments returning auditTaskComments.map(_.auditTaskCommentId)) += comment
  }

  /**
   * Take the last n comments.
   *
   * @param n
   * @return
   */
  def takeRight(n: Integer): Future[Seq[AuditTaskComment]] = {
    val comments = (for {
      (c, u) <- auditTaskComments.join(users).on(_.userId === _.userId).sortBy(_._1.timestamp.desc)
    } yield (c.auditTaskCommentId, c.auditTaskId, c.missionId, c.edgeId, u.username, c.ipAddress, c.gsvPanoramaId,
      c.heading, c.pitch, c.zoom, c.lat, c.lng, c.timestamp, c.comment)).take(n)

    db.run({
      comments.result
    }).map(_.map(AuditTaskComment.tupled))
  }
}
