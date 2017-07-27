package models.gt_session

/**
  * Created by hmaddali on 7/26/17.
  */
import models.route.{Route, RouteTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class GTSession(gtSessionId: Int, routeId: Int, clustering_threshold: Double, time_created: java.sql.Timestamp,
                     deleted: Boolean)
/**
  *
  */
class GTSessionTable(tag: Tag) extends Table[GTSession](tag, Some("sidewalk"), "gt_session") {
  def gtSessionId = column[Int]("gt_session_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def routeId = column[Int]("route_id", O.NotNull)
  def clustering_threshold = column[Double]("clustering_threshold", O.NotNull)
  def deleted = column[Boolean]("deleted", O.NotNull)
  def time_created = column[java.sql.Timestamp]("time_created",O.NotNull)
  def * = (gtSessionId, routeId, clustering_threshold, time_created, deleted) <> ((GTSession.apply _).tupled, GTSession.unapply)

  def route: ForeignKeyQuery[RouteTable, Route] =
    foreignKey("gt_session_route_id_fkey", routeId, TableQuery[RouteTable])(_.routeId)

}

/**
  * Data access object for the Route table
  */
object GTSessionTable{
  val db = play.api.db.slick.DB
  val gt_sessions = TableQuery[GTSessionTable]

  def getGTSession(gtSessionId: Option[Int]): Option[GTSession] = db.withSession { implicit session =>
    val gt_session = gt_sessions.filter(_.gtSessionId === gtSessionId).list
    gt_session.headOption
  }

  def all: List[GTSession] = db.withSession { implicit session =>
    gt_sessions.list
  }

  def selectExistingSessions: List[GTSession] = db.withSession { implicit session =>
    gt_sessions.filter(_.deleted === false).list
  }

  def save(gt_session: GTSession): Int = db.withTransaction { implicit session =>
    val sId: Int =
      (gt_sessions returning gt_sessions.map(_.gtSessionId)) += gt_session
    sId
  }

  def updateDeleted(gt_session_id: Int, deleted: Boolean)= db.withTransaction { implicit session =>
    val q = for { gt_session <- gt_sessions if gt_session.gtSessionId === gt_session_id } yield gt_session.deleted
    q.update(deleted)
  }

}