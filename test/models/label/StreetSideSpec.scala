package models.label

import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.{Coordinate, GeometryFactory, PrecisionModel}
import org.scalatest.OptionValues
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import slick.basic.DatabaseConfig
import slick.dbio.DBIO

import scala.concurrent.Await
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.DurationInt

/**
 * DB-backed tests locking in a label's side of the street (#2886): `label_point.centerline_offset_m`, positive on the
 * LEFT of the edge's digitized direction, and the GENERATED `street_side` with its 1 m floor. Three city-agnostic layers:
 *   1. Known geometry through the SQL function: a synthetic west-to-east street with points north (left) and south
 *      (right), on the line, inside the floor, the same street reversed (the sign follows the digitized direction, not
 *      the compass), and a bent street (the sign follows the local tangent, not the chord). Magnitudes are checked
 *      against PostGIS's geodesic distance, so a projected magnitude fails.
 *   2. The insert path, `LabelPointTable.insert` then `computeCenterlineOffset`, inside a rolled-back transaction.
 *   3. Cache freshness: every stored offset equals a fresh call of the function, the postcondition 374's backfill
 *      promises and the contract any later reposition must keep (`docs/evolutions.md`). Needs a seeded DB, so it
 *      `assume`s label_point is non-empty and cancels otherwise, the `GeodesicDistanceSpec` convention.
 */
