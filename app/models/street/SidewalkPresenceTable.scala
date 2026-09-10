package models.street

import com.google.inject.ImplementedBy
import models.api.{SidewalkPresenceFiltersForApi, SidewalkPresenceForApi}
import models.label.StreetSide
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.LineString
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.jdbc.GetResult
import slick.sql.SqlStreamingAction

import java.time.{OffsetDateTime, ZoneOffset}
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

/**
 * What the labels say about one block face: one side of one street (#5279).
 *
 * The unit is `(street_edge_id, street_side)`, the side being relative to the street's digitized direction as
 * `label_point.street_side` is. A street therefore has exactly two rows, whatever its status; the derivation covers
 * every street so the table can answer "unknown" for the unaudited ones rather than having no row to point at.
 *
 * @param presence                Present, absent, or unknown; a function of `presenceBasis` (a CHECK in the DB).
 * @param presenceBasis           Which evidence produced the call, in the order the derivation tries them.
 * @param noSidewalkLabelCount    Sided NoSidewalk labels on this face, the confidence behind an `absent` call.
 * @param noSidewalkUserCount     Distinct users behind those labels.
 * @param labelCount              Every sided label on this face, of any type.
 * @param auditCount              Completed audits of the street (both faces share it).
 * @param firstNoSidewalkLabelAt  When the first NoSidewalk label on this face was placed, if any.
 * @param lastNoSidewalkLabelAt   When the latest one was.
 */
case class SidewalkPresence(
    streetEdgeId: Int,
    streetSide: StreetSide.Value,
    presence: SidewalkPresenceStatus.Value,
    presenceBasis: SidewalkPresenceBasis.Value,
    noSidewalkLabelCount: Int,
    noSidewalkUserCount: Int,
    labelCount: Int,
    auditCount: Int,
    firstNoSidewalkLabelAt: Option[OffsetDateTime],
    lastNoSidewalkLabelAt: Option[OffsetDateTime]
)

/** What a rebuild did to the `sidewalk_presence` table. `total` is the row count afterwards. */
case class SidewalkPresenceRebuildCounts(total: Int, inserted: Int, updated: Int, deleted: Int)

class SidewalkPresenceTableDef(tag: Tag) extends Table[SidewalkPresence](tag, "sidewalk_presence") {
  def streetEdgeId: Rep[Int]                              = column[Int]("street_edge_id")
  def streetSide: Rep[StreetSide.Value]                   = column[StreetSide.Value]("street_side")
  def presence: Rep[SidewalkPresenceStatus.Value]         = column[SidewalkPresenceStatus.Value]("presence")
  def presenceBasis: Rep[SidewalkPresenceBasis.Value]     = column[SidewalkPresenceBasis.Value]("presence_basis")
  def noSidewalkLabelCount: Rep[Int]                      = column[Int]("no_sidewalk_label_count") // CHECK (>= 0)
  def noSidewalkUserCount: Rep[Int]                       = column[Int]("no_sidewalk_user_count")  // CHECK (>= 0)
  def labelCount: Rep[Int]                                = column[Int]("label_count")             // CHECK (>= 0)
  def auditCount: Rep[Int]                                = column[Int]("audit_count")             // CHECK (>= 0)
  def firstNoSidewalkLabelAt: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("first_no_sidewalk_label_at")
  def lastNoSidewalkLabelAt: Rep[Option[OffsetDateTime]]  = column[Option[OffsetDateTime]]("last_no_sidewalk_label_at")
  // Cross-column CHECKs in the DB (383.sql), which Slick can't express: presence is a function of presence_basis,
  // no_sidewalk_labels <=> no_sidewalk_label_count >= 1, unaudited => audit_count = 0, user count <= NoSidewalk
  // count <= label count, and the two timestamps are present exactly when the NoSidewalk count is positive.

  def * = (
    streetEdgeId, streetSide, presence, presenceBasis, noSidewalkLabelCount, noSidewalkUserCount, labelCount,
    auditCount, firstNoSidewalkLabelAt, lastNoSidewalkLabelAt
  ) <> ((SidewalkPresence.apply _).tupled, SidewalkPresence.unapply)

