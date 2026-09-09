package models.intersection

import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import service.AccessScoreCalculator
import util.{RolledBackDb, StreetFixtures}

import scala.io.Source

/**
 * The derived intersection table (#5095): what the rebuild makes of a street graph, how it keeps ids, and how clusters
 * are attributed to it — against the connected Postgres+PostGIS database, every case inside a rolled-back transaction.
 *
 * The synthetic streets sit in the open ocean (around 10°E, 10°N and 20°E, 20°N), far from any city's data, so the
 * assertions on them cannot be disturbed by whatever the schema already holds. The rebuild still processes the whole
 * table, which is what the evolution-parity case relies on.
 */
class IntersectionTableSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb with StreetFixtures {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val table: IntersectionTable = app.injector.instanceOf[IntersectionTable]

  private val intersectionTypes: Set[String] = AccessScoreCalculator.intersectionTypeNames
  private val radius: Double                 = AccessScoreCalculator.attributionRadiusMeters

  /** One degree of latitude is ~111 km, so this many degrees is about `meters` meters north-south. */
  private def degrees(meters: Double): Double = meters / 111000.0

  /** Seeds an open residential street along the given WKT LineString, returning its id. */
  private def insertStreetAt(wkt: String): DBIO[Int] =
    sql"""INSERT INTO street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, status)
          SELECT (SELECT COALESCE(MAX(street_edge_id), 0) + 1 FROM street_edge), g,
                 ST_X(ST_StartPoint(g)), ST_Y(ST_StartPoint(g)), ST_X(ST_EndPoint(g)), ST_Y(ST_EndPoint(g)),
                 'residential', 'open'
          FROM (SELECT ST_SetSRID(ST_GeomFromText($wkt), 4326) AS g) geom
          RETURNING street_edge_id""".as[Int].head

  private def line(x1: Double, y1: Double, x2: Double, y2: Double): String = s"LINESTRING($x1 $y1, $x2 $y2)"

  /** Maps a street to an OSM way, creating the way with the given tags if it isn't there yet. */
  private def mapToWay(streetEdgeId: Int, osmWayId: Long, tags: String): DBIO[Int] =
    sqlu"""INSERT INTO osm_way (osm_way_id, tags, maxspeed, geom, source, updated_at)
           VALUES ($osmWayId, CAST($tags AS jsonb), NULL, NULL, 'batch', now())
           ON CONFLICT (osm_way_id) DO NOTHING""" andThen
      sqlu"""INSERT INTO osm_way_street_edge (osm_way_street_edge_id, osm_way_id, street_edge_id)
             VALUES ((SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 1 FROM osm_way_street_edge),
                     $osmWayId, $streetEdgeId)"""

  /** Maps a street to a way that is gone from OSM and whose tags were blanked before #5244 kept them: layer unknown. */
  private def mapToMissingWay(streetEdgeId: Int, osmWayId: Long): DBIO[Int] =
    sqlu"""INSERT INTO osm_way (osm_way_id, tags, maxspeed, geom, source, updated_at, missing_since)
           VALUES ($osmWayId, CAST('{}' AS jsonb), NULL, NULL, 'batch', now(), now())
           ON CONFLICT (osm_way_id) DO NOTHING""" andThen
      sqlu"""INSERT INTO osm_way_street_edge (osm_way_street_edge_id, osm_way_id, street_edge_id)
             VALUES ((SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 1 FROM osm_way_street_edge),
                     $osmWayId, $streetEdgeId)"""

  private def insertSession(regionId: Int): DBIO[Int] =
    sql"""INSERT INTO clustering_session (clustering_session_id, region_id, thresholds, timestamp)
          VALUES ((SELECT COALESCE(MAX(clustering_session_id), 0) + 1 FROM clustering_session), $regionId,
                  CAST('[]' AS jsonb), now())
          RETURNING clustering_session_id""".as[Int].head

  private def insertCluster(sessionId: Int, streetEdgeId: Int, labelType: String, lng: Double, lat: Double): DBIO[Int] =
    sql"""INSERT INTO cluster (cluster_id, clustering_session_id, label_type, street_edge_id, geom, severity)
          VALUES ((SELECT COALESCE(MAX(cluster_id), 0) + 1 FROM cluster), $sessionId,
                  CAST($labelType AS label_type), $streetEdgeId, ST_SetSRID(ST_MakePoint($lng, $lat), 4326), NULL)
          RETURNING cluster_id""".as[Int].head

  private def clusterIntersection(clusterId: Int): DBIO[Option[Int]] =
    sql"SELECT intersection_id FROM cluster WHERE cluster_id = $clusterId".as[Option[Int]].head

