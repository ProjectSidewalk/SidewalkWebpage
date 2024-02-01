package models.street

import models.region._
import models.utils.MyPostgresDriver.simple._
import play.api.Play
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class StreetEdgeRegion(streetEdgeId: Int, regionId: Int)

class StreetEdgeRegionTable(tag: Tag) extends Table[StreetEdgeRegion](tag, Play.configuration.getString("db-schema"), "street_edge_region") {
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

  def getNonDeletedRegionFromStreetId(streetEdgeId: Int): Option[Region] = db.withSession { implicit session =>
    streetEdgeRegionTable
      .filter(_.streetEdgeId === streetEdgeId)
      .innerJoin(RegionTable.regionsWithoutDeleted).on(_.regionId === _.regionId)
      .map(_._2).firstOption
  }
}
