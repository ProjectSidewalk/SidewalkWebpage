package models.region

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class RegionType(regionTypeId: Int, regionType: String)

class RegionTypeTable(tag: Tag) extends Table[RegionType](tag, Some("sidewalk"), "region_type") {
  def regionTypeId = column[Int]("region_type_id", O.PrimaryKey)
  def regionType = column[String]("region_type", O.NotNull)

  def * = (regionTypeId, regionType) <> ((RegionType.apply _).tupled, RegionType.unapply)
}

object RegionTypeTable {
  val db = play.api.db.slick.DB
  val regionTypes = TableQuery[RegionTypeTable]
}