  /** The intersections within a meter of a point: (id, degree, grade_separated, region_id). */
  private def intersectionsNear(lng: Double, lat: Double): DBIO[Seq[(Int, Int, Boolean, Option[Int])]] =
    sql"""SELECT intersection_id, degree, grade_separated, region_id
          FROM intersection
          WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint($lng, $lat), 4326), 0.00001)
          ORDER BY intersection_id""".as[(Int, Int, Boolean, Option[Int])]

  private def linksOf(intersectionId: Int): DBIO[Seq[(Int, String)]] =
    sql"""SELECT street_edge_id, street_end FROM intersection_street_edge
          WHERE intersection_id = $intersectionId ORDER BY street_edge_id, street_end""".as[(Int, String)]

  /** A four-way cross at (x, y) with 100 m arms, returning the four street ids (E, W, N, S). */
  private def fourWay(x: Double, y: Double): DBIO[Seq[Int]] = {
    val arm = 0.001
    DBIO.sequence(
      Seq(
        insertStreetAt(line(x, y, x + arm, y)),
        insertStreetAt(line(x, y, x - arm, y)),
        insertStreetAt(line(x, y, x, y + arm)),
        insertStreetAt(line(x, y, x, y - arm))
      )
    )
  }

  "the intersection rebuild" should {
    "reproduce exactly what evolution 381 populated, so the two copies of the derivation agree" in {
      // The evolution's data statements, run on the schema as it stands, then the Scala rebuild over the same
      // streets: a derivation that drifted would insert, update, or delete something.
      val ups: String = {
        val source = Source.fromFile("conf/evolutions/default/381.sql", "UTF-8")
        try source.mkString.split("# --- !Downs").head
        finally source.close()
      }
      val dataStatements: Seq[String] = ups
        .split("(?<!;);(?!;)")
        .map(_.linesIterator.filterNot(_.trim.startsWith("--")).mkString("\n").trim)
        .filter(st => st.startsWith("WITH") || st.startsWith("UPDATE"))
        .toSeq
      dataStatements must have size 2

      val counts = runRolledBack(for {
        _          <- sqlu"UPDATE cluster SET intersection_id = NULL"
        _          <- sqlu"DELETE FROM intersection_street_edge"
        _          <- sqlu"DELETE FROM intersection"
        _          <- DBIO.sequence(dataStatements.map(st => sqlu"#$st"))
        populated  <- sql"SELECT COUNT(*) FROM intersection".as[Int].head
        rebuilt    <- table.rebuild
        attributed <- table.attributeClusters(intersectionTypes, radius, None)
      } yield (populated, rebuilt, attributed))

      val (populated, rebuilt, attributed) = counts
      rebuilt.total mustBe populated
      rebuilt.inserted mustBe 0
      rebuilt.updated mustBe 0
      rebuilt.deleted mustBe 0
      attributed mustBe 0
    }

    "derive a four-way cross as one degree-4 node, and leave way splits and dead ends alone" in {
      val (near, splitNear, endNear) = runRolledBack(for {
        arms <- fourWay(10.0, 10.0)
        // A continuation east of the east arm: the shared endpoint is a way split, not an intersection.
        _   <- insertStreetAt(line(10.001, 10.0, 10.002, 10.0))
        _   <- table.rebuild
        n   <- intersectionsNear(10.0, 10.0)
        s   <- intersectionsNear(10.001, 10.0)
        e   <- intersectionsNear(10.002, 10.0)
        lnk <- if (n.nonEmpty) linksOf(n.head._1) else DBIO.successful(Seq.empty)
      } yield {
        n must have size 1
        lnk.map(_._1) must contain theSameElementsAs arms
        lnk.map(_._2).toSet mustBe Set("start")
        (n, s, e)
      })
      near.head._2 mustBe 4
      near.head._3 mustBe false
      splitNear mustBe empty
      endNear mustBe empty
    }

    "merge endpoints within a meter into one node, excluding a sliver edge that lies inside it" in {
      runRolledBack(for {
        arms <- fourWay(10.0, 10.0)
        // A 0.6 m sliver from the cross, then a street leaving from its far end: five streets meet, not six.
        sliver <- insertStreetAt(line(10.0, 10.0, 10.000005, 10.000003))
        fifth  <- insertStreetAt(line(10.000005, 10.000003, 10.001, 10.001))
        _      <- table.rebuild
        near   <- intersectionsNear(10.0, 10.0)
        links  <- linksOf(near.head._1)
      } yield {
        near must have size 1
        near.head._2 mustBe 5
        links.map(_._1) must contain theSameElementsAs (arms :+ fifth)
        links.map(_._1) must not contain sliver
      })
    }

    "flag a bridge passing over a road as grade-separated, but not a bridge ending at a real intersection, nor one over a road whose way is gone from OSM" in {
      runRolledBack(for {
        b1 <- insertStreetAt(line(19.999, 20.0, 20.0, 20.0))
        b2 <- insertStreetAt(line(20.0, 20.0, 20.001, 20.0))
        r1 <- insertStreetAt(line(20.0, 19.999, 20.0, 20.0))
        r2 <- insertStreetAt(line(20.0, 20.0, 20.0, 20.001))
        _  <- mapToWay(b1, 9000000001L, """{"highway": "primary", "bridge": "yes", "layer": "1"}""")
        _  <- mapToWay(b2, 9000000001L, """{"highway": "primary", "bridge": "yes", "layer": "1"}""")
        _  <- mapToWay(r1, 9000000002L, """{"highway": "residential"}""")
        _  <- mapToWay(r2, 9000000002L, """{"highway": "residential"}""")
        // At (21, 21) the bridge way ends: an abutment, a real T.
        a1 <- insertStreetAt(line(20.999, 21.0, 21.0, 21.0))
        c1 <- insertStreetAt(line(21.0, 20.999, 21.0, 21.0))
        c2 <- insertStreetAt(line(21.0, 21.0, 21.0, 21.001))
        _  <- mapToWay(a1, 9000000003L, """{"highway": "primary", "bridge": "yes"}""")
        _  <- mapToWay(c1, 9000000004L, """{"highway": "residential"}""")
        _  <- mapToWay(c2, 9000000004L, """{"highway": "residential"}""")
        // A garbage layer tag at (22, 22) is ignored rather than aborting the rebuild.
        g1     <- insertStreetAt(line(21.999, 22.0, 22.0, 22.0))
        g2     <- insertStreetAt(line(22.0, 22.0, 22.001, 22.0))
        h1     <- insertStreetAt(line(22.0, 21.999, 22.0, 22.0))
        h2     <- insertStreetAt(line(22.0, 22.0, 22.0, 22.001))
        _      <- mapToWay(g1, 9000000005L, """{"highway": "primary", "layer": "1;2"}""")
        _      <- mapToWay(g2, 9000000005L, """{"highway": "primary", "layer": "1;2"}""")
        _      <- mapToWay(h1, 9000000006L, """{"highway": "residential"}""")
        _      <- mapToWay(h2, 9000000006L, """{"highway": "residential"}""")
        // At (23, 23) a bridge crosses a road whose way died in OSM before its tags were kept (#5244): the road's layer
        // is unknown, so it cannot vote, and the node stays unflagged until the tags are backfilled.
        k1      <- insertStreetAt(line(22.999, 23.0, 23.0, 23.0))
        k2      <- insertStreetAt(line(23.0, 23.0, 23.001, 23.0))
        m1      <- insertStreetAt(line(23.0, 22.999, 23.0, 23.0))
        m2      <- insertStreetAt(line(23.0, 23.0, 23.0, 23.001))
        _       <- mapToWay(k1, 9000000007L, """{"highway": "primary", "bridge": "yes", "layer": "1"}""")
        _       <- mapToWay(k2, 9000000007L, """{"highway": "primary", "bridge": "yes", "layer": "1"}""")
        _       <- mapToMissingWay(m1, 9000000008L)
        _       <- mapToMissingWay(m2, 9000000008L)
        _       <- table.rebuild
        bridge  <- intersectionsNear(20.0, 20.0)
        abut    <- intersectionsNear(21.0, 21.0)
        garble  <- intersectionsNear(22.0, 22.0)
        unknown <- intersectionsNear(23.0, 23.0)
      } yield {
        bridge.map(n => (n._2, n._3)) mustBe Seq((4, true))
        abut.map(n => (n._2, n._3)) mustBe Seq((3, false))
        garble.map(n => (n._2, n._3)) mustBe Seq((4, false))
        unknown.map(n => (n._2, n._3)) mustBe Seq((4, false))
      })
    }

    "assign the region most of a node's streets are in" in {
      runRolledBack(for {
        regionA <- insertRegion()
        regionB <- insertRegion()
        arms    <- fourWay(10.0, 10.0)
        _       <- putInRegion(arms(0), regionA)
        _       <- putInRegion(arms(1), regionA)
        _       <- putInRegion(arms(2), regionA)
        _       <- putInRegion(arms(3), regionB)
        _       <- table.rebuild
        near    <- intersectionsNear(10.0, 10.0)
      } yield near.map(_._4) mustBe Seq(Some(regionA)))
    }

    "keep ids across rebuilds, and delete a node the streets no longer make" in {
      runRolledBack(for {
        arms   <- fourWay(10.0, 10.0)
        first  <- table.rebuild
        before <- intersectionsNear(10.0, 10.0)
        second <- table.rebuild
        after  <- intersectionsNear(10.0, 10.0)
        _      <- sqlu"DELETE FROM street_edge WHERE street_edge_id IN (${arms(1)}, ${arms(2)}, ${arms(3)})"
        third  <- table.rebuild
        gone   <- intersectionsNear(10.0, 10.0)
      } yield {
        first.inserted must be >= 1
        after.map(_._1) mustBe before.map(_._1)
        second.inserted mustBe 0
        second.deleted mustBe 0
        third.deleted must be >= 1
        gone mustBe empty
      })
    }
  }

