package models.street

import models.audit.AuditTaskTable
import models.region._
import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

import scala.concurrent.ExecutionContext.Implicits.global

case class StreetEdgeRegion(streetEdgeId: Int, regionId: Int)

class StreetEdgeRegionTable(tag: Tag) extends Table[StreetEdgeRegion](tag, Some("sidewalk"), "street_edge_region") {
  def streetEdgeId = column[Int]("street_edge_id")
  def regionId = column[Int]("region_id")

  def * = (streetEdgeId, regionId) <> ((StreetEdgeRegion.apply _).tupled, StreetEdgeRegion.unapply)

  def streetEdge = foreignKey("street_edge_region_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTable])(_.streetEdgeId)

  def region = foreignKey("street_edge_region_region_id_fkey", regionId, TableQuery[RegionTable])(_.regionId)
}

object StreetEdgeRegionTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
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
  def selectByStreetEdgeId(streetEdgeId: Int): Future[List[StreetEdgeRegion]] = db.run(
    streetEdgeRegionTable.filter(item => item.streetEdgeId === streetEdgeId).to[List].result)

  /**
   * Get records based on the street edge id.
   * @param streetEdgeId
   * @return
   */
  def selectNonDeletedByStreetEdgeId(streetEdgeId: Int): Future[List[StreetEdgeRegion]] = db.run(
    nonDeletedStreetEdgeRegions.filter(item => item.streetEdgeId === streetEdgeId).to[List].result)

  /**
   * Get records based on the region id.
   * @param regionId
   * @return
   */
  def selectByRegionId(regionId: Int): Future[List[StreetEdgeRegion]] = db.run(
    streetEdgeRegionTable.filter(item => item.regionId === regionId).to[List].result)

  /**
   * Get records based on the region id.
   * @param regionId
   * @return
   */
  def selectNonDeletedByRegionId(regionId: Int): Future[List[StreetEdgeRegion]] = db.run(
    nonDeletedStreetEdgeRegions.filter(item => item.regionId === regionId).to[List].result)

  /**
   * Checks if every street in the region has an associated completed audit task.
   *
   * @param regionId
   * @return
   */
  def allStreetsInARegionAudited(regionId: Int): Future[Boolean] = {
    selectNonDeletedByRegionId(regionId).flatMap { edgesInRegion =>
      db.run({
        (for {
          _edgeRegions <- nonDeletedStreetEdgeRegions if _edgeRegions.regionId === regionId
          _audits <- AuditTaskTable.completedTasks if _audits.streetEdgeId === _edgeRegions.streetEdgeId
        } yield _audits.streetEdgeId).groupBy(x => x).map(_._1).length.result
      }).map(_ == edgesInRegion.length)
    }
  }

  /**
   * Save a record.
   * @param streetEdgeId
   * @param regionId
   * @return
   */
  def save(streetEdgeId: Int, regionId: Int): Future[Int] = db.run(
    (streetEdgeRegionTable += StreetEdgeRegion(streetEdgeId, regionId)).transactionally)
}
