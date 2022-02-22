package models.street

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.db.slick
import scala.slick.lifted.{Tag}

case class OsmWayStreetEdge(osmWayStreetEdgeId: Int, osmWayId: Int, streetEdgeId: Int)

class OsmWayStreetEdgeTable(tag: Tag) extends Table[OsmWayStreetEdge](tag, Some("sidewalk"), "osm_way_street_edge") {
  def osmWayStreetEdgeId = column[Int]("osm_way_street_edge_id", O.NotNull)
  def osmWayId = column[Int]("osm_way_id", O.NotNull)
  def streetEdgeId = column[Int]("street_edge_id", O.NotNull)

  def * = (osmWayStreetEdgeId, osmWayId, streetEdgeId) <> ((OsmWayStreetEdge.apply _).tupled, OsmWayStreetEdge.unapply)
}

object OsmWayStreetEdgeTable {
  val db: slick.Database = play.api.db.slick.DB
  val osmStreetTable = TableQuery[OsmWayStreetEdgeTable]

  /**
    * Finds the OSM Way IDs of the streets reprsented by streetEdges.
    * 
    * @return a list of (streetEdge, OsmWayStreetEdge) pairs where each list element represents a
    *         streetEdge and its corresponding OsmWayStreetEdge.
    */
  def selectOsmWayIdsForStreets(streetEdges: List[StreetEdge]): List[(StreetEdge, OsmWayStreetEdge)] = db.withSession { implicit session =>
    val streetEdgeIds: List[Int] = streetEdges.map(_.streetEdgeId)
    val streetEdgesWithOsmIds = for {
      _osm <- osmStreetTable if _osm.streetEdgeId inSetBind streetEdgeIds
    } yield (
      _osm
    )

    streetEdges zip streetEdgesWithOsmIds.list
  }
}