package models.street

import models.utils.MyPostgresProfile.api.{given, *}
import org.locationtech.jts.geom.LineString

import java.time.OffsetDateTime

/**
 * Where a street id went when tools/one-off/4717-consolidate-tiny-streets.sql deleted it (evolution 416). Nothing in
 * the app reads or writes this: a status change cannot describe a street that no longer exists, so this is the trace.
 *
 * @param droppedStreetEdgeId  The deleted street (no foreign key: its row is gone).
 * @param survivorStreetEdgeId The street it was joined onto, or None for a too-short street removed outright.
 * @param rule                 `same_way`, `continuation`, `border_cut`, `straightest` or `residue` (a CHECK in the DB).
 * @param droppedOsmWayId      Its OSM way, which the survivor's single way link can't carry (#5741); None if unknown.
 * @param droppedLengthM       Its length in meters.
 * @param droppedGeom          Its line.
 * @param mergedAt             When the script ran.
 */
case class StreetEdgeMerge(
    streetEdgeMergeId: Int,
    droppedStreetEdgeId: Int,
    survivorStreetEdgeId: Option[Int],
    rule: String,
    droppedOsmWayId: Option[Int],
    droppedLengthM: Double,
    droppedGeom: LineString,
    mergedAt: OffsetDateTime
)

class StreetEdgeMergeTableDef(tag: Tag) extends Table[StreetEdgeMerge](tag, "street_edge_merge") {
  def streetEdgeMergeId: Rep[Int]            = column[Int]("street_edge_merge_id", O.PrimaryKey, O.AutoInc)
  def droppedStreetEdgeId: Rep[Int]          = column[Int]("dropped_street_edge_id")
  def survivorStreetEdgeId: Rep[Option[Int]] = column[Option[Int]]("survivor_street_edge_id")
  def rule: Rep[String]                      = column[String]("rule")
  def droppedOsmWayId: Rep[Option[Int]]      = column[Option[Int]]("dropped_osm_way_id")
  def droppedLengthM: Rep[Double]            = column[Double]("dropped_length_m")  // CHECK (>= 0) in the DB.
  def droppedGeom: Rep[LineString]           = column[LineString]("dropped_geom")
  def mergedAt: Rep[OffsetDateTime]          = column[OffsetDateTime]("merged_at") // DEFAULT now() in the DB.

  def * = (streetEdgeMergeId, droppedStreetEdgeId, survivorStreetEdgeId, rule, droppedOsmWayId, droppedLengthM,
    droppedGeom, mergedAt).mapTo[StreetEdgeMerge]

  // ON DELETE SET NULL: a survivor a later run joins onto something else leaves this row pointing at nothing.
  def survivor =
    foreignKey("street_edge_merge_survivor_street_edge_id_fkey", survivorStreetEdgeId, TableQuery[StreetEdgeTableDef])(
      _.streetEdgeId.?,
      onDelete = ForeignKeyAction.SetNull
    )
}
