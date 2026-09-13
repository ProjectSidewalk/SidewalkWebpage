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
 * LEFT of the edge's digitized direction, and the GENERATED `street_side` with its 1 m floor. Three city-agnostic
 * layers:
 *   1. Known geometry through the SQL function: a synthetic west-to-east street with points north (left) and south
 *      (right), on the line, inside the floor, the same street reversed (the sign follows the digitized direction,
 *      not the compass), a bent street (the sign follows the local tangent, not the chord -- asserted against the
 *      chord's own answer for the same point, so a chord regression cannot pass), and points past the end of the
 *      edge (the magnitude is across the street, never along it). Magnitudes are checked against PostGIS's geodesic
 *      distance, so a projected magnitude fails.
 *   2. The insert path, `LabelPointTable.insert` then `computeCenterlineOffset`, inside a rolled-back transaction,
 *      reading back through Slick so the `street_side` enum mapper and the full row projection are exercised too.
 *   3. Cache freshness: every stored offset equals a fresh call of the function, the postcondition 375's backfill
 *      promises and the contract any later reposition must keep (`docs/evolutions.md`). Needs a seeded DB, so it
 *      `assume`s label_point is non-empty and cancels otherwise, the `GeodesicDistanceSpec` convention.
 *
 * Fixture points are built with `ST_Project`, which walks a geodesic, rather than from a degrees-per-metre constant:
 * the floor tests sit a millimetre either side of 1 m, which a constant good to only a few parts per thousand cannot
 * resolve.
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

  // A 100 m west-to-east street at Seattle's latitude, as WKT, and its reverse.
  private val Lat        = 47.6
  private val WestLng    = -122.3
  private val EastLng    = -122.299
  private val MidLng     = -122.2995
  private val WestToEast = s"LINESTRING($WestLng $Lat, $EastLng $Lat)"
  private val EastToWest = s"LINESTRING($EastLng $Lat, $WestLng $Lat)"

  /** WKT for the point reached by walking `eastM` metres east from (lng, lat), then `northM` metres north. */
  private def projected(lng: Double, lat: Double, eastM: Double, northM: Double): String = run(
    sql"""SELECT ST_AsText(
            ST_Project(
              ST_Project(ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography,
                         ${math.abs(eastM)}, radians(${if (eastM >= 0) 90.0 else 270.0})),
              ${math.abs(northM)}, radians(${if (northM >= 0) 0.0 else 180.0})
            )::geometry
          )""".as[String].head
  )

  /** WKT for a point `metres` north (positive) or south (negative) of the street's midpoint. */
  private def north(metres: Double): String = projected(MidLng, Lat, 0d, metres)

  /** The signed offset and the geodesic distance PostGIS reports for the same point and line. */
  private def offsetAndDistance(point: String, line: String): (Option[Double], Double) =
    run(
      sql"""SELECT label_centerline_offset_m(ST_GeomFromText($point, 4326), ST_GeomFromText($line, 4326)),
                     ST_Distance(ST_GeomFromText($point, 4326)::geography, ST_GeomFromText($line, 4326)::geography)"""
        .as[(Option[Double], Double)]
        .head
    )

  private def offset(point: String, line: String): Option[Double] = offsetAndDistance(point, line)._1

  private def assertSignedOffset(point: String, line: String, expectedSign: Int): Unit = {
    val (off, distance) = offsetAndDistance(point, line)
    off.value mustBe (expectedSign * distance) +- 1e-9
    ()
  }

  "label_centerline_offset_m (the signed offset, #2886)" should {
    "be positive to the left of the digitized direction and negative to the right, at the geodesic distance" in {
      // Walking west to east, north is on the left.
      assertSignedOffset(north(3), WestToEast, +1)
      assertSignedOffset(north(-3), WestToEast, -1)
      // The magnitude is the distance the fixture was built with, to the millimetre.
      offset(north(3), WestToEast).value mustBe 3.0 +- 0.001
    }

    "flip sign when the street's digitized direction is reversed" in {
      assertSignedOffset(north(3), EastToWest, -1)
      assertSignedOffset(north(-3), EastToWest, +1)
    }

    "be zero on the centerline and sub-metre inside the floor" in {
      offset(s"POINT($MidLng $Lat)", WestToEast).value mustBe 0.0
      offset(north(0.5), WestToEast).value mustBe 0.5 +- 0.001
    }

    "sign against the local tangent of a bent street, not its chord" in {
      // West to east, then a right-angle turn north. This point sits west of the northbound leg, so walking that leg
      // it is on the LEFT -- but it is east of the start-to-end chord, which would call it right. Asserting both
      // makes the fixture discriminating: a regression that took the chord flips the sign rather than passing.
      val bent  = s"LINESTRING($WestLng $Lat, $MidLng $Lat, $MidLng 47.6005)"
      val chord = s"LINESTRING($WestLng $Lat, $MidLng 47.6005)"
      val point = "POINT(-122.2996 47.6003)"
      assertSignedOffset(point, bent, +1)
      assertSignedOffset(point, chord, -1)
    }

    "measure across the street, not along it, for a label past the end of the edge" in {
      // ST_LineLocatePoint clamps the foot to the endpoint, so the raw distance to the edge would be dominated by the
      // 55 m of along-street run. Only the 0.1 m of side survives, which leaves the label inside the floor.
      val pastTheEnd = projected(EastLng, Lat, 55d, 0.1)
      offset(pastTheEnd, WestToEast).value mustBe 0.1 +- 0.01
      // A point that is genuinely beside the endpoint is perpendicular to the tangent, so it is untouched.
      assertSignedOffset(projected(EastLng, Lat, 0d, 3d), WestToEast, +1)
      offset(projected(EastLng, Lat, 0d, 3d), WestToEast).value mustBe 3.0 +- 0.001
    }

    "have no side for a zero-length edge or a missing position" in {
      offset(s"POINT($WestLng $Lat)", s"LINESTRING($WestLng $Lat, $WestLng $Lat)") mustBe None
      run(sql"SELECT label_centerline_offset_m(NULL, ST_GeomFromText($WestToEast, 4326))".as[Option[Double]].head)
        .mustBe(None)
      run(sql"SELECT label_centerline_offset_m(ST_GeomFromText(${north(3)}, 4326), NULL)".as[Option[Double]].head)
        .mustBe(None)
    }
  }

  "the insert path" should {
    "store the offset and derive street_side with a 1 m floor" in {
      // Inserts a street, a label and a point per fixture through the real LabelPointTable methods, all rolled back.
      // 1.001 m and 0.999 m straddle the floor; the rest cover both sides and the middle.
      val fixtures                                = Seq(3.0, -3.0, 0.5, 1.001, -1.001, 0.999)
      val rows: Seq[(LabelPoint, Option[String])] = runRolledBack(for {
        streetEdgeId <- sql"""INSERT INTO street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, status)
                              VALUES ((SELECT COALESCE(MAX(street_edge_id), 0) + 1 FROM street_edge),
                                      ST_GeomFromText($WestToEast, 4326), $WestLng, $Lat, $EastLng, $Lat,
                                      'residential', 'open')
                              RETURNING street_edge_id""".as[Int].head
        results <- DBIO.sequence(fixtures.map { metres =>
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
            _   = assume(labelId.isDefined, "no labels in this schema; the insert path needs a seeded DB")
            wkt = north(metres)
            coords <- sql"SELECT ST_X(ST_GeomFromText($wkt, 4326)), ST_Y(ST_GeomFromText($wkt, 4326))"
              .as[(Double, Double)]
              .head
            geom = gf.createPoint(new Coordinate(coords._1, coords._2))
            labelPointId <- labelPointTable.insert(
              LabelPoint(0, labelId.get, 0, 0, 0, 0, 0d, 0d, 1d, Some(geom.getY), Some(geom.getX), Some(geom),
                Some(ComputationMethod.Approximation3), centerlineOffsetM = None, streetSide = None)
            )
            updated <- labelPointTable.computeCenterlineOffset(labelPointId, streetEdgeId)
            _ = updated mustBe 1
            // Read back through Slick, which decodes street_side with the enum mapper and materializes the whole
            // row projection -- neither of which any other query in the app exercises.
            row <- labelPointTable.labelPoints.filter(_.labelPointId === labelPointId).result.head
            // ...and once as raw text, pinning the Postgres enum's own labels rather than Scala's names for them.
            sideText <- sql"SELECT street_side::text FROM label_point WHERE label_point_id = $labelPointId"
              .as[Option[String]]
              .head
          } yield (row, sideText)
        })
      } yield results)

      val offsets = rows.map(_._1.centerlineOffsetM)
      offsets(0).value mustBe 3.0 +- 0.001
      offsets(1).value mustBe -3.0 +- 0.001
      offsets(2).value mustBe 0.5 +- 0.001
      offsets(3).value mustBe 1.001 +- 0.001
      offsets(4).value mustBe -1.001 +- 0.001
      offsets(5).value mustBe 0.999 +- 0.001

      rows.map(_._1.streetSide) mustBe Seq(Some(StreetSide.Left), Some(StreetSide.Right), None, Some(StreetSide.Left),
        Some(StreetSide.Right), None)
      rows.map(_._2) mustBe Seq(Some("left"), Some("right"), None, Some("left"), Some("right"), None)
    }

    "refuse to insert a street_side, which only the database may set" in {
      an[IllegalArgumentException] must be thrownBy labelPointTable.insert(
        LabelPoint(0, 1, 0, 0, 0, 0, 0d, 0d, 1d, None, None, None, None, centerlineOffsetM = None,
          streetSide = Some(StreetSide.Left))
      )
    }
  }

  "stored offsets" should {
    "match a fresh recompute from the same function for every label" in {
      // The backfill and the insert path share label_centerline_offset_m, so the only way to drift is a reposition
      // that forgot to recompute (docs/evolutions.md, cached distance columns). Unpositioned labels are in scope
      // too: their offset must be absent, not merely unequal to a recompute that never ran.
      val (labelled, stale): (Int, Int) = run(
        sql"""SELECT count(*),
                     count(*) FILTER (WHERE label_point.centerline_offset_m IS DISTINCT FROM
                                            label_centerline_offset_m(label_point.geom, street_edge.geom))
              FROM label_point
              INNER JOIN label ON label.label_id = label_point.label_id
              INNER JOIN street_edge ON street_edge.street_edge_id = label.street_edge_id""".as[(Int, Int)].head
      )
      assume(labelled > 0, "no labels in this schema; cache freshness needs a seeded DB")
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
