package models.region

import java.util.UUID

import com.vividsolutions.jts.geom.Polygon
import models.user.UserCurrentRegionTable
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.jdbc.{StaticQuery => Q, GetResult}
import scala.slick.lifted.ForeignKeyQuery

case class Region(regionId: Int, regionTypeId: Int, dataSource: String, description: String, geom: Polygon)

class RegionTable(tag: Tag) extends Table[Region](tag, Some("sidewalk"), "region") {
  def regionId = column[Int]("region_id", O.PrimaryKey, O.AutoInc)
  def regionTypeId = column[Int]("region_type_id", O.NotNull)
  def dataSource = column[String]("data_source", O.Nullable)
  def description = column[String]("description", O.Nullable)
  def geom = column[Polygon]("geom")

  def * = (regionId, regionTypeId, dataSource, description, geom) <> ((Region.apply _).tupled, Region.unapply)

  def regionType: ForeignKeyQuery[RegionTypeTable, RegionType] =
    foreignKey("region_region_type_id_fkey", regionTypeId, TableQuery[RegionTypeTable])(_.regionTypeId)
}

/**
 * Data access object for the sidewalk_edge table
 */
object RegionTable {
  import MyPostgresDriver.plainImplicits._

  implicit val regionConverter = GetResult[Region](r => {
    Region(r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextGeometry[Polygon])
  })

  val db = play.api.db.slick.DB
  val regions = TableQuery[RegionTable]
  val userCurrentRegions = TableQuery[UserCurrentRegionTable]

  // Create a round robin neighborhood supplier to be used in getRegion.
  // http://stackoverflow.com/questions/19771992/is-there-a-round-robin-circular-queue-avaliable-in-scala-collections
  // http://stackoverflow.com/questions/7619642/consume-items-from-a-scala-iterator
  val neighborhoodRoundRobin = db.withSession { implicit session =>
    val neighborhoods = regions.filter(_.regionTypeId === 2).list
    Iterator.continually(neighborhoods).flatten
  }

  /**
   * Returns a list of all the sidewalk edges
    *
    * @return A list of SidewalkEdge objects.
   */
  def all: List[Region] = db.withSession { implicit session =>
    regions.list
  }

  /**
    * Get a region supplied in a round-robin fashion.
    * @return
    */
  def getRegion: Option[Region] = db.withSession { implicit session =>
    Some(neighborhoodRoundRobin.next)
  }

  /**
    * Get the region specified by the region id
    *
    * @param regionId region id
    * @return
    */
  def getRegion(regionId: Int): Option[Region] = db.withSession { implicit session =>
    try {
      Some(regions.filter(_.regionId === regionId).list.head)
    } catch {
      case e: NoSuchElementException => None
      case _: Throwable => None  // Shouldn't reach here
    }
  }

  /**
    * Get the neighborhood that is currently assigned to the user.
    *
    * @param userId user id
    * @return
    */
  def getCurrentRegion(userId: UUID): Option[Region] = db.withSession { implicit session =>
    try {
      val currentRegions = for {
        (r, ucr) <- regions.innerJoin(userCurrentRegions).on(_.regionId === _.regionId)
        if ucr.userId === userId.toString
      } yield r
      Some(currentRegions.list.head)
    } catch {
      case e: NoSuchElementException => None
      case _: Throwable => None  // Shouldn't reach here
    }
  }

  def getRegionsIntersectingStreet(streetEdgeId: Int): List[Region] = db.withSession { implicit session =>
    val selectRegionQuery = Q.query[Int, Region](
      """SELECT * FROM sidewalk.region
        |INNER JOIN sidewalk.street_edge
        |ON region.geom && street_edge.geom
        |WHERE street_edge.street_edge_id = ?
      """.stripMargin
    )
    selectRegionQuery(streetEdgeId).list
  }

  /**
   * Returns a list of regions of a given type.
    *
    * @param regionType A type of regions (e.g., "city", "neighborhood")
   * @return
   */
  def listRegionOfType(regionType: String): List[Region] = db.withSession { implicit session =>
    val regionTypes = TableQuery[RegionTypeTable]
    val _regions = for {
      (_regions, _regionTypes) <- regions.innerJoin(regionTypes).on(_.regionTypeId === _.regionTypeId) if _regionTypes.regionType === regionType
    } yield _regions
    _regions.list
  }


//  def listNeighborhoods: List[Neighborhood] = listRegionOfType("neighborhood").map(r => Neighborhood(r.regionId, "neighborhood"))
}
