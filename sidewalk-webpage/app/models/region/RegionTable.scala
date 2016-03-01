package models.region

import com.vividsolutions.jts.geom.Polygon
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

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
  val db = play.api.db.slick.DB
  val regions = TableQuery[RegionTable]

  /**
   * Returns a list of all the sidewalk edges
   * @return A list of SidewalkEdge objects.
   */
  def all: List[Region] = db.withSession { implicit session =>
    regions.list
  }

  /**
   * Returns a list of regions of a given type.
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
}
