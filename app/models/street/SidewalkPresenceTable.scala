package models.street

import com.google.inject.ImplementedBy
import models.api.{SidewalkPresenceFiltersForApi, SidewalkPresenceForApi}
import models.label.StreetSide
import models.utils.MyPostgresProfile.api.{given, *}
import models.utils.{Contributors, FilteredTables, MyPostgresProfile, SqlFragments}
import org.locationtech.jts.geom.LineString
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{JsValue, Json, Writes}
import slick.jdbc.{GetResult, SQLActionBuilder}
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
 * @param presence                  Present, absent, or unknown; a function of `presenceBasis` (a CHECK in the DB).
 * @param presenceBasis             Which evidence produced the call, in the order the derivation tries them.
 * @param noSidewalkLabelCount      Sided NoSidewalk labels on this face that validators have not rejected, the
 *                                  confidence behind an `absent` call.
 * @param noSidewalkUserCount       Distinct users behind those labels.
 * @param validatedNoSidewalkCount  Of those, the ones validators have confirmed (`label.correct`), the strongest
 *                                  evidence a face can carry (#5285).
 * @param rejectedNoSidewalkCount   Sided NoSidewalk labels on this face validators rejected; counted here and in
 *                                  `labelCount` but nowhere else, since a rejected call is not evidence.
 * @param labelCount                Every sided label on this face, of any type.
 * @param auditCount                Completed audits of the street (both faces share it).
 * @param firstNoSidewalkLabelAt    When the first counted NoSidewalk label on this face was placed, if any.
 * @param lastNoSidewalkLabelAt     When the latest one was.
 */
case class SidewalkPresence(
    streetEdgeId: Int,
    streetSide: StreetSide,
    presence: SidewalkPresenceStatus,
    presenceBasis: SidewalkPresenceBasis,
    noSidewalkLabelCount: Int,
    noSidewalkUserCount: Int,
    validatedNoSidewalkCount: Int,
    rejectedNoSidewalkCount: Int,
    labelCount: Int,
    auditCount: Int,
    firstNoSidewalkLabelAt: Option[OffsetDateTime],
    lastNoSidewalkLabelAt: Option[OffsetDateTime]
)

/**
 * One block face as the admin Sidewalks page reads it (#5724): the stored verdict and its evidence, plus the two
 * counts the page's review flags need that the table doesn't keep.
 *
 * @param problemLabelCount Sided Obstacle and SurfaceProblem labels on this face that validators have not rejected.
 *                          On a face called `absent` they usually describe hazards in the roadway people walk in (the
 *                          #5222 study), so they mark mixed evidence worth a look rather than a wrong call.
 * @param curbRampCount     Sided CurbRamp labels on this face that validators have not rejected.
 */
case class SidewalkPresenceFaceForAdmin(
    streetSide: String,
    presence: String,
    presenceBasis: String,
    noSidewalkLabelCount: Int,
    noSidewalkUserCount: Int,
    validatedNoSidewalkCount: Int,
    rejectedNoSidewalkCount: Int,
    labelCount: Int,
    problemLabelCount: Int,
    curbRampCount: Int,
    lastNoSidewalkLabelAt: Option[OffsetDateTime]
)

/**
 * One open street and its two faces, for the admin Sidewalks page (#5724). Geometry is deliberately absent: the page
 * joins these rows onto the street GeoJSON it fetches from `/v3/api/streets`, as the Imagery page does.
 *
 * @param lengthMeters Geodesic length, for the per-region kilometre roll-ups.
 * @param auditCount   Completed audits of the street, shared by both faces.
 * @param faces        The street's faces, left then right.
 */
case class SidewalkPresenceStreetForAdmin(
    streetEdgeId: Int,
    regionId: Int,
    regionName: String,
    wayType: String,
    lengthMeters: Double,
    auditCount: Int,
    faces: Seq[SidewalkPresenceFaceForAdmin]
)

object SidewalkPresenceStreetForAdmin {

  /**
   * snake_case per the admin dashboard convention. Hand-built so the field set is stated once, next to the classes:
   * the page reads every field by name, so a rename on one side only would be a blank column rather than an error.
   */
  given faceWrites: Writes[SidewalkPresenceFaceForAdmin] = Writes { face =>
    Json.obj(
      "street_side"                 -> face.streetSide,
      "presence"                    -> face.presence,
      "presence_basis"              -> face.presenceBasis,
      "no_sidewalk_label_count"     -> face.noSidewalkLabelCount,
      "no_sidewalk_user_count"      -> face.noSidewalkUserCount,
      "validated_no_sidewalk_count" -> face.validatedNoSidewalkCount,
      "rejected_no_sidewalk_count"  -> face.rejectedNoSidewalkCount,
      "label_count"                 -> face.labelCount,
      "problem_label_count"         -> face.problemLabelCount,
      "curb_ramp_count"             -> face.curbRampCount,
      "last_no_sidewalk_label_at"   -> face.lastNoSidewalkLabelAt.map(_.toString)
    )
  }

  given writes: Writes[SidewalkPresenceStreetForAdmin] = Writes { street =>
    Json.obj(
      "street_edge_id" -> street.streetEdgeId,
      "region_id"      -> street.regionId,
      "region_name"    -> street.regionName,
      "way_type"       -> street.wayType,
      "length_m"       -> street.lengthMeters,
      "audit_count"    -> street.auditCount,
      "faces"          -> Json.toJson(street.faces)
    )
  }

  /**
   * The whole endpoint payload.
   *
   * @param streets   Every open street with its two faces.
   * @param rebuiltAt When the nightly table was last rebuilt successfully, so the page can say how old its verdicts
   *                  are; None if it never has been in this city.
   * @return          The response body.
   */
  def payload(streets: Seq[SidewalkPresenceStreetForAdmin], rebuiltAt: Option[OffsetDateTime]): JsValue =
    Json.obj("rebuilt_at" -> rebuiltAt.map(_.toString), "streets" -> Json.toJson(streets))
}

/** What a rebuild did to the `sidewalk_presence` table. `total` is the row count afterwards. */
case class SidewalkPresenceRebuildCounts(total: Int, inserted: Int, updated: Int, deleted: Int)

class SidewalkPresenceTableDef(tag: Tag) extends Table[SidewalkPresence](tag, "sidewalk_presence") {
  def streetEdgeId: Rep[Int]                    = column[Int]("street_edge_id")
  def streetSide: Rep[StreetSide]               = column[StreetSide]("street_side")
  def presence: Rep[SidewalkPresenceStatus]     = column[SidewalkPresenceStatus]("presence")
  def presenceBasis: Rep[SidewalkPresenceBasis] = column[SidewalkPresenceBasis]("presence_basis")
  def noSidewalkLabelCount: Rep[Int]            = column[Int]("no_sidewalk_label_count") // CHECK (>= 0)
  def noSidewalkUserCount: Rep[Int]             = column[Int]("no_sidewalk_user_count")  // CHECK (>= 0)
  // DEFAULT 0 in the DB (388.sql added them to populated tables); CHECK (>= 0) each.
  def validatedNoSidewalkCount: Rep[Int]                  = column[Int]("validated_no_sidewalk_count", O.Default(0))
  def rejectedNoSidewalkCount: Rep[Int]                   = column[Int]("rejected_no_sidewalk_count", O.Default(0))
  def labelCount: Rep[Int]                                = column[Int]("label_count") // CHECK (>= 0)
  def auditCount: Rep[Int]                                = column[Int]("audit_count") // CHECK (>= 0)
  def firstNoSidewalkLabelAt: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("first_no_sidewalk_label_at")
  def lastNoSidewalkLabelAt: Rep[Option[OffsetDateTime]]  = column[Option[OffsetDateTime]]("last_no_sidewalk_label_at")
  // Cross-column CHECKs in the DB (383.sql, 388.sql), which Slick can't express: presence is a function of
  // presence_basis, no_sidewalk_labels <=> no_sidewalk_label_count >= 1, unaudited => audit_count = 0, user count <=
  // NoSidewalk count <= label count, validated count <= NoSidewalk count, NoSidewalk count + rejected count <= label
  // count, and the two timestamps are present exactly when the NoSidewalk count is positive.

  def * = (
    streetEdgeId, streetSide, presence, presenceBasis, noSidewalkLabelCount, noSidewalkUserCount,
    validatedNoSidewalkCount, rejectedNoSidewalkCount, labelCount, auditCount, firstNoSidewalkLabelAt,
    lastNoSidewalkLabelAt
  ).mapTo[SidewalkPresence]

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

  /**
   * Every open street with its two faces' verdicts and evidence, for the admin Sidewalks page (#5724).
   *
   * @return One row per street, ordered by id, each with its left face then its right.
   */
  def getForAdmin: DBIO[Seq[SidewalkPresenceStreetForAdmin]]
}

/**
 * The derived per-face sidewalk presence table and its rebuild (#5279).
 *
 * The derivation is raw SQL held once in [[SidewalkPresenceTable.derivationSql]]; evolution 388 (which superseded
 * 383's) carries a pasted copy for the one-time population of existing cities, and `SidewalkPresenceTableSpec` checks
 * the two still agree.
 */
@Singleton
class SidewalkPresenceTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(using
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
                         no_sidewalk_user_count, validated_no_sidewalk_count, rejected_no_sidewalk_count, label_count,
                         audit_count, first_no_sidewalk_label_at, last_no_sidewalk_label_at
                  FROM derived_face"""
      updated <- sqlu"""UPDATE sidewalk_presence
                        SET presence = derived_presence.presence,
                            presence_basis = derived_presence.presence_basis,
                            no_sidewalk_label_count = derived_presence.no_sidewalk_label_count,
                            no_sidewalk_user_count = derived_presence.no_sidewalk_user_count,
                            validated_no_sidewalk_count = derived_presence.validated_no_sidewalk_count,
                            rejected_no_sidewalk_count = derived_presence.rejected_no_sidewalk_count,
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
                               OR sidewalk_presence.validated_no_sidewalk_count
                                  <> derived_presence.validated_no_sidewalk_count
                               OR sidewalk_presence.rejected_no_sidewalk_count
                                  <> derived_presence.rejected_no_sidewalk_count
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
                             no_sidewalk_label_count, no_sidewalk_user_count, validated_no_sidewalk_count,
                             rejected_no_sidewalk_count, label_count, audit_count, first_no_sidewalk_label_at,
                             last_no_sidewalk_label_at)
                         SELECT street_edge_id, street_side, presence, presence_basis, no_sidewalk_label_count,
                                no_sidewalk_user_count, validated_no_sidewalk_count, rejected_no_sidewalk_count,
                                label_count, audit_count, first_no_sidewalk_label_at, last_no_sidewalk_label_at
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
    // wayType, presence, and status are validated against their enums in the controller (an invalid one would be a
    // Postgres error rather than an empty result).
    val conditions: Seq[SQLActionBuilder] = Seq(
      filters.bbox.map { bbox => SqlFragments.intersectsBBox("street_edge.geom", bbox) },
      filters.regionId.map(id => sql"region.region_id = $id"),
      filters.regionName.map(name => sql"LOWER(region.name) = LOWER($name)"),
      filters.wayTypes.map(w => sql"street_edge.way_type = ANY(${SqlFragments.enumList(w)}::way_type[])"),
      filters.statuses.map(st => sql"street_edge.status = ANY(${SqlFragments.enumList(st)}::street_edge_status[])"),
      filters.presence.map(p =>
        sql"sidewalk_presence.presence = ANY(${SqlFragments.enumList(p)}::sidewalk_presence_status[])"
      ),
      filters.minNoSidewalkLabels.map(n => sql"sidewalk_presence.no_sidewalk_label_count >= $n"),
      filters.minValidatedNoSidewalkLabels.map(n => sql"sidewalk_presence.validated_no_sidewalk_count >= $n"),
      filters.minAuditCount.map(n => sql"sidewalk_presence.audit_count >= $n")
    ).flatten

    // Region and OSM way are joined at read time rather than stored: both are one-to-one with the street, and the
    // Streets API resolves them the same way. Only the tutorial street is excluded, as there; every other street is
    // returned tagged with its `status` (#3888), so a consumer who wants only the live ones — the table also covers
    // streets closed with their region, whose `region_id` /v3/api/regions never returns — asks for `status=open`.
    val query: SQLActionBuilder = sql"""
      SELECT sidewalk_presence.street_edge_id, sidewalk_presence.street_side, osm_way_street_edge.osm_way_id,
             region.region_id, region.name, street_edge.way_type, street_edge.status, sidewalk_presence.presence,
             sidewalk_presence.presence_basis, sidewalk_presence.no_sidewalk_label_count,
             sidewalk_presence.no_sidewalk_user_count, sidewalk_presence.validated_no_sidewalk_count,
             sidewalk_presence.rejected_no_sidewalk_count, sidewalk_presence.label_count,
             sidewalk_presence.audit_count, sidewalk_presence.first_no_sidewalk_label_at,
             sidewalk_presence.last_no_sidewalk_label_at, street_edge.geom
      FROM sidewalk_presence
      INNER JOIN street_edge ON sidewalk_presence.street_edge_id = street_edge.street_edge_id
      INNER JOIN osm_way_street_edge ON street_edge.street_edge_id = osm_way_street_edge.street_edge_id
      INNER JOIN street_edge_region ON street_edge.street_edge_id = street_edge_region.street_edge_id
      INNER JOIN region ON street_edge_region.region_id = region.region_id
      WHERE #${FilteredTables.notTutorialStreet("street_edge.street_edge_id")}
        AND """
      .concat(SqlFragments.allOf(conditions))
      .concat(sql"""
      ORDER BY sidewalk_presence.street_edge_id, sidewalk_presence.street_side
    """)

    given getSidewalkPresenceForApi: GetResult[SidewalkPresenceForApi] = { r =>
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
        validatedNoSidewalkCount = r.nextInt(),
        rejectedNoSidewalkCount = r.nextInt(),
        labelCount = r.nextInt(),
        auditCount = r.nextInt(),
        firstNoSidewalkLabelDate =
          r.nextTimestampOption().map(t => OffsetDateTime.ofInstant(t.toInstant, ZoneOffset.UTC)),
        lastNoSidewalkLabelDate =
          r.nextTimestampOption().map(t => OffsetDateTime.ofInstant(t.toInstant, ZoneOffset.UTC)),
        geometry = r.nextGeometry[LineString]()
      )
    }

    query.as[SidewalkPresenceForApi]
  }

  def getForAdmin: DBIO[Seq[SidewalkPresenceStreetForAdmin]] = {
    given GetResult[(SidewalkPresenceStreetForAdmin, SidewalkPresenceFaceForAdmin)] = { r =>
      val street = SidewalkPresenceStreetForAdmin(
        streetEdgeId = r.nextInt(), regionId = r.nextInt(), regionName = r.nextString(), wayType = r.nextString(),
        lengthMeters = r.nextDouble(), auditCount = r.nextInt(), faces = Seq.empty
      )
      val face = SidewalkPresenceFaceForAdmin(
        streetSide = r.nextString(), presence = r.nextString(), presenceBasis = r.nextString(),
        noSidewalkLabelCount = r.nextInt(), noSidewalkUserCount = r.nextInt(), validatedNoSidewalkCount = r.nextInt(),
        rejectedNoSidewalkCount = r.nextInt(), labelCount = r.nextInt(), problemLabelCount = r.nextInt(),
        curbRampCount = r.nextInt(), lastNoSidewalkLabelAt = r.nextOffsetDateTimeOption()
      )
      (street, face)
    }

    // The two extra counts are computed live, while the verdicts they sit beside are as of the last rebuild, so a
    // label added since then can put a street on a review list before the rebuild has seen it. Storing them in
    // sidewalk_presence would close that gap at the cost of an evolution; for a review page the lag is acceptable.
    // They also drop validator-rejected labels, which the derivation's label_count keeps: a rejected curb ramp is not
    // evidence that a sidewalk is there.
    sql"""
      WITH face_evidence AS (
          SELECT label.street_edge_id, label_point.street_side,
                 COUNT(*) FILTER (WHERE label.label_type IN ('Obstacle', 'SurfaceProblem')) AS problem_label_count,
                 COUNT(*) FILTER (WHERE label.label_type = 'CurbRamp') AS curb_ramp_count
          FROM label
          INNER JOIN label_point ON label.label_id = label_point.label_id
          WHERE NOT label.deleted AND NOT label.tutorial AND label_point.street_side IS NOT NULL
            AND label.correct IS DISTINCT FROM FALSE
            AND #${FilteredTables.userCounts(None, "label.user_id", Contributors.NotExcluded)}
            AND label.label_type IN ('Obstacle', 'SurfaceProblem', 'CurbRamp')
          GROUP BY label.street_edge_id, label_point.street_side
      )
      SELECT street_edge.street_edge_id, region.region_id, region.name, street_edge.way_type,
             ST_Length(street_edge.geom::geography), sidewalk_presence.audit_count, sidewalk_presence.street_side,
             sidewalk_presence.presence, sidewalk_presence.presence_basis, sidewalk_presence.no_sidewalk_label_count,
             sidewalk_presence.no_sidewalk_user_count, sidewalk_presence.validated_no_sidewalk_count,
             sidewalk_presence.rejected_no_sidewalk_count, sidewalk_presence.label_count,
             COALESCE(face_evidence.problem_label_count, 0)::INTEGER,
             COALESCE(face_evidence.curb_ramp_count, 0)::INTEGER, sidewalk_presence.last_no_sidewalk_label_at
      FROM #${FilteredTables.streets()}
      INNER JOIN sidewalk_presence ON street_edge.street_edge_id = sidewalk_presence.street_edge_id
      INNER JOIN street_edge_region ON street_edge.street_edge_id = street_edge_region.street_edge_id
      INNER JOIN region ON street_edge_region.region_id = region.region_id
      LEFT JOIN face_evidence ON sidewalk_presence.street_edge_id = face_evidence.street_edge_id
          AND sidewalk_presence.street_side = face_evidence.street_side
      ORDER BY street_edge.street_edge_id, sidewalk_presence.street_side
    """.as[(SidewalkPresenceStreetForAdmin, SidewalkPresenceFaceForAdmin)].map { rows =>
      // Rows arrive grouped by street, so folding consecutive rows keeps the id order without a second sort.
      rows
        .foldLeft(Vector.empty[SidewalkPresenceStreetForAdmin]) { case (streets, (street, face)) =>
          streets.lastOption match {
            case Some(last) if last.streetEdgeId == street.streetEdgeId =>
              streets.init :+ last.copy(faces = last.faces :+ face)
            case _ => streets :+ street.copy(faces = Seq(face))
          }
        }
    }
  }
}

