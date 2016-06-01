package models.region

import java.util.UUID

import com.vividsolutions.jts.geom.Polygon
import models.user.UserCurrentRegionTable
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.jdbc.{StaticQuery => Q, GetResult}
import scala.slick.lifted.ForeignKeyQuery

case class Region(regionId: Int, regionTypeId: Int, dataSource: String, description: String, geom: Polygon, deleted: Boolean)
case class NamedRegion(regionId: Int, name: Option[String], geom: Polygon)

class RegionTable(tag: Tag) extends Table[Region](tag, Some("sidewalk"), "region") {
  def regionId = column[Int]("region_id", O.PrimaryKey, O.AutoInc)
  def regionTypeId = column[Int]("region_type_id", O.NotNull)
  def dataSource = column[String]("data_source", O.Nullable)
  def description = column[String]("description", O.Nullable)
  def geom = column[Polygon]("geom")
  def deleted = column[Boolean]("deleted")

  def * = (regionId, regionTypeId, dataSource, description, geom, deleted) <> ((Region.apply _).tupled, Region.unapply)

  def regionType: ForeignKeyQuery[RegionTypeTable, RegionType] =
    foreignKey("region_region_type_id_fkey", regionTypeId, TableQuery[RegionTypeTable])(_.regionTypeId)
}

/**
 * Data access object for the sidewalk_edge table
 */
object RegionTable {
  import MyPostgresDriver.plainImplicits._

  implicit val regionConverter = GetResult[Region](r => {
    Region(r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextGeometry[Polygon], r.nextBoolean)
  })

  implicit val namedRegionConverter = GetResult[NamedRegion](r => {
    NamedRegion(r.nextInt, r.nextStringOption, r.nextGeometry[Polygon])
  })

  val db = play.api.db.slick.DB
  val regions = TableQuery[RegionTable].filter(_.deleted === false)
  val regionTypes = TableQuery[RegionTypeTable]
  val regionProperties = TableQuery[RegionPropertyTable]
  val userCurrentRegions = TableQuery[UserCurrentRegionTable]

  // Create a round robin neighborhood supplier to be used in getRegion.
  // http://stackoverflow.com/questions/19771992/is-there-a-round-robin-circular-queue-avaliable-in-scala-collections
  // http://stackoverflow.com/questions/7619642/consume-items-from-a-scala-iterator
  val neighborhoodRoundRobin = db.withSession { implicit session =>
    val neighborhoods = regions.filter(_.regionTypeId === 2).list
    Iterator.continually(neighborhoods).flatten
  }

  val namedRegionRoundRobin = db.withSession { implicit session =>
    val neighborhoods = regions.filter(_.regionTypeId === 2)
    val namedRegions = for {
      (_neighborhoods, _regionProperties) <- neighborhoods.leftJoin(regionProperties).on(_.regionId === _.regionId)
      if _regionProperties.key === "Neighborhood Name"
    } yield (_neighborhoods.regionId, _regionProperties.value.?, _neighborhoods.geom)

    val l = namedRegions.list.map(x => NamedRegion.tupled(x))

    Iterator.continually(l).flatten
  }

  /**
   * Returns a list of all the sidewalk edges
    *
    * @return A list of SidewalkEdge objects.
   */
  def all: List[Region] = db.withSession { implicit session =>
    regions.filter(_.regionTypeId === 2).list
  }

  /**
    * Get a Region in a round-robin fashion.
    * @return
    */
  def getRegion: Option[Region] = db.withSession { implicit session =>
    Some(neighborhoodRoundRobin.next)
  }

  /**
    * Get a Named Region in a round-robin fashion
    * @return
    */
  def getNamedRegion: Option[NamedRegion] = db.withSession { implicit session =>
    Some(namedRegionRoundRobin.next)
  }

  /**
    * Get the region specified by the region id
    *
    * @param regionId region id
    * @return
    */
  def getRegion(regionId: Int): Option[Region] = db.withSession { implicit session =>
    try {
      Some(regions.filter(_.regionTypeId === 2).filter(_.regionId === regionId).list.head)
    } catch {
      case e: NoSuchElementException => None
      case _: Throwable => None  // Shouldn't reach here
    }
  }

