package models


import models.utils.MyPostgresDriver.simple._
import com.vividsolutions.jts.geom.LineString
import play.api.Play.current
import java.sql.Timestamp


case class StreetEdge(streetEdgeId: Option[Int],
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

case class StreetEdgeParentEdge(streetEdgeId: Int, parentEdgeId: Int)

/**
 *
 */
class StreetEdgeTable(tag: Tag) extends Table[StreetEdge](tag, "street_edge") {
  def streetEdgeId = column[Option[Int]]("street_edge_id", O.PrimaryKey, O.Default(Some(0)))
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

case class StreetEdgeParentEdgeTable(tag: Tag) extends Table[StreetEdgeParentEdge](tag, "street_edge_parent_edge") {
  def streetEdgeId = column[Int]("street_edge_id", O.PrimaryKey, O.Default(0))
  def parentEdgeId = column[Int]("parent_edge_id")

  def * = (streetEdgeId, parentEdgeId) <> ((StreetEdgeParentEdge.apply _).tupled, StreetEdgeParentEdge.unapply)
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
    edge.streetEdgeId.get // return the edge id.
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
object StreetEdgeParentEdgeTable {
  val db = play.api.db.slick.DB
  val streetEdgeParentEdgeTable = TableQuery[StreetEdgeParentEdgeTable]

  /**
   * Get records based on the child id.
   * @param id
   * @return
   */
  def selectByChildId(id: Int): List[StreetEdgeParentEdge] = db.withSession { implicit session =>
    streetEdgeParentEdgeTable.filter(item => item.streetEdgeId === id).list
  }

  /**
   * Get records based on the parent id.
   * @param id
   * @return
   */
  def selectByParentId(id: Int): List[StreetEdgeParentEdge] = db.withSession { implicit session =>
    streetEdgeParentEdgeTable.filter(item => item.parentEdgeId === id).list
  }

  /**
   * Save a record.
   * @param childId
   * @param parentId
   * @return
   */
  def save(childId: Int, parentId: Int) = db.withSession { implicit session =>
    streetEdgeParentEdgeTable += new StreetEdgeParentEdge(childId, parentId)
  }
}