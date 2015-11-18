package models.region
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class RegionType(regionTypeId: Int, description: String)

class RegionTypeTable(tag: Tag) extends Table[RegionType](tag, Some("sidewalk"), "region_type") {
  def regionTypeId = column[Int]("region_type_id", O.PrimaryKey)
  def description = column[String]("description", O.NotNull)

  def * = (regionTypeId, description) <> ((RegionType.apply _).tupled, RegionType.unapply)
}

object RegionTypeTable {
  val db = play.api.db.slick.DB
  val regionTypes = TableQuery[RegionTypeTable]

  /**
   * Returns a list of all the sidewalk edges
   * @return A list of SidewalkEdge objects.
   */
  def all: List[RegionType] = db.withSession { implicit session =>
    regionTypes.list
  }
}