object SidewalkPresenceTable {

  /**
   * The derivation of every block face's verdict from labels and audits, as a `WITH` prefix defining `derived_face`
   * with exactly the columns of `sidewalk_presence`. Held once so [[SidewalkPresenceTable.rebuild]] and the specs use
   * exactly what evolution 388 ran; see that file and 383.sql for the reasoning behind each step.
   *
   * The rule (the #5222 study, Planning PR #20): a face's own sided NoSidewalk labels call it `absent`, with the
   * count as the confidence; failing that, a "street has no sidewalks" tag on the opposite face does; failing that,
   * a completed audit of the street calls it `present`; and an unaudited street is `unknown`. Obstacle and
   * SurfaceProblem labels never veto a NoSidewalk call — on a face without a sidewalk they describe the roadway.
   * Labels within a meter of the centerline have no side (`street_side` is NULL) and carry no face evidence.
   *
   * Validation feeds back (#5285): a NoSidewalk label validators rejected (`label.correct = FALSE`) is no evidence at
   * all — it leaves every NoSidewalk count, date and tag test, and is reported only in `rejected_no_sidewalk_count`
   * (and `label_count`). A face whose every NoSidewalk label was rejected therefore falls through to the next rule,
   * usually `audited_no_labels` → `present`. Confirmed labels (`correct = TRUE`) are counted in
   * `validated_no_sidewalk_count`, the top confidence tier the API exposes. `correct` is the strict majority of the
   * Agree/Disagree votes on the label ([[models.label.LabelTable.addValidationVote]]: self-votes and excluded
   * users' votes never count), so one vote on an otherwise unvalidated label decides it. The tier is human-only
   * because [[models.label.LabelType.aiLabelTypes]] leaves NoSidewalk out of AI validation; AI votes reach
   * `correct` like any other, so adding it there would silently make this an AI-confirmed tier.
   *
   * Labels *and* audits from `user_stat.excluded` contributors are dropped, the population [[models.label.LabelTable.labels]]
   * serves everywhere else. It has to be both: dropping only their labels would leave their audit behind, and an audit with no labels
   * is exactly what calls a face `present` — a banned contributor would flip the very faces they mislabeled.
   * Hand-written, not `FilteredTables`, because it must match evolution 388 exactly.
   */
  val derivationSql: String =
    """WITH face AS (
      |    SELECT street_edge.street_edge_id, sides.street_side
      |    FROM street_edge
      |    CROSS JOIN (VALUES ('left'::street_side), ('right'::street_side)) AS sides(street_side)
      |),
      |sided_label AS (
      |    SELECT label.street_edge_id, label_point.street_side, label.label_type, label.user_id, label.time_created,
      |           label.tags,
      |           label.label_type = 'NoSidewalk' AND label.correct IS DISTINCT FROM FALSE AS counted_no_sidewalk,
      |           label.label_type = 'NoSidewalk' AND label.correct AS validated_no_sidewalk,
      |           label.label_type = 'NoSidewalk' AND NOT label.correct AS rejected_no_sidewalk
      |    FROM label
      |    INNER JOIN label_point ON label.label_id = label_point.label_id
      |    LEFT JOIN user_stat ON label.user_id = user_stat.user_id
      |    WHERE NOT label.deleted AND NOT label.tutorial AND label_point.street_side IS NOT NULL
      |      AND NOT COALESCE(user_stat.excluded, FALSE)
      |),
      |face_label AS (
      |    SELECT street_edge_id, street_side,
      |           COUNT(*) AS label_count,
      |           COUNT(*) FILTER (WHERE counted_no_sidewalk) AS no_sidewalk_label_count,
      |           COUNT(DISTINCT user_id) FILTER (WHERE counted_no_sidewalk) AS no_sidewalk_user_count,
      |           COUNT(*) FILTER (WHERE validated_no_sidewalk) AS validated_no_sidewalk_count,
      |           COUNT(*) FILTER (WHERE rejected_no_sidewalk) AS rejected_no_sidewalk_count,
      |           COUNT(*) FILTER (WHERE counted_no_sidewalk AND 'street has no sidewalks' = ANY(tags))
      |               AS no_sidewalks_tag_count,
      |           MIN(time_created) FILTER (WHERE counted_no_sidewalk) AS first_no_sidewalk_label_at,
      |           MAX(time_created) FILTER (WHERE counted_no_sidewalk) AS last_no_sidewalk_label_at
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
      |           COALESCE(this_face.validated_no_sidewalk_count, 0)::INTEGER AS validated_no_sidewalk_count,
      |           COALESCE(this_face.rejected_no_sidewalk_count, 0)::INTEGER AS rejected_no_sidewalk_count,
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
      |           no_sidewalk_label_count, no_sidewalk_user_count, validated_no_sidewalk_count,
      |           rejected_no_sidewalk_count, label_count, audit_count, first_no_sidewalk_label_at,
      |           last_no_sidewalk_label_at
      |    FROM face_basis
      |)""".stripMargin
}
