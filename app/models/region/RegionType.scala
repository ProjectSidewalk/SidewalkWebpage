package models.region
import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

case class RegionType(regionTypeId: Int, regionType: String)

class RegionTypeTable(tag: Tag) extends Table[RegionType](tag, Some("sidewalk"), "region_type") {
  def regionTypeId = column[Int]("region_type_id", O.PrimaryKey)
  def regionType = column[String]("region_type")

  def * = (regionTypeId, regionType) <> ((RegionType.apply _).tupled, RegionType.unapply)
}

object RegionTypeTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val regionTypes = TableQuery[RegionTypeTable]

  /**
   * Returns a list of all the region types
   * @return A list of regionType objects.
   */
  def all: Future[List[RegionType]] = db.run(
    regionTypes.to[List].result
  )
}
