package models.street

import models.audit.AuditTaskTable
import models.region._
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class StreetEdgeRegion(streetEdgeId: Int, regionId: Int)

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
  val nonDeletedStreetEdgeRegions = for {
    _ser <- streetEdgeRegionTable
    _se <- StreetEdgeTable.streetEdgesWithoutDeleted if _ser.streetEdgeId === _se.streetEdgeId
    _r <- RegionTable.regionsWithoutDeleted if _ser.regionId === _r.regionId
  } yield _ser

  /**
    * Get records based on the street edge id.
    * @param streetEdgeId
    * @return
    */
  def selectByStreetEdgeId(streetEdgeId: Int): List[StreetEdgeRegion] = db.withSession { implicit session =>
    streetEdgeRegionTable.filter(item => item.streetEdgeId === streetEdgeId).list
  }

  /**
    * Get records based on the street edge id.
    * @param streetEdgeId
    * @return
    */
  def selectNonDeletedByStreetEdgeId(streetEdgeId: Int): List[StreetEdgeRegion] = db.withSession { implicit session =>
    nonDeletedStreetEdgeRegions.filter(item => item.streetEdgeId === streetEdgeId).list
  }

  /**
    * Get records based on the region id.
    * @param regionId
    * @return
    */
  def selectByRegionId(regionId: Int): List[StreetEdgeRegion] = db.withSession { implicit session =>
    streetEdgeRegionTable.filter(item => item.regionId === regionId).list
  }

  /**
    * Get records based on the region id.
    * @param regionId
    * @return
    */
  def selectNonDeletedByRegionId(regionId: Int): List[StreetEdgeRegion] = db.withSession { implicit session =>
    nonDeletedStreetEdgeRegions.filter(item => item.regionId === regionId).list
  }

  /**
    * Checks if every street in the region has an associated completed audit task.
    *
    * @param regionId
    * @return
    */
  def allStreetsInARegionAudited(regionId: Int): Boolean = db.withSession { implicit session =>
    val edgesInRegion: Int = selectNonDeletedByRegionId(regionId).length
    val edgesAuditedInRegion: Int = (for {
      _edgeRegions <- nonDeletedStreetEdgeRegions if _edgeRegions.regionId === regionId
      _audits <- AuditTaskTable.completedTasks if _audits.streetEdgeId === _edgeRegions.streetEdgeId
    } yield _audits.streetEdgeId).groupBy(x => x).map(_._1).list.length

    edgesAuditedInRegion == edgesInRegion
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
