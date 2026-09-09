package models.intersection

import com.google.inject.ImplementedBy
import models.region.RegionTableDef
import models.street.StreetEdgeTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import models.utils.SpatialQueryType.SpatialQueryType
import models.utils.{LatLngBBox, SpatialQueryType}
import org.locationtech.jts.geom.Point
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.jdbc.GetResult

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

/**
 * A place where three or more streets meet, derived from the street graph (#5095).
 *
 * @param intersectionId Identifier. Stable across nightly rebuilds unless the node moves more than a meter.
 * @param geom           The centroid of the merged street endpoints.
 * @param degree         How many distinct streets meet here (always >= 3; a CHECK in the DB).
 * @param gradeSeparated Whether this is a bridge or tunnel crossing the street import planarized into a false
 *                       intersection: two ways pass through the node on different OSM layers. Such a node scores
 *                       nothing and receives no clusters.
 * @param regionId       The region most of the node's streets are in, or None if none of them is in one.
 */
case class Intersection(intersectionId: Int, geom: Point, degree: Int, gradeSeparated: Boolean, regionId: Option[Int])

/** Which end of a street meets an intersection. */
object StreetEnd {
  val Start: String = "start"
  val End: String   = "end"
}

/**
 * One street's end meeting one intersection.
 *
 * @param streetEnd `start` or `end` ([[StreetEnd]]), which end of the street's geometry sits at the intersection. A
 *                  street has at most one row per intersection: an edge with both ends in one node is a sliver
 *                  inside it (Seattle's 865 such edges are 0–0.8 m long) and the derivation drops it.
 */
case class IntersectionStreetEdge(
    intersectionStreetEdgeId: Int,
    intersectionId: Int,
    streetEdgeId: Int,
    streetEnd: String
)

/**
 * An intersection with what AccessScore needs to score it (#5095).
 *
 * @param streetEdgeIds Every street meeting here, in ascending id order.
 * @param auditCount    Completed high-quality audits summed over those streets, wherever they lie: an intersection is
 *                      scorable as soon as one street touching it has been audited.
 */
case class IntersectionInfo(
    intersectionId: Int,
    geom: Point,
    degree: Int,
    gradeSeparated: Boolean,
    regionId: Option[Int],
    streetEdgeIds: Seq[Int],
    auditCount: Int
)

/** A street's end and the intersection it meets, the link a street's `start_intersection_id` / `end_intersection_id` come from. */
case class IntersectionStreetEnd(streetEdgeId: Int, streetEnd: String, intersectionId: Int)

/** What a rebuild did to the `intersection` table. `total` is the row count afterwards. */
case class IntersectionRebuildCounts(total: Int, inserted: Int, updated: Int, deleted: Int)

class IntersectionTableDef(tag: Tag) extends Table[Intersection](tag, "intersection") {
  def intersectionId: Rep[Int]     = column[Int]("intersection_id", O.PrimaryKey, O.AutoInc)
  def geom: Rep[Point]             = column[Point]("geom")
  def degree: Rep[Int]             = column[Int]("degree") // CHECK (degree >= 3) in the DB.
  def gradeSeparated: Rep[Boolean] = column[Boolean]("grade_separated", O.Default(false))
  def regionId: Rep[Option[Int]]   = column[Option[Int]]("region_id")

  def * = (intersectionId, geom, degree, gradeSeparated, regionId) <> (
    (Intersection.apply _).tupled,
    Intersection.unapply
  )

  def region = foreignKey("intersection_region_id_fkey", regionId, TableQuery[RegionTableDef])(_.regionId.?)
}

class IntersectionStreetEdgeTableDef(tag: Tag) extends Table[IntersectionStreetEdge](tag, "intersection_street_edge") {
  def intersectionStreetEdgeId: Rep[Int] = column[Int]("intersection_street_edge_id", O.PrimaryKey, O.AutoInc)
  def intersectionId: Rep[Int]           = column[Int]("intersection_id")
  def streetEdgeId: Rep[Int]             = column[Int]("street_edge_id")
  def streetEnd: Rep[String] = column[String]("street_end") // CHECK (street_end IN ('start', 'end')) in the DB.