  def pk = primaryKey("sidewalk_presence_pkey", (streetEdgeId, streetSide))

  def streetEdge = foreignKey("sidewalk_presence_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(
    _.streetEdgeId,
    onDelete = ForeignKeyAction.Cascade
  )
}

@ImplementedBy(classOf[SidewalkPresenceTable])
trait SidewalkPresenceTableRepository {

  /**
   * Re-derives every block face from the current labels and audits, touching only the rows that changed.
   *
   * Compose inside a transaction (the temp table it uses drops on commit). Rows whose derived values differ are
   * updated in place, faces of new streets inserted, faces of vanished streets deleted.
   */
  def rebuild: DBIO[SidewalkPresenceRebuildCounts]

  /**
   * The block faces the public API returns, with the street's geometry and region joined on, designed for streaming.
   *
   * @param filters The filters to apply.
   * @return        A streaming action yielding one row per face, ordered by street then side.
   */
  def getSidewalkPresenceForApi(
      filters: SidewalkPresenceFiltersForApi
  ): SqlStreamingAction[Vector[SidewalkPresenceForApi], SidewalkPresenceForApi, Effect.Read]
}

/**
 * The derived per-face sidewalk presence table and its rebuild (#5279).
 *
 * The derivation is raw SQL held once in [[SidewalkPresenceTable.derivationSql]]; evolution 383 carries a pasted copy
 * for the one-time population of existing cities, and `SidewalkPresenceTableSpec` checks the two still agree.
 */