  /**
    * Get the region specified by the region id
    *
    * @param regionId region id
    * @return
    */
  def getNamedRegion(regionId: Int): Option[NamedRegion] = db.withSession { implicit session =>
    try {
      val _regions = for {
        (_regions, _properties) <- regions.filter(_.regionTypeId === 2).leftJoin(regionProperties).on(_.regionId === _.regionId)
        if _properties.key === "Neighborhood Name"
      } yield (_regions.regionId, _properties.value.?, _regions.geom)
      Some(_regions.list.map(x => NamedRegion.tupled(x)).head)
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
        (r, ucr) <- regions.filter(_.regionTypeId === 2).innerJoin(userCurrentRegions).on(_.regionId === _.regionId)
        if ucr.userId === userId.toString
      } yield r
      Some(currentRegions.list.head)
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
  def getCurrentNamedRegion(userId: UUID): Option[NamedRegion] = db.withSession { implicit session =>
    try {
      val currentRegions = for {
        (r, ucr) <- regions.filter(_.regionTypeId === 2).innerJoin(userCurrentRegions).on(_.regionId === _.regionId)
        if ucr.userId === userId.toString
      } yield r

      val _regions = for {
        (_regions, _properties) <- currentRegions.leftJoin(regionProperties).on(_.regionId === _.regionId)
        if _properties.key === "Neighborhood Name"
      } yield (_regions.regionId, _properties.value.?, _regions.geom)
      Some(_regions.list.map(x => NamedRegion.tupled(x)).head)
    } catch {
      case e: NoSuchElementException => None
      case _: Throwable => None  // Shouldn't reach here
    }
  }

  /**
    * Get Regions that intersect with the given street
    * @param streetEdgeId
    * @return
    */
  def getRegionsIntersectingAStreet(streetEdgeId: Int): List[Region] = db.withSession { implicit session =>
    val selectRegionQuery = Q.query[Int, Region](
      """SELECT * FROM sidewalk.region
        |INNER JOIN sidewalk.street_edge
        |ON ST_Intersects(region.geom, street_edge.geom)
        |WHERE street_edge.street_edge_id = ? and region.region_type_id = 2
      """.stripMargin
    )
    selectRegionQuery(streetEdgeId).list
  }

  def getNamedRegionsIntersectingAStreet(streetEdgeId: Int): List[NamedRegion] = db.withSession { implicit session =>
    val selectRegionQuery = Q.query[Int, NamedRegion](
      """SELECT region.region_id, region_property.value, region.geom FROM sidewalk.region
        |INNER JOIN sidewalk.street_edge
        | ON ST_Intersects(region.geom, street_edge.geom)
        |LEFT JOIN sidewalk.region_property
        | ON region.region_id = region_property.value
        |WHERE street_edge.street_edge_id = ? AND region_property.key = 'Neighborhood Name'
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
    val _regions = for {
      (_regions, _regionTypes) <- regions.innerJoin(regionTypes).on(_.regionTypeId === _.regionTypeId) if _regionTypes.regionType === regionType
    } yield _regions
    _regions.list
  }

  /**
    * This method returns a list of NamedRegions
    * @param regionType
    * @return
    */
  def listNamedRegionOfType(regionType: String): List[NamedRegion] = db.withSession { implicit session =>

    val _regions = for {
      (_regions, _regionTypes) <- regions.innerJoin(regionTypes).on(_.regionTypeId === _.regionTypeId) if _regionTypes.regionType === regionType
    } yield _regions


    val _namedRegions = for {
      (_regions, _regionProperties) <- _regions.leftJoin(regionProperties).on(_.regionId === _.regionId) if _regionProperties.key === "Neighborhood Name"
    } yield (_regions.regionId, _regionProperties.value.?, _regions.geom)

    _namedRegions.list.map(x => NamedRegion.tupled(x))
  }


}
