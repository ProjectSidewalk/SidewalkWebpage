package models.region
import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

case class RegionProperty(regionPropertyId: Int, regionId: Int, key: String, value: String)

class RegionPropertyTable(tag: Tag) extends Table[RegionProperty](tag, Some("sidewalk"), "region_property") {
  def regionPropertyId = column[Int]("region_property_id", O.PrimaryKey)
  def regionId = column[Int]("region_id")
  def key = column[String]("key")
  def value = column[String]("value")

  def * = (regionPropertyId, regionId, key, value) <> ((RegionProperty.apply _).tupled, RegionProperty.unapply)
}

object RegionPropertyTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val regionProperties = TableQuery[RegionPropertyTable]

  val neighborhoodNames = regionProperties.filter(_.key === "Neighborhood Name")

  /**
    * Returns a list of all the sidewalk edges
    * @return A list of SidewalkEdge objects.
    */
  def all: List[RegionProperty] = db.withSession { implicit session =>
    regionProperties.list
  }

  /**
    * Return the neighborhood name of the given region
    * @param regionId Region id
    * @return
    */
  def neighborhoodName(regionId: Int): Option[String] = db.withSession { implicit session =>
    val regionProperty = regionProperties.filter(_.regionId === regionId).filter(_.key === "Neighborhood Name").list.headOption
    regionProperty match {
      case Some(rp) => Some(rp.value)
      case _ => None
    }
  }
}
