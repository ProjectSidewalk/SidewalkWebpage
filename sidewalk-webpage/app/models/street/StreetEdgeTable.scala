package models.street

import java.sql.Timestamp

import com.vividsolutions.jts.geom.LineString
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current


case class StreetEdge(streetEdgeId: Int, geom: LineString, source: Int, target: Int, x1: Float, y1: Float,
                      x2: Float, y2: Float, wayType: String, deleted: Boolean, timestamp: Option[Timestamp])

/**
 *
 */
class StreetEdgeTable(tag: Tag) extends Table[StreetEdge](tag, Some("sidewalk"), "street_edge") {
  def streetEdgeId = column[Int]("street_edge_id", O.PrimaryKey)
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

  def * = (streetEdgeId, geom, source, target, x1, y1, x2, y2, wayType, deleted, timestamp) <> ((StreetEdge.apply _).tupled, StreetEdge.unapply)
}


/**
 * Data access object for the street_edge table
 */
object StreetEdgeTable {
  val db = play.api.db.slick.DB
  val streetEdges = TableQuery[StreetEdgeTable]

  /**
   * Returns a list of all the street edges
   * @return A list of StreetEdge objects.
   */
  def all: List[StreetEdge] = db.withSession { implicit session =>
    streetEdges.filter(edge => edge.deleted === false).list
  }

  /**
   * Set a record's deleted column to true
   */
  def delete(id: Int) = db.withSession { implicit session =>
    // streetEdges.filter(_.streetEdgeId == id)
    streetEdges.filter(edge => edge.streetEdgeId === id).map(_.deleted).update(true)
  }

  /**
   * Save a StreetEdge into the street_edge table
   * @param edge A StreetEdge object
   * @return
   */
  def save(edge: StreetEdge): Int = db.withTransaction { implicit session =>
    streetEdges += edge
    edge.streetEdgeId // return the edge id.
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

