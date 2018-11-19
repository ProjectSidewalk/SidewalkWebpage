package models.sidewalk

/**
 * References:
 * Slick-pg https://github.com/tminglei/slick-pg
 *
 * To use models when using REPL, type:
 * scala> new play.core.StaticApplication(new java.io.File("."))
 * https://yobriefca.se/blog/2014/07/11/working-with-play-apps-in-the-console/
   */

//import slick.driver.PostgresDriver.simple._

import java.sql.Timestamp

import com.vividsolutions.jts.geom.LineString
import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

import scala.concurrent.ExecutionContext.Implicits.global

case class SidewalkEdge(sidewalkEdgeId: Option[Int], geom: LineString, source: Int, target: Int,
                        x1: Float, y1: Float, x2: Float, y2: Float, wayType: String, deleted: Boolean, timestamp: Option[Timestamp])


/**
 *
 */
class SidewalkEdgeTable(tag: Tag) extends Table[SidewalkEdge](tag, Some("sidewalk"), "sidewalk_edge") {
  def sidewalkEdgeId = column[Option[Int]]("sidewalk_edge_id", O.PrimaryKey, O.Default(Some(0)))
  def geom = column[LineString]("geom")
  def source = column[Int]("source")
  def target = column[Int]("target")
  def x1 = column[Float]("x1")
  def y1 = column[Float]("y1")
  def x2 = column[Float]("x2")
  def y2 = column[Float]("y2")
  def wayType = column[String]("way_type")
  def deleted = column[Boolean]("deleted", O.Default(false))
  def timestamp = column[Option[Timestamp]]("timestamp")

  def * = (sidewalkEdgeId, geom, source, target, x1, y1, x2, y2, wayType, deleted, timestamp) <> ((SidewalkEdge.apply _).tupled, SidewalkEdge.unapply)
}


/**
 * Data access object for the sidewalk_edge table
 */
object SidewalkEdgeTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val sidewalkEdges = TableQuery[SidewalkEdgeTable]

  /**
   * Returns a list of all the sidewalk edges
   * @return A list of SidewalkEdge objects.
   */
  def all: Future[Seq[SidewalkEdge]] = {
    db.run(sidewalkEdges.filter(edge => edge.deleted === false).result)
  }

  /**
   * Set a record's deleted column to true
   */
  def delete(id: Int): Future[Int] = {
    db.run(sidewalkEdges.filter(edge => edge.sidewalkEdgeId === id).map(_.deleted).update(true))
  }

  /**
   * Save a SidewalkEdge into the sidewalk_edge table
   * @param newEdge A SidewalkEdge object
   * @return
   */
  def save(newEdge: SidewalkEdge): Future[Int] = db.run(
    ((sidewalkEdges returning sidewalkEdges.map(_.sidewalkEdgeId)) += newEdge).transactionally
  ).map(_.get)
}