  def * = (intersectionStreetEdgeId, intersectionId, streetEdgeId, streetEnd) <> (
    (IntersectionStreetEdge.apply _).tupled,
    IntersectionStreetEdge.unapply
  )

  def intersection =
    foreignKey("intersection_street_edge_intersection_id_fkey", intersectionId, TableQuery[IntersectionTableDef])(
      _.intersectionId,
      onDelete = ForeignKeyAction.Cascade
    )
  def streetEdge =
    foreignKey("intersection_street_edge_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(
      _.streetEdgeId,
      onDelete = ForeignKeyAction.Cascade
    )
  def streetEndUnique =
    index("intersection_street_edge_street_edge_id_street_end_key", (streetEdgeId, streetEnd), unique = true)
}

@ImplementedBy(classOf[IntersectionTable])
trait IntersectionTableRepository {

  /**
   * Re-derives the intersections from the current street graph, keeping ids where the node is still there.
   *
   * Compose inside a transaction (the temp tables it uses drop on commit). Rows within a meter of a derived node are
   * updated in place, new nodes inserted, vanished ones deleted (which cascades their links and detaches their
   * clusters via ON DELETE SET NULL), and the street links rewritten.
   */
  def rebuild: DBIO[IntersectionRebuildCounts]

  /**
   * Points each cluster of the given types at the nearest non-grade-separated intersection within the radius, or at
   * none, and returns how many rows that changed.
   *
   * @param labelTypes   The corner-feature types (the engine's intersection types); other types are left alone.
   * @param radiusMeters The attribution radius, geodesic.
   * @param sessionId    Restrict to one clustering session's clusters (a region's fresh swap), or None for all.
   */
  def attributeClusters(labelTypes: Set[String], radiusMeters: Double, sessionId: Option[Int]): DBIO[Int]

  /**
   * The intersections at the ends of the streets the bbox/region filter selects, with everything needed to score them.
   *
   * The filter picks the streets exactly as `StreetEdgeTable.selectStreetsIntersecting` does; the intersections at
   * their ends come back whether or not the node itself lies inside the bbox, and their audit counts sum over every
   * incident street, in or out of it.
   */
  def getIntersectionsForStreets(spatialQueryType: SpatialQueryType, bbox: LatLngBBox): DBIO[Seq[IntersectionInfo]]

  /** The (street end → intersection) links of the streets the bbox/region filter selects. */
  def getStreetEnds(spatialQueryType: SpatialQueryType, bbox: LatLngBBox): DBIO[Seq[IntersectionStreetEnd]]
}

/**
 * The derived intersections of the street graph and their links to streets and clusters (#5095).
 *
 * The derivation is raw SQL held once in [[IntersectionTable.derivationSql]]; evolution 380 carries a pasted copy for
 * the one-time population of existing cities, and `IntersectionTableSpec` checks the two still agree.
 */
