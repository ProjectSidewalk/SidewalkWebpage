package models

/**
 * References:
 * Slick-pg https://github.com/tminglei/slick-pg
 *
 * To use models when using REPL, type:
 * scala> new play.core.StaticApplication(new java.io.File("."))
 * https://yobriefca.se/blog/2014/07/11/working-with-play-apps-in-the-console/
   */

//import scala.slick.driver.PostgresDriver.simple._

import models.utils.MyPostgresDriver.simple._
import com.vividsolutions.jts.geom.LineString
import play.api.Play.current
import java.sql.Timestamp


case class SidewalkEdge(sidewalkEdgeId: Option[Int],
                        geom: LineString,
                        source: Int,
                        target: Int,
                        x1: Float,
                        y1: Float,
                        x2: Float,
                        y2: Float,
                        wayType: String,
                        deleted: Boolean,
                        timestamp: Option[Timestamp])

case class SidewalkEdgeParentEdge(sidewalkEdgeId: Int, parentEdgeId: Int)

/**
 *
 */
class SidewalkEdgeTable(tag: Tag) extends Table[SidewalkEdge](tag, "sidewalk_edge") {
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

case class SidewalkEdgeParentEdgeTable(tag: Tag) extends Table[SidewalkEdgeParentEdge](tag, "sidewalk_edge_parent_edge") {
  def sidewalkEdgeId = column[Int]("sidewalk_edge_id", O.PrimaryKey, O.Default(0))
  def parentEdgeId = column[Int]("parent_edge_id")

  def * = (sidewalkEdgeId, parentEdgeId) <> ((SidewalkEdgeParentEdge.apply _).tupled, SidewalkEdgeParentEdge.unapply)
}



/**
 * Data access object for the sidewalk_edge table
 */
object SidewalkEdgeTable {
  val db = play.api.db.slick.DB
  val sidewalkEdges = TableQuery[SidewalkEdgeTable]

  /**
   * Returns a list of all the sidewalk edges
   * @return A list of SidewalkEdge objects.
   */
  def all: List[SidewalkEdge] = db.withSession { implicit session =>
    sidewalkEdges.filter(edge => edge.deleted === false).list
  }

  /**
   * Set a record's deleted column to true
   */
  def delete(id: Int) = db.withSession { implicit session =>
    // sidewalkEdges.filter(_.sidewalkEdgeId == id)
    sidewalkEdges.filter(edge => edge.sidewalkEdgeId === id).map(_.deleted).update(true)
  }

  /**
   * Save a SidewalkEdge into the sidewalk_edge table
   * @param edge A SidewalkEdge object
   * @return
   */
  def save(edge: SidewalkEdge): Int = db.withTransaction { implicit session =>
    sidewalkEdges += edge
    edge.sidewalkEdgeId.get // return the edge id.
  }

  /**
   * http://stackoverflow.com/questions/19891881/scala-slick-plain-sql-retrieve-result-as-a-map
   * http://stackoverflow.com/questions/25578793/how-to-return-a-listuser-when-using-sql-with-slick
   * https://websketchbook.wordpress.com/2015/03/23/make-plain-sql-queries-work-with-slick-play-framework/
   *
   * @param id
   * @return
   */
  def randomQuery(id: Int) = db.withSession { implicit session =>
//    import scala.slick.jdbc.meta._
//    import scala.slick.jdbc.{StaticQuery => Q}
//    import Q.interpolation
//
//    val columns = MTable.getTables(None, None, None, None).list.filter(_.name.name == "USER")
//    val user = sql"""SELECT * FROM "user" WHERE "id" = $id""".as[List[String]].firstOption.map(columns zip _ toMap)
//    user
  }
}

/**
 *
 */
object SidewalkEdgeParentEdgeTable {
  val db = play.api.db.slick.DB
  val sidewalkEdgeParentEdgeTable = TableQuery[SidewalkEdgeParentEdgeTable]

  /**
   * Get records based on the child id.
   * @param id
   * @return
   */
  def selectByChildId(id: Int): List[SidewalkEdgeParentEdge] = db.withSession { implicit session =>
    sidewalkEdgeParentEdgeTable.filter(item => item.sidewalkEdgeId === id).list
  }

  /**
   * Get records based on the parent id.
   * @param id
   * @return
   */
  def selectByParentId(id: Int): List[SidewalkEdgeParentEdge] = db.withSession { implicit session =>
    sidewalkEdgeParentEdgeTable.filter(item => item.parentEdgeId === id).list
  }

  /**
   * Save a record.
   * @param childId
   * @param parentId
   * @return
   */
  def save(childId: Int, parentId: Int) = db.withSession { implicit session =>
    sidewalkEdgeParentEdgeTable += new SidewalkEdgeParentEdge(childId, parentId)
  }
}