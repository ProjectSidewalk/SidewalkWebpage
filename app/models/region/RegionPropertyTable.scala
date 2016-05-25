package models.region
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class RegionProperty(regionPropertyId: Int, regionId: Int, key: String, value: String)

class RegionPropertyTable(tag: Tag) extends Table[RegionProperty](tag, Some("sidewalk"), "region_property") {
  def regionPropertyId = column[Int]("region_property_id", O.PrimaryKey)
  def regionId = column[Int]("region_id", O.NotNull)
  def key = column[String]("key", O.NotNull)
  def value = column[String]("value", O.NotNull)

  def * = (regionPropertyId, regionId, key, value) <> ((RegionProperty.apply _).tupled, RegionProperty.unapply)
}

object RegionPropertyTable {
  val db = play.api.db.slick.DB
  val regionProperties = TableQuery[RegionPropertyTable]

  /**
    * Returns a list of all the sidewalk edges
    * @return A list of SidewalkEdge objects.
    */
  def all: List[RegionProperty] = db.withSession { implicit session =>
    regionProperties.list
  }
}