@Singleton
class IntersectionTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit
    ec: ExecutionContext
) extends IntersectionTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val intersections: TableQuery[IntersectionTableDef]                     = TableQuery[IntersectionTableDef]
  val intersectionStreetEdges: TableQuery[IntersectionStreetEdgeTableDef] = TableQuery[IntersectionStreetEdgeTableDef]

  implicit val intersectionInfoConverter: GetResult[IntersectionInfo] = GetResult[IntersectionInfo] { r =>
    IntersectionInfo(
      intersectionId = r.nextInt(),
      geom = r.nextGeometry[Point](),
      degree = r.nextInt(),
      gradeSeparated = r.nextBoolean(),
      regionId = r.nextIntOption(),
      streetEdgeIds = r.nextString().split(",").filter(_.nonEmpty).map(_.toInt).toSeq,
      auditCount = r.nextInt()
    )
  }

  implicit val intersectionStreetEndConverter: GetResult[IntersectionStreetEnd] = GetResult[IntersectionStreetEnd] {
    r => IntersectionStreetEnd(r.nextInt(), r.nextString(), r.nextInt())
  }

  def rebuild: DBIO[IntersectionRebuildCounts] = {
    for {
      // A second rebuild in one transaction (a spec's, or a retry) must not trip over the first one's temp tables.
      _ <- sqlu"""DROP TABLE IF EXISTS derived_end, derived_node, node_match"""
      // Evaluated once; the derivation is what the evolution ran.
      _ <- sqlu"""CREATE TEMP TABLE derived_end ON COMMIT DROP AS
                  #${IntersectionTable.derivationSql}
                  SELECT member.node_group, member.street_edge_id, member.street_end, node.geom, node.degree,
                         COALESCE(node_grade.grade_separated, FALSE) AS grade_separated, node_region.region_id
                  FROM member
                  INNER JOIN node ON member.node_group = node.node_group
                  LEFT JOIN node_grade ON node.node_group = node_grade.node_group
                  LEFT JOIN node_region ON node.node_group = node_region.node_group"""
      _ <- sqlu"""CREATE TEMP TABLE derived_node ON COMMIT DROP AS
                  SELECT DISTINCT node_group, geom, degree, grade_separated, region_id FROM derived_end"""
      // Match each derived node to the one existing row within a meter, nearest first, each row claimed once.
      _ <- sqlu"""CREATE TEMP TABLE node_match ON COMMIT DROP AS
                  SELECT DISTINCT ON (intersection_id) node_group, intersection_id
                  FROM (
                      SELECT DISTINCT ON (derived_node.node_group)
                             derived_node.node_group, intersection.intersection_id,
                             ST_Distance(intersection.geom, derived_node.geom) AS dist
                      FROM derived_node
                      INNER JOIN intersection ON ST_DWithin(intersection.geom, derived_node.geom, 0.00001)
                      ORDER BY derived_node.node_group, dist
                  ) nearest
                  ORDER BY intersection_id, dist"""
      updated <- sqlu"""UPDATE intersection
                        SET geom = derived_node.geom, degree = derived_node.degree,
                            grade_separated = derived_node.grade_separated, region_id = derived_node.region_id
                        FROM derived_node
                        INNER JOIN node_match ON derived_node.node_group = node_match.node_group
                        WHERE intersection.intersection_id = node_match.intersection_id
                          AND (NOT (intersection.geom = derived_node.geom)
                               OR intersection.degree <> derived_node.degree
                               OR intersection.grade_separated <> derived_node.grade_separated
                               OR intersection.region_id IS DISTINCT FROM derived_node.region_id)"""
      // Vanished nodes go before new ones arrive: the match was taken against the rows that existed, so a row
      // inserted below has no match and would be deleted straight back out.
      deleted <- sqlu"""DELETE FROM intersection
                        WHERE NOT EXISTS (SELECT 1 FROM node_match WHERE node_match.intersection_id = intersection.intersection_id)"""
      inserted <- sqlu"""INSERT INTO intersection (geom, degree, grade_separated, region_id)
                         SELECT geom, degree, grade_separated, region_id
                         FROM derived_node
                         WHERE NOT EXISTS (SELECT 1 FROM node_match WHERE node_match.node_group = derived_node.node_group)"""
      // Every surviving row now has exactly a derived node's geometry, so the links rebuild by geometry.
      _ <- sqlu"""DELETE FROM intersection_street_edge"""
      _ <- sqlu"""INSERT INTO intersection_street_edge (intersection_id, street_edge_id, street_end)
                  SELECT intersection.intersection_id, derived_end.street_edge_id, derived_end.street_end
                  FROM derived_end
                  INNER JOIN intersection ON intersection.geom = derived_end.geom"""
      total <- intersections.length.result
    } yield IntersectionRebuildCounts(total = total, inserted = inserted, updated = updated, deleted = deleted)
  }

  def attributeClusters(labelTypes: Set[String], radiusMeters: Double, sessionId: Option[Int]): DBIO[Int] = {
    if (labelTypes.isEmpty) DBIO.successful(0)
    else {
      val typeFilter: String    = labelTypes.toSeq.sorted.map(t => s"'${t.replace("'", "''")}'").mkString(", ")
      val sessionFilter: String = sessionId.fold("")(id => s"AND cluster.clustering_session_id = $id")
      // The degree box is the index prefilter and must contain the geodesic radius anywhere a city sits: 0.0005 deg
      // covers 25 m up to ~63 deg latitude, so scale it with the radius from that same footing.
      val boxDegrees: Double = 0.0005 * math.max(1.0, radiusMeters / 25.0)
      sqlu"""UPDATE cluster
             SET intersection_id = nearest.intersection_id
             FROM (
                 SELECT cluster.cluster_id, candidate.intersection_id
                 FROM cluster
                 LEFT JOIN LATERAL (
                     SELECT intersection.intersection_id
                     FROM intersection
                     WHERE NOT intersection.grade_separated
                       AND ST_DWithin(intersection.geom, cluster.geom, $boxDegrees)
                       AND ST_DWithin(intersection.geom::geography, cluster.geom::geography, $radiusMeters)
                     ORDER BY ST_Distance(intersection.geom::geography, cluster.geom::geography)
                     LIMIT 1
                 ) candidate ON TRUE
                 WHERE cluster.label_type IN (#$typeFilter) #$sessionFilter
             ) nearest
             WHERE cluster.cluster_id = nearest.cluster_id
               AND cluster.intersection_id IS DISTINCT FROM nearest.intersection_id"""
    }
  }

  /**
   * The streets a bbox/region filter selects, as `StreetEdgeTable.selectStreetsIntersecting` selects them (it builds on
   * the open, non-tutorial `streets` query): open, not the tutorial street, in a region, and intersecting the bbox (or
   * in a region within it). It must stay identical to that query: `AccessScoreService` joins streets, their ends, and
   * clusters by id, so a street scored there but omitted here would have no intersections and its corner clusters
   * would score nothing. `ClusterTable.getClusterScoreRows` scopes clusters more widely (any status); its extra rows
   * belong to no scored unit and are dropped.
   */
  private def inScopeStreetsSql(spatialQueryType: SpatialQueryType, bbox: LatLngBBox): String = {
    val envelope: String = s"ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326)"
    val locationFilter: String =
      if (spatialQueryType == SpatialQueryType.Region) s"ST_Within(region.geom, $envelope)"
      else s"ST_Intersects(street_edge.geom, $envelope)"
    s"""SELECT street_edge.street_edge_id
       |FROM street_edge
       |INNER JOIN street_edge_region ON street_edge.street_edge_id = street_edge_region.street_edge_id
       |INNER JOIN region ON street_edge_region.region_id = region.region_id
       |WHERE street_edge.status = 'open'
       |  AND street_edge.street_edge_id NOT IN (SELECT tutorial_street_edge_id FROM config)
       |  AND $locationFilter""".stripMargin
  }

  def getIntersectionsForStreets(spatialQueryType: SpatialQueryType, bbox: LatLngBBox): DBIO[Seq[IntersectionInfo]] = {
    val inScope: String = inScopeStreetsSql(spatialQueryType, bbox)
    // Audits are counted per incident street, and each street links to a node once (the derivation drops any edge
    // with both ends in one node), so the DISTINCT is a guard on that invariant rather than a working de-duplication.
    sql"""SELECT intersection.intersection_id,
                 intersection.geom,
                 intersection.degree,
                 intersection.grade_separated,
                 intersection.region_id,
                 array_to_string(array_agg(incident.street_edge_id ORDER BY incident.street_edge_id), ','),
                 COALESCE(SUM(audits.audit_count), 0)::INTEGER
          FROM intersection
          INNER JOIN (
              SELECT DISTINCT intersection_id, street_edge_id FROM intersection_street_edge
          ) incident ON intersection.intersection_id = incident.intersection_id
          LEFT JOIN (
              SELECT audit_task.street_edge_id, COUNT(*) AS audit_count
              FROM audit_task
              INNER JOIN user_stat ON audit_task.user_id = user_stat.user_id
              WHERE audit_task.completed AND user_stat.high_quality
              GROUP BY audit_task.street_edge_id
          ) audits ON incident.street_edge_id = audits.street_edge_id
          WHERE intersection.intersection_id IN (
              SELECT intersection_street_edge.intersection_id
              FROM intersection_street_edge
              WHERE intersection_street_edge.street_edge_id IN (#$inScope)
          )
          GROUP BY intersection.intersection_id
          ORDER BY intersection.intersection_id""".as[IntersectionInfo]
  }

  def getStreetEnds(spatialQueryType: SpatialQueryType, bbox: LatLngBBox): DBIO[Seq[IntersectionStreetEnd]] = {
    val inScope: String = inScopeStreetsSql(spatialQueryType, bbox)
    sql"""SELECT street_edge_id, street_end, intersection_id
          FROM intersection_street_edge
          WHERE street_edge_id IN (#$inScope)""".as[IntersectionStreetEnd]
  }
}

