package models.street

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api.*
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}

/**
 * One OpenStreetMap way a street lies on, and where (#5741): one row per street-way pair. The position columns are
 * all set or all null; null means no position was recorded (an older city, a hand-built layer, Infra3d's way -1).
 *
 * @param osmWayId       The OSM way, or -1 in a city whose streets did not come from OSM.
 * @param streetEdgeId   The street.
 * @param streetFromFrac Where along the street (0 at its first coordinate, 1 at its last) this way starts covering it.
 * @param streetToFrac   Where along the street the coverage ends; always past `streetFromFrac`.
 * @param wayFromFrac    Where along the way, in the way's own drawn direction, the shared stretch starts.
 * @param wayToFrac      Where along the way it ends; always past `wayFromFrac`.
 * @param sameDirection  Whether walking the street from its start runs the way from `wayFromFrac` toward
 *                       `wayToFrac`. When false, our left side is OSM's `:right`.
 * @param matchedAt      When the position was computed against the way's geometry; compare with the way's
 *                       `osm_timestamp` to see whether OSM has edited the way since.
 */
case class OsmWayStreetEdge(
    osmWayStreetEdgeId: Int,
    osmWayId: Long,
    streetEdgeId: Int,
    streetFromFrac: Option[Double],
    streetToFrac: Option[Double],
    wayFromFrac: Option[Double],
    wayToFrac: Option[Double],
    sameDirection: Option[Boolean],
    matchedAt: Option[OffsetDateTime],
    isPrimary: Boolean
)

class OsmWayStreetEdgeTableDef(tag: Tag) extends Table[OsmWayStreetEdge](tag, "osm_way_street_edge") {
  def osmWayStreetEdgeId: Rep[Int] = column[Int]("osm_way_street_edge_id", O.PrimaryKey, O.AutoInc)
  def osmWayId: Rep[Long]          = column[Long]("osm_way_id")
  def streetEdgeId: Rep[Int]       = column[Int]("street_edge_id")
  // CHECK 0..1 on each fraction, from < to within each pair, and all-or-none across the position columns in the DB
  // (no Slick DSL for CHECK constraints).
  def streetFromFrac: Rep[Option[Double]]    = column[Option[Double]]("street_from_frac")
  def streetToFrac: Rep[Option[Double]]      = column[Option[Double]]("street_to_frac")
  def wayFromFrac: Rep[Option[Double]]       = column[Option[Double]]("way_from_frac")
  def wayToFrac: Rep[Option[Double]]         = column[Option[Double]]("way_to_frac")
  def sameDirection: Rep[Option[Boolean]]    = column[Option[Boolean]]("same_direction")
  def matchedAt: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("matched_at")
  // Kept ranked by the table's statement triggers (evolution 417); never written from here.
  def isPrimary: Rep[Boolean] = column[Boolean]("is_primary")

  def * = (
    osmWayStreetEdgeId, osmWayId, streetEdgeId, streetFromFrac, streetToFrac, wayFromFrac, wayToFrac, sameDirection,
    matchedAt, isPrimary
  ).mapTo[OsmWayStreetEdge]

  def streetEdge =
    foreignKey("osm_way_street_edge_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(_.streetEdgeId)
  // UNIQUE NULLS NOT DISTINCT in the DB, which Slick's index DSL can't express.
  def streetWayPosition =
    index("osm_way_street_edge_street_way_position_key", (streetEdgeId, osmWayId, streetFromFrac), unique = true)
}

/**
 * The `osm_way_street_edge_primary` view: the read-only row per street flagged `is_primary`, the way the APIs name.
 */
class OsmWayStreetEdgePrimaryTableDef(tag: Tag) extends Table[(Int, Long)](tag, "osm_way_street_edge_primary") {
  def streetEdgeId: Rep[Int] = column[Int]("street_edge_id")
  def osmWayId: Rep[Long]    = column[Long]("osm_way_id")

  def * = (streetEdgeId, osmWayId)
}

@ImplementedBy(classOf[OsmWayStreetEdgeTable])
trait OsmWayStreetEdgeTableRepository {}

@Singleton
class OsmWayStreetEdgeTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends OsmWayStreetEdgeTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val osmStreetTable = TableQuery[OsmWayStreetEdgeTableDef]
}