class StreetSideSpec extends PlaySpec with GuiceOneAppPerSuite with OptionValues {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val labelPointTable = app.injector.instanceOf[LabelPointTable]
  // Typed explicitly: letting `.db` infer here yields an existential type the compiler rejects under -Xfatal-warnings.
  private val dbConfig: DatabaseConfig[MyPostgresProfile] =
    app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private val gf = new GeometryFactory(new PrecisionModel(), 4326)

  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 120.seconds)

  private case class RollbackWithResult(result: Any) extends RuntimeException with scala.util.control.NoStackTrace

  /** Runs `action` inside a transaction that is ALWAYS rolled back, returning its result. */
  private def runRolledBack[T](action: DBIO[T]): T = {
    val alwaysRollback = action.flatMap(r => DBIO.failed(RollbackWithResult(r))).transactionally
    Await.result(
      dbConfig.db.run(alwaysRollback).recover { case RollbackWithResult(r) => r.asInstanceOf[T] },
      120.seconds
    )
  }

  // A 100 m west-to-east street at Seattle's latitude, as WKT, and its reverse. The point fixtures sit at its midpoint
  // longitude, offset north or south by a chosen number of metres of latitude.
  private val Lat             = 47.6
  private val MidLng          = -122.2995
  private val WestToEast      = "LINESTRING(-122.3 47.6, -122.299 47.6)"
  private val EastToWest      = "LINESTRING(-122.299 47.6, -122.3 47.6)"
  private val MetersPerDegLat = 110574.0

  private def pointWkt(lng: Double, lat: Double) = s"POINT($lng $lat)"
  private def north(metres: Double): String      = pointWkt(MidLng, Lat + metres / MetersPerDegLat)

  /** The signed offset and the geodesic distance PostGIS reports for the same point and line. */
  private def offsetAndDistance(point: String, line: String): (Option[Double], Double) =
    run(
      sql"""SELECT label_centerline_offset_m(ST_GeomFromText($point, 4326), ST_GeomFromText($line, 4326)),
                     ST_Distance(ST_GeomFromText($point, 4326)::geography, ST_GeomFromText($line, 4326)::geography)"""
        .as[(Option[Double], Double)]
        .head
    )

  private def assertSignedOffset(point: String, line: String, expectedSign: Int): Unit = {
    val (offset, distance) = offsetAndDistance(point, line)
    offset.value mustBe (expectedSign * distance) +- 1e-9
    ()
  }

  "label_centerline_offset_m (the signed offset, #2886)" should {
    "be positive to the left of the digitized direction and negative to the right, at the geodesic distance" in {
      // Walking west to east, north is on the left.
      assertSignedOffset(north(3), WestToEast, +1)
      assertSignedOffset(north(-3), WestToEast, -1)
      // The magnitude is the distance the fixture was built with, to the metre.
      offsetAndDistance(north(3), WestToEast)._1.value mustBe 3.0 +- 0.02
    }

    "flip sign when the street's digitized direction is reversed" in {
      assertSignedOffset(north(3), EastToWest, -1)
      assertSignedOffset(north(-3), EastToWest, +1)
    }

    "be zero on the centerline and sub-metre inside the floor" in {
      offsetAndDistance(pointWkt(MidLng, Lat), WestToEast)._1.value mustBe 0.0
      offsetAndDistance(north(0.5), WestToEast)._1.value mustBe 0.5 +- 0.01
    }

    "sign against the local tangent of a bent street, not its chord" in {
      // West to east, then a right-angle turn north. A point east of the northbound leg is on that leg's right, even
      // though it is on the left of the chord from start to end.
      val bent = "LINESTRING(-122.3 47.6, -122.2995 47.6, -122.2995 47.6005)"
      val east = pointWkt(MidLng + 2 / (111320.0 * math.cos(math.toRadians(Lat))), 47.6003)
      assertSignedOffset(east, bent, -1)
    }

    "have no side for a zero-length edge or a missing position" in {
      offsetAndDistance(pointWkt(-122.3, 47.6), "LINESTRING(-122.3 47.6, -122.3 47.6)")._1 mustBe None
      run(sql"SELECT label_centerline_offset_m(NULL, ST_GeomFromText($WestToEast, 4326))".as[Option[Double]].head)
        .mustBe(None)
    }
  }

  "the insert path" should {
    "store the offset and derive street_side with a 1 m floor" in {
      // Inserts a street, a label and three points through the real LabelPointTable methods, all rolled back.
      val sides: Seq[(Option[Double], Option[String])] = runRolledBack(for {
        streetEdgeId <- sql"""INSERT INTO street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, status)
                              VALUES ((SELECT COALESCE(MAX(street_edge_id), 0) + 1 FROM street_edge),
                                      ST_GeomFromText($WestToEast, 4326), -122.3, 47.6, -122.299, 47.6,
                                      'residential', 'open')
                              RETURNING street_edge_id""".as[Int].head
        results <- DBIO.sequence(Seq(3.0, -3.0, 0.5).map { metres =>
          for {
            // Borrows an existing label's task, mission, user and pano: the FKs need real rows, and a schema
            // without any label (CI's) can't exercise the insert path.
            labelId <- sql"""INSERT INTO label (audit_task_id, mission_id, user_id, pano_id, label_type, deleted,
                                                temporary_label_id, time_created, tutorial, street_edge_id)
                             SELECT audit_task_id, mission_id, user_id, pano_id, 'CurbRamp', FALSE, 0, now(), FALSE,
                                    $streetEdgeId
                             FROM label
                             LIMIT 1
                             RETURNING label_id""".as[Int].headOption
            _    = assume(labelId.isDefined, "no labels in this schema; the insert path needs a seeded DB")
            geom = gf.createPoint(new Coordinate(MidLng, Lat + metres / MetersPerDegLat))
            labelPointId <- labelPointTable.insert(
              LabelPoint(0, labelId.get, 0, 0, 0, 0, 0d, 0d, 1d, Some(geom.getY), Some(geom.getX), Some(geom),
                Some(ComputationMethod.Approximation3), centerlineOffsetM = None, streetSide = None)
            )
            updated <- labelPointTable.computeCenterlineOffset(labelPointId, streetEdgeId)
            _ = updated mustBe 1
            row <- sql"""SELECT centerline_offset_m, street_side::text FROM label_point
                         WHERE label_point_id = $labelPointId""".as[(Option[Double], Option[String])].head
          } yield row
        })
      } yield results)

      sides(0)._1.value mustBe 3.0 +- 0.02
      sides(0)._2 mustBe Some("left")
      sides(1)._1.value mustBe -3.0 +- 0.02
      sides(1)._2 mustBe Some("right")
      sides(2)._1.value mustBe 0.5 +- 0.01
      sides(2)._2 mustBe None
    }
  }

  "stored offsets" should {
    "match a fresh recompute from the same function for every positioned label" in {
      // The backfill and the insert path share label_centerline_offset_m, so the only way to drift is a reposition
      // that forgot to recompute (docs/evolutions.md, cached distance columns).
      val (positioned, stale): (Int, Int) = run(
        sql"""SELECT count(*),
                     count(*) FILTER (WHERE label_point.centerline_offset_m IS DISTINCT FROM
                                            label_centerline_offset_m(label_point.geom, street_edge.geom))
              FROM label_point
              INNER JOIN label ON label.label_id = label_point.label_id
              INNER JOIN street_edge ON street_edge.street_edge_id = label.street_edge_id
              WHERE label_point.geom IS NOT NULL""".as[(Int, Int)].head
      )
      assume(positioned > 0, "no positioned labels in this schema; cache freshness needs a seeded DB")
      stale mustBe 0
    }

    "leave street_side NULL exactly when the offset is missing or inside the 1 m floor" in {
      val mismatches = run(
        sql"""SELECT count(*) FROM label_point
              WHERE street_side::text IS DISTINCT FROM
                    CASE WHEN centerline_offset_m >= 1 THEN 'left' WHEN centerline_offset_m <= -1 THEN 'right' END"""
          .as[Int]
          .head
      )
      mismatches mustBe 0
    }
  }
}