  "cluster attribution" should {
    "attach a corner-type cluster within the radius to its nearest intersection, and nothing beyond it" in {
      runRolledBack(for {
        region  <- insertRegion()
        arms    <- fourWay(10.0, 10.0)
        _       <- putInRegion(arms(0), region)
        session <- insertSession(region)
        _       <- table.rebuild
        near    <- intersectionsNear(10.0, 10.0)
        // 20 m north of the node: attached. 30 m: not. An obstacle at 5 m: never, wrong type.
        ramp     <- insertCluster(session, arms(2), "CurbRamp", 10.0, 10.0 + degrees(20))
        farRamp  <- insertCluster(session, arms(2), "NoCurbRamp", 10.0, 10.0 + degrees(30))
        obstacle <- insertCluster(session, arms(2), "Obstacle", 10.0, 10.0 + degrees(5))
        changed  <- table.attributeClusters(intersectionTypes, radius, Some(session))
        r        <- clusterIntersection(ramp)
        f        <- clusterIntersection(farRamp)
        o        <- clusterIntersection(obstacle)
        // Nothing changed since, so a second pass rewrites nothing.
        again <- table.attributeClusters(intersectionTypes, radius, Some(session))
      } yield {
        changed mustBe 1
        r mustBe Some(near.head._1)
        f mustBe None
        o mustBe None
        again mustBe 0
      })
    }

    "never attach to a grade-separated node, and only touch the session it is scoped to" in {
      runRolledBack(for {
        region      <- insertRegion()
        b1          <- insertStreetAt(line(19.999, 20.0, 20.0, 20.0))
        b2          <- insertStreetAt(line(20.0, 20.0, 20.001, 20.0))
        r1          <- insertStreetAt(line(20.0, 19.999, 20.0, 20.0))
        r2          <- insertStreetAt(line(20.0, 20.0, 20.0, 20.001))
        _           <- mapToWay(b1, 9000000011L, """{"bridge": "yes"}""")
        _           <- mapToWay(b2, 9000000011L, """{"bridge": "yes"}""")
        _           <- mapToWay(r1, 9000000012L, """{}""")
        _           <- mapToWay(r2, 9000000012L, """{}""")
        arms        <- fourWay(10.0, 10.0)
        _           <- table.rebuild
        real        <- intersectionsNear(10.0, 10.0)
        s1          <- insertSession(region)
        s2          <- insertSession(region)
        underBridge <- insertCluster(s1, r2, "CurbRamp", 20.0, 20.0 + degrees(5))
        inS1        <- insertCluster(s1, arms(0), "Crosswalk", 10.0 + degrees(5), 10.0)
        inS2        <- insertCluster(s2, arms(0), "Crosswalk", 10.0 + degrees(6), 10.0)
        changed     <- table.attributeClusters(intersectionTypes, radius, Some(s1))
        ub          <- clusterIntersection(underBridge)
        a           <- clusterIntersection(inS1)
        b           <- clusterIntersection(inS2)
        all         <- table.attributeClusters(intersectionTypes, radius, None)
        b2Attr      <- clusterIntersection(inS2)
      } yield {
        changed mustBe 1
        ub mustBe None
        a mustBe Some(real.head._1)
        b mustBe None
        all must be >= 1
        b2Attr mustBe Some(real.head._1)
      })
    }

    "detach a cluster whose node the rebuild deletes, then re-attach it where it now belongs" in {
      runRolledBack(for {
        region  <- insertRegion()
        arms    <- fourWay(10.0, 10.0)
        session <- insertSession(region)
        _       <- table.rebuild
        ramp    <- insertCluster(session, arms(0), "CurbRamp", 10.0 + degrees(3), 10.0)
        _       <- table.attributeClusters(intersectionTypes, radius, Some(session))
        before  <- clusterIntersection(ramp)
        _       <- sqlu"DELETE FROM street_edge WHERE street_edge_id IN (${arms(1)}, ${arms(2)}, ${arms(3)})"
        _       <- table.rebuild
        after   <- clusterIntersection(ramp)
        changed <- table.attributeClusters(intersectionTypes, radius, None)
        end     <- clusterIntersection(ramp)
      } yield {
        before mustBe defined
        after mustBe None
        changed mustBe 0
        end mustBe None
      })
    }
  }
}
