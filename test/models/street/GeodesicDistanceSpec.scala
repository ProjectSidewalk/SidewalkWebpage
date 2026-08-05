package models.street

import models.route.RouteTable
import models.user.{UserStatTable, UserStatTableDef}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._
import service.RegionService
import slick.basic.DatabaseConfig
import slick.dbio.DBIO

import scala.concurrent.Await
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.DurationInt

/**
 * DB-backed tests locking in the geodesic street-distance measure (#4641).
 *
 * Street distances are measured geodesically — `ST_Length` over `::geography` in raw SQL, `lengthGeodesic` in Slick —
 * which is accurate worldwide. Measuring by projecting to a fixed CRS is the bug this suite guards against: UTM zone
 * 18N is only correct near its 75°W central meridian and overstated other cities' distances by up to +51% (Auckland).
 *
 * Three layers of protection, all city-agnostic so they hold against any test DB:
 *   1. Known-geometry fixtures: synthetic streets whose WGS84 geodesic lengths are derived analytically (closed-form
 *      equator arc, numerically integrated meridian arc) — independent of PostGIS — inserted and measured inside a
 *      rolled-back transaction. These fail loudly, by double-digit percentages, if anyone reintroduces a projection.
 *   2. Cross-implementation consistency: the Slick (`lengthGeodesic`) and raw-SQL (`ST_Length(geom::geography)`)
 *      paths must report identical lengths, and the two independent implementations of "total open street km"
 *      (StreetEdgeTable via Slick, the overallStats API via raw SQL) must agree.
 *   3. Cache freshness: every cached distance (user_stat.meters_audited, labels_per_meter, region_completion,
 *      route.distance_meters) and the distance-derived high_quality flag must match what their runtime recomputes
 *      produce — run for real inside a rolled-back transaction. This is exactly the postcondition evolution 347's
 *      backfill promises, so it also fails if that backfill ever drifts from the runtime code it mirrors.
 */
class GeodesicDistanceSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer = app.materializer

  private val streetEdgeTable = app.injector.instanceOf[StreetEdgeTable]
  private val userStatTable   = app.injector.instanceOf[UserStatTable]
  private val routeTable      = app.injector.instanceOf[RouteTable]
  private val regionService   = app.injector.instanceOf[RegionService]
  // Typed explicitly: letting `.db` infer here yields an existential type the compiler rejects under -Xfatal-warnings.
  private val dbConfig: DatabaseConfig[MyPostgresProfile] =
    app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 120.seconds)

  // Carries a successful result out through the forced-rollback failure path of `runRolledBack`.
  private case class RollbackWithResult(result: Any) extends RuntimeException with scala.util.control.NoStackTrace

  /**
   * Runs `action` inside a transaction that is ALWAYS rolled back, returning the action's result. Lets a test insert a
   * synthetic fixture or run a real recompute against the shared dev DB and leave it exactly as found — even if an
   * assertion later fails.
   */
  private def runRolledBack[T](action: DBIO[T]): T = {
    val alwaysRollback = action.flatMap(r => DBIO.failed(RollbackWithResult(r))).transactionally
    Await.result(
      dbConfig.db.run(alwaysRollback).recover { case RollbackWithResult(r) => r.asInstanceOf[T] },
      120.seconds
    )
  }

  /** Relative-with-absolute-floor closeness check for distances in meters. */
  private def assertClose(actual: Double, expected: Double, relTol: Double = 1e-9, absTol: Double = 1e-6): Unit = {
    val bound = math.max(relTol * math.max(actual.abs, expected.abs), absTol)
    actual mustBe expected +- bound
    ()
  }

  /**
   * Inserts a throwaway street with the given endpoints and measures it with `getStreetLengths` (the Slick
   * `lengthGeodesic` path), all inside a rolled-back transaction. Status `closed` also pins that measuring does not
   * depend on a street being open.
   */
  private def measureSyntheticStreet(x1: Double, y1: Double, x2: Double, y2: Double): Double =
    runRolledBack(for {
      // Explicit id: seeded dev dumps insert streets with explicit ids without advancing the sequence, so the
      // sequence default can collide. Rolled back, so the id is never really claimed.
      streetEdgeId <- sql"""INSERT INTO street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, status)
                            VALUES ((SELECT COALESCE(MAX(street_edge_id), 0) + 1 FROM street_edge),
                                    ST_SetSRID(ST_MakeLine(ST_MakePoint($x1, $y1), ST_MakePoint($x2, $y2)), 4326),
                                    $x1, $y1, $x2, $y2, 'residential', 'closed')
                            RETURNING street_edge_id""".as[Int].head
      lengths <- streetEdgeTable.getStreetLengths(Seq(streetEdgeId))
    } yield lengths(streetEdgeId))

  // WGS84 reference lengths, derived independently of PostGIS. The equator arc is closed-form (semi-major axis
  // a = 6378137 m, so one degree = a * π/180); the 47°N→48°N meridian arc is M = a(1−e²)∫(1−e²sin²φ)^(−3/2)dφ,
  // numerically integrated (Simpson). PostGIS's spheroid computation agrees with both to < 1e-6 m.
  private val EquatorOneDegreeMeters = 111319.4908
  private val Meridian47To48Meters   = 111180.5865

  "street lengths (the geodesic measure, #4641)" should {
    "measure one degree along the equator as the WGS84 closed-form arc" in {
      // Projected through UTM zone 18N this line would measure 469,932 m — 4.2× reality. The tight tolerance fails
      // for ANY fixed-CRS projection, not just zone 18N.
      assertClose(measureSyntheticStreet(0, 0, 1, 0), EquatorOneDegreeMeters, absTol = 0.5)
    }

    "measure a Seattle-longitude meridian degree as the WGS84 meridian arc" in {
      // Projected through UTM zone 18N this line would measure 128,046 m (+15.2%) — the overstatement every Seattle
      // distance carried before #4641.
      assertClose(measureSyntheticStreet(-122.3, 47, -122.3, 48), Meridian47To48Meters, absTol = 0.5)
    }

    "agree between the Slick lengthGeodesic path and raw ST_Length(geom::geography) SQL for real streets" in {
      val (rawLengths, liftedLengths) = run(for {
        raw    <- sql"SELECT street_edge_id, ST_Length(geom::geography) FROM street_edge LIMIT 100".as[(Int, Double)]
        lifted <- streetEdgeTable.getStreetLengths(raw.map(_._1))
      } yield (raw, lifted))

      rawLengths.foreach { case (streetEdgeId, rawLength) => assertClose(liftedLengths(streetEdgeId), rawLength) }
    }

    "report the same total open-street km from the Slick path and the overallStats raw-SQL path" in {
      // Two independent implementations of the same quantity: StreetEdgeTable.totalStreetDistance (Slick) and the
      // overallStats km-by-status bucket (raw SQL in LabelTable). Both cover open streets minus the tutorial street,
      // so any drift between the measures the two paths use shows up here.
      val slickMeters = run(streetEdgeTable.totalStreetDistance)
      val json        = contentAsJson(route(app, FakeRequest(GET, "/v3/api/overallStats")).get)
      val kmOpen      = (json \ "km_by_status" \ "open").as[Double]

      assertClose(slickMeters / 1000.0, kmOpen, relTol = 1e-9, absTol = 1e-6)
    }
  }

  "cached distances" should {
    "match a fresh runtime recompute of user_stat.meters_audited" in {
      // Runs the REAL runtime recompute (updateAuditedDistanceHelper) over every user inside a rolled-back
      // transaction: cached values must already equal what it writes. Also evolution 347's backfill postcondition.
      val allUserIds                                                  = TableQuery[UserStatTableDef].map(_.userId)
      val (before, after): (Map[String, Double], Map[String, Double]) = runRolledBack(for {
        before <- sql"SELECT user_id, meters_audited FROM user_stat".as[(String, Double)].map(_.toMap)
        _      <- userStatTable.updateAuditedDistanceHelper(allUserIds)
        after  <- sql"SELECT user_id, meters_audited FROM user_stat".as[(String, Double)].map(_.toMap)
      } yield (before, after))

      after.foreach { case (userId, recomputed) => assertClose(before(userId), recomputed) }
    }

    "match a fresh runtime recompute of user_stat.labels_per_meter for users with audited meters" in {
      // Scoped to meters_audited > 0: for users without audited meters the runtime recompute writes NULL while
      // legacy rows may carry other values, and no distance is involved in that difference.
      val allUserIds = TableQuery[UserStatTableDef].map(_.userId)
      val (before, after): (Map[String, Option[Double]], Map[String, Option[Double]]) = runRolledBack(for {
        before <- sql"SELECT user_id, labels_per_meter FROM user_stat WHERE meters_audited > 0"
          .as[(String, Option[Double])]
          .map(_.toMap)
        _     <- userStatTable.updateLabelsPerMeterHelper(allUserIds)
        after <- sql"SELECT user_id, labels_per_meter FROM user_stat WHERE meters_audited > 0"
          .as[(String, Option[Double])]
          .map(_.toMap)
      } yield (before, after))

      after.foreach { case (userId, recomputed) =>
        (before(userId), recomputed) match {
          case (Some(cached), Some(fresh)) => assertClose(cached, fresh, relTol = 1e-9, absTol = 1e-12)
          case (cached, fresh)             => cached mustBe fresh
        }
      }
    }

    "match a fresh runtime recompute of the distance-derived user_stat.high_quality flag" in {
      // labels_per_meter is an input to the quality heuristic, so the cached flag must agree with a fresh
      // updateHighQuality run. Epoch cutoff = every user the runtime recompute would ever touch.
      val epoch = java.time.OffsetDateTime.parse("1970-01-01T00:00:00Z")
      val (before, after): (Map[String, Boolean], Map[String, Boolean]) = runRolledBack(for {
        before <- sql"SELECT user_id, high_quality FROM user_stat".as[(String, Boolean)].map(_.toMap)
        _      <- userStatTable.updateHighQuality(epoch)
        after  <- sql"SELECT user_id, high_quality FROM user_stat".as[(String, Boolean)].map(_.toMap)
      } yield (before, after))

      after.foreach { case (userId, recomputed) => before(userId) mustBe recomputed }
    }

    "match a fresh runtime recompute of region_completion.total_distance, with audited_distance in bounds" in {
      // total_distance must equal what initializeRegionCompletionTable would write today. audited_distance is only
      // bounds-checked: it is maintained incrementally at runtime (with deliberate equalization fudges in
      // RegionCompletionTable), so exact equality with a fresh recompute is not an invariant.
      val (cached, fresh): (Map[Int, (Double, Double)], Map[Int, (Double, Double)]) = runRolledBack(for {
        cached <- sql"SELECT region_id, total_distance, audited_distance FROM region_completion"
          .as[(Int, Double, Double)]
          .map(_.map { case (id, total, audited) => id -> (total, audited) }.toMap)
        _     <- sqlu"TRUNCATE TABLE region_completion"
        _     <- regionService.initializeRegionCompletionTableAction
        fresh <- sql"SELECT region_id, total_distance, audited_distance FROM region_completion"
          .as[(Int, Double, Double)]
          .map(_.map { case (id, total, audited) => id -> (total, audited) }.toMap)
      } yield (cached, fresh))

      cached.foreach { case (regionId, (cachedTotal, cachedAudited)) =>
        fresh.get(regionId).foreach { case (freshTotal, _) => assertClose(cachedTotal, freshTotal) }
        cachedAudited must be >= 0.0
        cachedAudited must be <= cachedTotal + 1e-6
      }
    }

    "match a fresh runtime recompute of route.distance_meters, which equals getRouteDistance" in {
      val routeIds = run(sql"SELECT route_id FROM route WHERE NOT deleted".as[Int])

      val results: Seq[(Int, Double, Double, Double)] = runRolledBack(DBIO.sequence(routeIds.map { routeId =>
        for {
          cached       <- sql"SELECT distance_meters FROM route WHERE route_id = $routeId".as[Double].head
          slickMeasure <- routeTable.getRouteDistance(routeId)
          _            <- routeTable.updateStats(routeId)
          fresh        <- sql"SELECT distance_meters FROM route WHERE route_id = $routeId".as[Double].head
        } yield (routeId, cached, slickMeasure, fresh)
      }))

      results.foreach { case (_, cached, slickMeasure, fresh) =>
        assertClose(cached, fresh)        // cache is what the runtime recompute (raw SQL) writes
        assertClose(cached, slickMeasure) // ...and what the Slick lengthGeodesic path measures
      }
    }
  }
}
