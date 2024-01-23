package models.street

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.db.slick
import scala.slick.lifted.{Tag}

case class OsmWayStreetEdge(osmWayStreetEdgeId: Int, osmWayId: Long, streetEdgeId: Int)

class OsmWayStreetEdgeTable(tag: Tag) extends Table[OsmWayStreetEdge](tag, "osm_way_street_edge") {
  def osmWayStreetEdgeId = column[Int]("osm_way_street_edge_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def osmWayId = column[Long]("osm_way_id", O.NotNull)
  def streetEdgeId = column[Int]("street_edge_id", O.NotNull)

  def * = (osmWayStreetEdgeId, osmWayId, streetEdgeId) <> ((OsmWayStreetEdge.apply _).tupled, OsmWayStreetEdge.unapply)
}

object OsmWayStreetEdgeTable {
  val db: slick.Database = play.api.db.slick.DB
  val osmStreetTable = TableQuery[OsmWayStreetEdgeTable]
}