@Singleton
class SidewalkPresenceTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit
    ec: ExecutionContext
) extends SidewalkPresenceTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val sidewalkPresence: TableQuery[SidewalkPresenceTableDef] = TableQuery[SidewalkPresenceTableDef]

  def rebuild: DBIO[SidewalkPresenceRebuildCounts] = {
    for {
      // A second rebuild in one transaction (a spec's, or a retry) must not trip over the first one's temp table.
      _ <- sqlu"""DROP TABLE IF EXISTS derived_presence"""
      // Evaluated once; the derivation is what the evolution ran.
      _ <- sqlu"""CREATE TEMP TABLE derived_presence ON COMMIT DROP AS
                  #${SidewalkPresenceTable.derivationSql}
                  SELECT street_edge_id, street_side, presence, presence_basis, no_sidewalk_label_count,
                         no_sidewalk_user_count, label_count, audit_count, first_no_sidewalk_label_at,
                         last_no_sidewalk_label_at
                  FROM derived_face"""
      updated <- sqlu"""UPDATE sidewalk_presence
                        SET presence = derived_presence.presence,
                            presence_basis = derived_presence.presence_basis,
                            no_sidewalk_label_count = derived_presence.no_sidewalk_label_count,
                            no_sidewalk_user_count = derived_presence.no_sidewalk_user_count,
                            label_count = derived_presence.label_count,
                            audit_count = derived_presence.audit_count,
                            first_no_sidewalk_label_at = derived_presence.first_no_sidewalk_label_at,
                            last_no_sidewalk_label_at = derived_presence.last_no_sidewalk_label_at
                        FROM derived_presence
                        WHERE sidewalk_presence.street_edge_id = derived_presence.street_edge_id
                          AND sidewalk_presence.street_side = derived_presence.street_side
                          AND (sidewalk_presence.presence <> derived_presence.presence
                               OR sidewalk_presence.presence_basis <> derived_presence.presence_basis
                               OR sidewalk_presence.no_sidewalk_label_count <> derived_presence.no_sidewalk_label_count
                               OR sidewalk_presence.no_sidewalk_user_count <> derived_presence.no_sidewalk_user_count
                               OR sidewalk_presence.label_count <> derived_presence.label_count
                               OR sidewalk_presence.audit_count <> derived_presence.audit_count
                               OR sidewalk_presence.first_no_sidewalk_label_at
                                  IS DISTINCT FROM derived_presence.first_no_sidewalk_label_at
                               OR sidewalk_presence.last_no_sidewalk_label_at
                                  IS DISTINCT FROM derived_presence.last_no_sidewalk_label_at)"""
      deleted <- sqlu"""DELETE FROM sidewalk_presence
                        WHERE NOT EXISTS (
                            SELECT 1 FROM derived_presence
                            WHERE derived_presence.street_edge_id = sidewalk_presence.street_edge_id
                              AND derived_presence.street_side = sidewalk_presence.street_side
                        )"""
      inserted <- sqlu"""INSERT INTO sidewalk_presence (street_edge_id, street_side, presence, presence_basis,
                             no_sidewalk_label_count, no_sidewalk_user_count, label_count, audit_count,
                             first_no_sidewalk_label_at, last_no_sidewalk_label_at)
                         SELECT street_edge_id, street_side, presence, presence_basis, no_sidewalk_label_count,
                                no_sidewalk_user_count, label_count, audit_count, first_no_sidewalk_label_at,
                                last_no_sidewalk_label_at
                         FROM derived_presence
                         WHERE NOT EXISTS (
                             SELECT 1 FROM sidewalk_presence
                             WHERE sidewalk_presence.street_edge_id = derived_presence.street_edge_id
                               AND sidewalk_presence.street_side = derived_presence.street_side
                         )"""
      total <- sidewalkPresence.length.result
    } yield SidewalkPresenceRebuildCounts(total = total, inserted = inserted, updated = updated, deleted = deleted)
  }

  def getSidewalkPresenceForApi(
      filters: SidewalkPresenceFiltersForApi
  ): SqlStreamingAction[Vector[SidewalkPresenceForApi], SidewalkPresenceForApi, Effect.Read] = {
    def quotedList(values: Seq[String]): String = values.map(v => s"'${v.replace("'", "''")}'").mkString(", ")

    val bboxFilter = filters.bbox
      .map { bbox =>
        s"AND ST_Intersects(street_edge.geom, " +
          s"ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326))"
      }
      .getOrElse("")
    val regionIdFilter   = filters.regionId.map(id => s"AND region.region_id = $id").getOrElse("")
    val regionNameFilter = filters.regionName
      .map(name => s"AND LOWER(region.name) = LOWER('${name.replace("'", "''")}')")
      .getOrElse("")
    // wayType, presence, and status are validated against their enums in the controller, so the literals are valid
    // enum labels (an invalid one would be a Postgres error rather than an empty result).
    val wayTypeFilter  = filters.wayTypes.map(w => s"AND street_edge.way_type IN (${quotedList(w)})").getOrElse("")
    val presenceFilter =
      filters.presence.map(p => s"AND sidewalk_presence.presence IN (${quotedList(p)})").getOrElse("")
    val statusFilter = filters.statuses.map(st => s"AND street_edge.status IN (${quotedList(st)})").getOrElse("")
    val minNoSidewalkLabelsFilter = filters.minNoSidewalkLabels
      .map(n => s"AND sidewalk_presence.no_sidewalk_label_count >= $n")
      .getOrElse("")
    val minAuditCountFilter =
      filters.minAuditCount.map(n => s"AND sidewalk_presence.audit_count >= $n").getOrElse("")

    // Region and OSM way are joined at read time rather than stored: both are one-to-one with the street, and the
    // Streets API resolves them the same way. Only the tutorial street is excluded, as there; every other street is
    // returned tagged with its `status` (#3888), so a consumer who wants only the live ones — the table also covers
    // streets closed with their neighborhood, whose `region_id` /v3/api/regions never returns — asks for
    // `status=open`. User-supplied strings are single-quote-escaped above and numeric filters are safe; see #2756
    // for moving these to bound parameters.
    val queryStr = s"""
      SELECT sidewalk_presence.street_edge_id, sidewalk_presence.street_side, osm_way_street_edge.osm_way_id,
             region.region_id, region.name, street_edge.way_type, street_edge.status, sidewalk_presence.presence,
             sidewalk_presence.presence_basis, sidewalk_presence.no_sidewalk_label_count,
             sidewalk_presence.no_sidewalk_user_count, sidewalk_presence.label_count, sidewalk_presence.audit_count,
             sidewalk_presence.first_no_sidewalk_label_at, sidewalk_presence.last_no_sidewalk_label_at,
             street_edge.geom
      FROM sidewalk_presence
      INNER JOIN street_edge ON sidewalk_presence.street_edge_id = street_edge.street_edge_id
      INNER JOIN osm_way_street_edge ON street_edge.street_edge_id = osm_way_street_edge.street_edge_id
      INNER JOIN street_edge_region ON street_edge.street_edge_id = street_edge_region.street_edge_id
      INNER JOIN region ON street_edge_region.region_id = region.region_id
      WHERE street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
        $bboxFilter
        $regionIdFilter
        $regionNameFilter
        $wayTypeFilter
        $statusFilter
        $presenceFilter
        $minNoSidewalkLabelsFilter
        $minAuditCountFilter
      ORDER BY sidewalk_presence.street_edge_id, sidewalk_presence.street_side
    """

    implicit val getSidewalkPresenceForApi: GetResult[SidewalkPresenceForApi] = GetResult { r =>
      SidewalkPresenceForApi(
        streetEdgeId = r.nextInt(),
        streetSide = r.nextString(),
        osmWayId = r.nextLong(),
        regionId = r.nextInt(),
        regionName = r.nextString(),
        wayType = r.nextString(),
        status = r.nextString(),
        presence = r.nextString(),
        presenceBasis = r.nextString(),
        noSidewalkLabelCount = r.nextInt(),
        noSidewalkUserCount = r.nextInt(),
        labelCount = r.nextInt(),
        auditCount = r.nextInt(),
        firstNoSidewalkLabelDate =
          r.nextTimestampOption().map(t => OffsetDateTime.ofInstant(t.toInstant, ZoneOffset.UTC)),
        lastNoSidewalkLabelDate =
          r.nextTimestampOption().map(t => OffsetDateTime.ofInstant(t.toInstant, ZoneOffset.UTC)),
        geometry = r.nextGeometry[LineString]()
      )
    }

    sql"""#$queryStr""".as[SidewalkPresenceForApi]
  }
}

