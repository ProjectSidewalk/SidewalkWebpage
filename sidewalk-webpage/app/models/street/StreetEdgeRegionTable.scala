package models.street

import models.region._
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class StreetEdgeRegion(streetEdgeId: Int, parentEdgeId: Int)

class StreetEdgeRegionTable(tag: Tag) extends Table[StreetEdgeRegion](tag, Some("sidewalk"),  "street_edge_region") {
  def streetEdgeId = column[Int]("street_edge_id")
  def regionId = column[Int]("region_id")

  def * = (streetEdgeId, regionId) <> ((StreetEdgeRegion.apply _).tupled, StreetEdgeRegion.unapply)

  def streetEdge: ForeignKeyQuery[StreetEdgeTable, StreetEdge] =
    foreignKey("street_edge_region_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTable])(_.streetEdgeId)

  def region: ForeignKeyQuery[RegionTable, Region] =
    foreignKey("street_edge_region_region_id_fkey", regionId, TableQuery[RegionTable])(_.regionId)
}

object StreetEdgeRegionTable {
  val db = play.api.db.slick.DB
  val streetEdgeRegionTable = TableQuery[StreetEdgeRegionTable]

  /**
   * Get records based on the child id.
   * @param streetEdgeId
   * @return
   */
  def selectStreetEdgeId(streetEdgeId: Int): List[StreetEdgeRegion] = db.withSession { implicit session =>
    streetEdgeRegionTable.filter(item => item.streetEdgeId === streetEdgeId).list
  }

  /**
   * Get records based on the parent id.
   * @param regionId
   * @return
   */
  def selectByRegionId(regionId: Int): List[StreetEdgeRegion] = db.withSession { implicit session =>
    streetEdgeRegionTable.filter(item => item.regionId === regionId).list
  }

  /**
   * Save a record.
   * @param streetEdgeId
   * @param regionId
   * @return
   */
  def save(streetEdgeId: Int, regionId: Int) = db.withSession { implicit session =>
    streetEdgeRegionTable += StreetEdgeRegion(streetEdgeId, regionId)
  }
}