object IntersectionTable {

  /**
   * The derivation of intersections from the street graph, as a `WITH` prefix defining `member` (each street end at a
   * node, minus sliver edges), `node` (each node of degree >= 3 with its centroid), `node_region`, and `node_grade`.
   * Held once so [[IntersectionTable.rebuild]] and the specs use exactly what evolution 380 ran; see that file for
   * the reasoning behind each step.
   */
  val derivationSql: String =
    """WITH endpoint AS (
      |    SELECT street_edge_id, 'start' AS street_end, ST_StartPoint(geom) AS pt FROM street_edge
      |    UNION ALL
      |    SELECT street_edge_id, 'end' AS street_end, ST_EndPoint(geom) AS pt FROM street_edge
      |),
      |grouped AS (
      |    SELECT street_edge_id, street_end, pt,
      |           ST_ClusterDBSCAN(pt, eps := 0.00001, minpoints := 1) OVER () AS node_group
      |    FROM endpoint
      |),
      |member AS (
      |    SELECT node_group, street_edge_id, street_end, pt
      |    FROM (
      |        SELECT grouped.*, COUNT(*) OVER (PARTITION BY node_group, street_edge_id) AS ends_in_group
      |        FROM grouped
      |    ) counted
      |    WHERE ends_in_group = 1
      |),
      |node AS (
      |    SELECT node_group, ST_Centroid(ST_Collect(pt)) AS geom, COUNT(*) AS degree
      |    FROM member
      |    GROUP BY node_group
      |    HAVING COUNT(*) >= 3
      |),
      |node_region AS (
      |    SELECT member.node_group, MODE() WITHIN GROUP (ORDER BY street_edge_region.region_id) AS region_id
      |    FROM member
      |    INNER JOIN street_edge_region ON member.street_edge_id = street_edge_region.street_edge_id
      |    GROUP BY member.node_group
      |),
      |way_layer AS (
      |    SELECT member.node_group,
      |           COALESCE(osm_way_street_edge.osm_way_id, -member.street_edge_id) AS way_key,
      |           COUNT(*) AS edges_at_node,
      |           CASE WHEN osm_way.tags ->> 'layer' ~ '^-?[0-9]+$' THEN (osm_way.tags ->> 'layer')::INTEGER
      |                WHEN COALESCE(osm_way.tags ->> 'bridge', 'no') <> 'no' THEN 1
      |                WHEN COALESCE(osm_way.tags ->> 'tunnel', 'no') <> 'no' THEN -1
      |                ELSE 0 END AS layer
      |    FROM member
      |    LEFT JOIN osm_way_street_edge ON member.street_edge_id = osm_way_street_edge.street_edge_id
      |    LEFT JOIN osm_way ON osm_way_street_edge.osm_way_id = osm_way.osm_way_id
      |    GROUP BY member.node_group, way_key, layer
      |),
      |node_grade AS (
      |    SELECT node_group, COUNT(DISTINCT layer) FILTER (WHERE edges_at_node >= 2) >= 2 AS grade_separated
      |    FROM way_layer
      |    GROUP BY node_group
      |)""".stripMargin
}