object SidewalkPresenceTable {

  /**
   * The derivation of every block face's verdict from labels and audits, as a `WITH` prefix defining `derived_face`
   * with exactly the columns of `sidewalk_presence`. Held once so [[SidewalkPresenceTable.rebuild]] and the specs use
   * exactly what evolution 383 ran; see that file for the reasoning behind each step.
   *
   * The rule (the #5222 study, Planning PR #20): a face's own sided NoSidewalk labels call it `absent`, with the
   * count as the confidence; failing that, a "street has no sidewalks" tag on the opposite face does; failing that,
   * a completed audit of the street calls it `present`; and an unaudited street is `unknown`. Obstacle and
   * SurfaceProblem labels never veto a NoSidewalk call — on a face without a sidewalk they describe the roadway.
   * Labels within a meter of the centerline have no side (`street_side` is NULL) and carry no face evidence.
   *
   * Labels *and* audits from `user_stat.excluded` contributors are dropped, the population [[models.label.LabelTable.labels]]
   * serves everywhere else. It has to be both: dropping only their labels would leave their audit behind, and an audit with no labels
   * is exactly what calls a face `present` — a banned contributor would flip the very faces they mislabeled.
   * `COALESCE(..., FALSE)` rather than an inner join so a row with no `user_stat` yet still counts (prod has none,
   * but a spec's seeded user does).
   */
  val derivationSql: String =
    """WITH face AS (
      |    SELECT street_edge.street_edge_id, sides.street_side
      |    FROM street_edge
      |    CROSS JOIN (VALUES ('left'::street_side), ('right'::street_side)) AS sides(street_side)
      |),
      |sided_label AS (
      |    SELECT label.street_edge_id, label_point.street_side, label.label_type, label.user_id, label.time_created,
      |           label.tags
      |    FROM label
      |    INNER JOIN label_point ON label.label_id = label_point.label_id
      |    LEFT JOIN user_stat ON label.user_id = user_stat.user_id
      |    WHERE NOT label.deleted AND NOT label.tutorial AND label_point.street_side IS NOT NULL
      |      AND NOT COALESCE(user_stat.excluded, FALSE)
      |),
      |face_label AS (
      |    SELECT street_edge_id, street_side,
      |           COUNT(*) AS label_count,
      |           COUNT(*) FILTER (WHERE label_type = 'NoSidewalk') AS no_sidewalk_label_count,
      |           COUNT(DISTINCT user_id) FILTER (WHERE label_type = 'NoSidewalk') AS no_sidewalk_user_count,
      |           COUNT(*) FILTER (WHERE label_type = 'NoSidewalk' AND 'street has no sidewalks' = ANY(tags))
      |               AS no_sidewalks_tag_count,
      |           MIN(time_created) FILTER (WHERE label_type = 'NoSidewalk') AS first_no_sidewalk_label_at,
      |           MAX(time_created) FILTER (WHERE label_type = 'NoSidewalk') AS last_no_sidewalk_label_at
      |    FROM sided_label
      |    GROUP BY street_edge_id, street_side
      |),
      |street_audit AS (
      |    SELECT audit_task.street_edge_id, COUNT(*) AS audit_count
      |    FROM audit_task
      |    LEFT JOIN user_stat ON audit_task.user_id = user_stat.user_id
      |    WHERE audit_task.completed AND NOT COALESCE(user_stat.excluded, FALSE)
      |    GROUP BY audit_task.street_edge_id
      |),
      |face_basis AS (
      |    SELECT face.street_edge_id, face.street_side,
      |           CASE WHEN COALESCE(this_face.no_sidewalk_label_count, 0) >= 1 THEN 'no_sidewalk_labels'
      |                WHEN COALESCE(other_face.no_sidewalks_tag_count, 0) >= 1 THEN 'other_side_tag'
      |                WHEN COALESCE(street_audit.audit_count, 0) >= 1 THEN 'audited_no_labels'
      |                ELSE 'unaudited' END AS presence_basis,
      |           COALESCE(this_face.no_sidewalk_label_count, 0)::INTEGER AS no_sidewalk_label_count,
      |           COALESCE(this_face.no_sidewalk_user_count, 0)::INTEGER AS no_sidewalk_user_count,
      |           COALESCE(this_face.label_count, 0)::INTEGER AS label_count,
      |           COALESCE(street_audit.audit_count, 0)::INTEGER AS audit_count,
      |           this_face.first_no_sidewalk_label_at,
      |           this_face.last_no_sidewalk_label_at
      |    FROM face
      |    LEFT JOIN face_label this_face
      |        ON face.street_edge_id = this_face.street_edge_id AND face.street_side = this_face.street_side
      |    LEFT JOIN face_label other_face
      |        ON face.street_edge_id = other_face.street_edge_id AND face.street_side <> other_face.street_side
      |    LEFT JOIN street_audit ON face.street_edge_id = street_audit.street_edge_id
      |),
      |derived_face AS (
      |    SELECT street_edge_id, street_side,
      |           CASE presence_basis
      |                WHEN 'audited_no_labels' THEN 'present'
      |                WHEN 'unaudited' THEN 'unknown'
      |                ELSE 'absent' END::sidewalk_presence_status AS presence,
      |           presence_basis::sidewalk_presence_basis AS presence_basis,
      |           no_sidewalk_label_count, no_sidewalk_user_count, label_count, audit_count,
      |           first_no_sidewalk_label_at, last_no_sidewalk_label_at
      |    FROM face_basis
      |)""".stripMargin
}
