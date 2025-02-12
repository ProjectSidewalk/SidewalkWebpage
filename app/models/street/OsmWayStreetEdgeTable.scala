package models.street

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.db.slick

import javax.inject.{Inject, Singleton}

case class OsmWayStreetEdge(osmWayStreetEdgeId: Int, osmWayId: Long, streetEdgeId: Int)

class OsmWayStreetEdgeTableDef(tag: Tag) extends Table[OsmWayStreetEdge](tag, "osm_way_street_edge") {
  def osmWayStreetEdgeId: Rep[Int] = column[Int]("osm_way_street_edge_id", O.PrimaryKey, O.AutoInc)
  def osmWayId: Rep[Long] = column[Long]("osm_way_id")
  def streetEdgeId: Rep[Int] = column[Int]("street_edge_id")

  def * = (osmWayStreetEdgeId, osmWayId, streetEdgeId) <> ((OsmWayStreetEdge.apply _).tupled, OsmWayStreetEdge.unapply)
}

@ImplementedBy(classOf[OsmWayStreetEdgeTable])
trait OsmWayStreetEdgeTableRepository {
}

@Singleton
class OsmWayStreetEdgeTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends OsmWayStreetEdgeTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val osmStreetTable = TableQuery[OsmWayStreetEdgeTableDef]
}
