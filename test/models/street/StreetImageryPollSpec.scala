package models.street

import models.audit.{AuditTask, AuditTaskTableDef}
import models.user.UserStatTableDef
import models.utils.ConfigTableDef
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.LineString
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import slick.jdbc.GetResult
import util.RolledBackDb

import java.time.{LocalDate, OffsetDateTime}

/**
 * DB-backed tests for the imagery-age poller's table methods (#4384): StreetImageryTable.streetsToPoll (rotation
 * order), noImageryStreetsToPoll (the #4929 regained-imagery rotation), attributedImagery (the nearest-street rule
 * the reopen queue's evidence has to survive), and upsertFromPoll (widen-only date range, per-point median snapshot).
 * Mutating cases run inside rolled-back transactions, leaving the connected DB untouched; requires Postgres+PostGIS
 * like the other DB-backed specs. Actors are disabled.
 */
class StreetImageryPollSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val streetImageryTable = app.injector.instanceOf[StreetImageryTable]

  private val auditTasks    = TableQuery[AuditTaskTableDef]
  private val streetImagery = TableQuery[StreetImageryTableDef]
  private val configTable   = TableQuery[ConfigTableDef]
  private val userStats     = TableQuery[UserStatTableDef]

  private lazy val tutorialStreetId: Int      = run(configTable.map(_.tutorialStreetEdgeID).result.head)
  private lazy val someUserId: Option[String] = run(userStats.map(_.userId).result.headOption)

  /**
   * Inserts an open street in empty ocean and returns it as a [[StreetToPoll]], sample points and all.
   *
   * upsertFromPoll attributes an observation to the street NEAREST it, so a fixture street must be the unambiguous
   * nearest to its own sample points. Polling whatever `streetsToPoll` hands back does not give that: against a seed
   * that clones geometry across streets, the polled street ties at distance 0 with its clones, the tie resolves
   * elsewhere, and every capture column comes back NULL (#4955). Open ocean has nothing to tie with, so this holds
   * against any schema. Ids are MAX+1 because seeded dumps insert explicit ids without advancing the sequences; only
   * safe inside `runRolledBack`.
   */
  private def seedIsolatedStreet: DBIO[StreetToPoll] = seedStreet("open", 0.0)

  /** [[seedIsolatedStreet]] with the status and position exposed, so several fixture streets can coexist. */
  private def seedStreet(status: String, latOffset: Double): DBIO[StreetToPoll] = {
    implicit val getStreetToPoll: GetResult[StreetToPoll] = GetResult { r =>
      val id     = r.nextInt()
      val points = Seq.fill(3)((r.nextDouble(), r.nextDouble()))
      StreetToPoll(id, points, r.nextGeometry[LineString]())
    }
    // South Atlantic, ~1000 km off Brazil. The 0.001 degrees of longitude is ~105 m of street, so the 20/50/80%
    // sample points land ~21 m apart -- far enough not to be each other's nearest pano source. latOffset separates
    // multiple fixture streets by whole kilometers, keeping each the unambiguous nearest to its own points.
    val (lng1, lat1, lng2, lat2) = (-30.0, -20.0 + latOffset, -29.999, -20.0 + latOffset)
    for {
      id <- sql"""
        INSERT INTO street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, status)
        VALUES ((SELECT COALESCE(MAX(street_edge_id), 0) + 1 FROM street_edge),
                ST_SetSRID(ST_MakeLine(ST_MakePoint($lng1, $lat1), ST_MakePoint($lng2, $lat2)), 4326),
                $lng1, $lat1, $lng2, $lat2, 'residential', ${status}::street_edge_status)
        RETURNING street_edge_id""".as[Int].head
      // Fails loudly here rather than as three NULL capture columns if a city is ever mapped onto this spot. The
      // 0.001-degree radius (~111 m) is index-backed and a superset of upsertFromPoll's 15 m tolerance.
      neighbors <- sql"""
        SELECT COUNT(*)
        FROM street_edge
        WHERE street_edge.street_edge_id <> $id
            AND ST_DWithin(street_edge.geom, (SELECT geom FROM street_edge WHERE street_edge_id = $id), 0.001)
      """.as[Int].head
      _ = withClue("seeded fixture street is not the unambiguous nearest to its own sample points: ")(
        neighbors mustBe 0
      )
      street <- sql"""
        SELECT street_edge.street_edge_id,
               ST_Y(ST_LineInterpolatePoint(street_edge.geom, 0.2)),
               ST_X(ST_LineInterpolatePoint(street_edge.geom, 0.2)),
               ST_Y(ST_LineInterpolatePoint(street_edge.geom, 0.5)),
               ST_X(ST_LineInterpolatePoint(street_edge.geom, 0.5)),
               ST_Y(ST_LineInterpolatePoint(street_edge.geom, 0.8)),
               ST_X(ST_LineInterpolatePoint(street_edge.geom, 0.8)),
               street_edge.geom
        FROM street_edge
        WHERE street_edge.street_edge_id = $id""".as[StreetToPoll].head
    } yield street
  }

  "streetsToPoll" should {
    "return open non-tutorial streets with three sample points each, respecting the limit" in {
      val streets = run(streetImageryTable.streetsToPoll(10))
      streets.size must be <= 10
      streets.foreach { s =>
        s.streetEdgeId must not equal tutorialStreetId
        s.points.size mustBe 3
        s.points.foreach { case (lat, lng) =>
          lat must (be >= -90.0 and be <= 90.0)
          lng must (be >= -180.0 and be <= 180.0)
        }
      }
    }

    "put a street with no street_imagery row ahead of freshly-polled streets, and audited ahead of unaudited" in {
      assume(someUserId.isDefined)
      val (first, freshlyPolledLast) = runRolledBack(for {
        candidates <- streetImageryTable.streetsToPoll(3).map(_.map(_.streetEdgeId))
        target = candidates.head
        // Make the target street audited with NO imagery row, and give every other candidate a just-polled row.
        _ <- auditTasks += AuditTask(0, None, someUserId.get, target, OffsetDateTime.now.minusHours(1),
          OffsetDateTime.now, completed = true, 0.0, 0.0, startPointReversed = false, None, None, lowQuality = false,
          incomplete = false, stale = false, auditedDistanceM = None)
        _ <- streetImagery.filter(_.streetEdgeId === target).delete
        _ <- DBIO.sequence(candidates.tail.map { id =>
          streetImagery.filter(_.streetEdgeId === id).delete andThen
            (streetImagery += StreetImagery(id, None, None, None, 0, StreetImagerySource.ImageryPoll,
              OffsetDateTime.now))
        })
        reordered <- streetImageryTable.streetsToPoll(1000).map(_.map(_.streetEdgeId))
      } yield (reordered.headOption.contains(target), reordered.indexOf(candidates.tail.headOption.getOrElse(-1))))

      first mustBe true
      // The just-polled unaudited streets fall to the back of the rotation (or out of a bounded batch entirely).
      freshlyPolledLast must not be 0
    }
  }

  "noImageryStreetsToPoll" should {
    "return only no_imagery non-tutorial streets, with three sample points each" in {
      val (seededId, returnedIds, statuses) = runRolledBack(for {
        street  <- seedStreet("no_imagery", 0.02)
        _       <- seedStreet("open", 0.04) // Must not appear: open streets belong to the main rotation.
        streets <- streetImageryTable.noImageryStreetsToPoll(1000000)
        // Non-empty by construction (the seeded street qualifies), so the IN list can't be empty SQL.
        statuses <- sql"""
          SELECT DISTINCT status::text FROM street_edge
          WHERE street_edge_id IN (#${streets.map(_.streetEdgeId).mkString(",")})
              AND status <> 'no_imagery'""".as[String]
        _ = streets.foreach(_.points.size mustBe 3)
      } yield (street.streetEdgeId, streets.map(_.streetEdgeId), statuses))

      returnedIds must contain(seededId)
      returnedIds must not contain tutorialStreetId
      statuses mustBe empty // i.e. every returned street's status is no_imagery.
    }

    "visit never-polled streets first and freshly-polled streets last" in {
      val (neverPolledId, freshlyPolledId, ids) = runRolledBack(for {
        neverPolled   <- seedStreet("no_imagery", 0.02)
        freshlyPolled <- seedStreet("no_imagery", 0.04)
        _             <- streetImagery += StreetImagery(freshlyPolled.streetEdgeId, None, None, None, 0,
          StreetImagerySource.ImageryPoll, OffsetDateTime.now.plusMinutes(1))
        ids <- streetImageryTable.noImageryStreetsToPoll(1000000).map(_.map(_.streetEdgeId))
      } yield (neverPolled.streetEdgeId, freshlyPolled.streetEdgeId, ids))

      // No street_imagery row sorts NULLS FIRST; the newest updated_at is the back of the rotation.
      ids.indexOf(neverPolledId) must be < ids.indexOf(freshlyPolledId)
      ids.last mustBe freshlyPolledId
    }

    "respect the limit" in {
      val ids = runRolledBack(for {
        _   <- seedStreet("no_imagery", 0.02)
        _   <- seedStreet("no_imagery", 0.04)
        ids <- streetImageryTable.noImageryStreetsToPoll(1)
      } yield ids)
      ids.size mustBe 1
    }
  }

  /**
   * A short street laid through one position, so that position's nearest street is this one rather than the fixture
   * being polled -- the corner-pano-on-the-cross-street case in miniature.
   */
  private def seedStreetThrough(lat: Double, lng: Double): DBIO[Int] = {
    val (west, east) = (lng - 0.00002, lng + 0.00002)
    sql"""
      INSERT INTO street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, status)
      VALUES ((SELECT COALESCE(MAX(street_edge_id), 0) + 1 FROM street_edge),
              ST_SetSRID(ST_MakeLine(ST_MakePoint($west, $lat), ST_MakePoint($east, $lat)), 4326),
              $west, $lat, $east, $lat, 'residential', 'open')
      RETURNING street_edge_id""".as[Int].head
  }

  "attributedImagery" should {
    val capture = LocalDate.parse("2025-05-01")

    "count every attributable pano, dated or not, and report the newest date among them" in {
      val evidence = runRolledBack(for {
        street <- seedStreet("no_imagery", 0.06)
        // ~5.5 m off the street: inside the 15 m tolerance, and with nothing else out here to be nearer.
        (lat, lng) = street.points(1)
        evidence <- streetImageryTable.attributedImagery(
          street.streetEdgeId,
          Seq(PolledPano(lat + 0.00005, lng, Some(capture), 1), PolledPano(lat + 0.00006, lng, None, 1))
        )
      } yield evidence)

      // Undated imagery is still imagery: the question this answers is whether any exists, not how old it is.
      evidence.nPanos mustBe 2
      evidence.newestCapture mustBe Some(capture)
    }

    "refuse a pano whose nearest street is a different one" in {
      val evidence = runRolledBack(for {
        street <- seedStreet("no_imagery", 0.08)
        (lat, lng) = street.points(1)
        _        <- seedStreetThrough(lat + 0.00005, lng)
        evidence <- streetImageryTable.attributedImagery(
          street.streetEdgeId,
          Seq(PolledPano(lat + 0.00005, lng, Some(capture), 1))
        )
      } yield evidence)

      // The whole point of reading evidence back through this rule: a reopen candidate built from the raw proximity
      // filter would claim a pano the pipeline itself credits to the cross street.
      evidence.nPanos mustBe 0
      evidence.newestCapture mustBe None
    }

    "answer zero without a query when the poll saw nothing" in {
      val evidence = runRolledBack(streetImageryTable.attributedImagery(1, Seq.empty))
      evidence mustBe AttributedImagery(0, None)
    }
  }

  "upsertFromPoll" should {
    val newest = LocalDate.parse("2025-05-01")
    val oldest = LocalDate.parse("2015-05-01")

    // A sample point sits ON the polled street's line (distance 0). Paired with a fixture street that has no
    // neighbors to tie with, that makes the polled street its nearest and the observation always attributable.
    def onStreet(street: StreetToPoll, pointIdx: Int, capture: Option[LocalDate]): PolledPano = {
      val (lat, lng) = street.points(pointIdx)
      PolledPano(lat, lng, capture, pointIdx)
    }

    "insert a fresh row with the observed range, per-point median, and the imagery_poll source" in {
      val row = runRolledBack(for {
        street <- seedIsolatedStreet
        _      <- streetImageryTable.upsertFromPoll(
          street.streetEdgeId,
          3,
          Seq(onStreet(street, 0, Some(oldest)), onStreet(street, 1, Some(newest)), onStreet(street, 2, Some(newest)))
        )
        row <- streetImageryTable.getForStreet(street.streetEdgeId)
      } yield row)

      row.map(_.oldestCapture) mustBe Some(Some(oldest))
      row.map(_.newestCapture) mustBe Some(Some(newest))
      // Per-point newest captures are (oldest, newest, newest): two of the three points reach `newest`.
      row.map(_.medianNewestCapture) mustBe Some(Some(newest))
      row.map(_.nPanos) mustBe Some(3)
      row.map(_.dataSource) mustBe Some(StreetImagerySource.ImageryPoll)
    }

    "leave the median NULL when fewer than half the sampled points have dated imagery" in {
      val (oneDated, sharedPano) = runRolledBack(for {
        street <- seedIsolatedStreet
        // Only 1 of 3 points shows dated imagery: no "half the street" claim can be made.
        _        <- streetImageryTable.upsertFromPoll(street.streetEdgeId, 3, Seq(onStreet(street, 0, Some(newest))))
        oneDated <- streetImageryTable.getForStreet(street.streetEdgeId)
        // The same pano (same position) genuinely visible from points 0 and 1 informs both points, so the median
        // exists -- while n_panos still counts it once.
        sharedAtPoint0 = onStreet(street, 0, Some(newest))
        _ <- streetImageryTable.upsertFromPoll(
          street.streetEdgeId,
          3,
          Seq(sharedAtPoint0, sharedAtPoint0.copy(pointIndex = 1))
        )
        sharedPano <- streetImageryTable.getForStreet(street.streetEdgeId)
      } yield (oneDated, sharedPano))

      oneDated.map(_.medianNewestCapture) mustBe Some(None)
      sharedPano.map(_.medianNewestCapture) mustBe Some(Some(newest))
      sharedPano.map(_.nPanos) mustBe Some(1)
    }

    "not attribute an observation whose nearest street is not the polled street" in {
      val row = runRolledBack(for {
        street <- seedIsolatedStreet
        // ~1.1 km north of the street's midpoint: whatever street is nearest there, it isn't the polled one.
        farAway = PolledPano(street.points(1)._1 + 0.01, street.points(1)._2, Some(newest), 1)
        _   <- streetImageryTable.upsertFromPoll(street.streetEdgeId, 3, Seq(farAway))
        row <- streetImageryTable.getForStreet(street.streetEdgeId)
      } yield row)

      // The poll is still recorded ("checked"), but nothing was attributable to this street.
      row.map(_.oldestCapture) mustBe Some(None)
      row.map(_.newestCapture) mustBe Some(None)
      row.map(_.medianNewestCapture) mustBe Some(None)
      row.map(_.nPanos) mustBe Some(0)
      row.map(_.dataSource) mustBe Some(StreetImagerySource.ImageryPoll)
    }

    "widen the range, replace the median (NULL on an empty poll), keep n_panos/data_source, and bump updated_at" in {
      val staleStamp                 = OffsetDateTime.now.minusYears(1)
      val (afterDatedPoll, finalRow) = runRolledBack(for {
        street <- seedIsolatedStreet
        _      <- streetImagery += StreetImagery(street.streetEdgeId, Some(LocalDate.parse("2010-01-01")),
          Some(LocalDate.parse("2030-01-01")), None, 42, StreetImagerySource.ImageryScan, staleStamp)
        // This poll's narrower range must not shrink the stored one. Its median (2 of 3 points dated -> the older
        // of the two per-point captures) is a snapshot, not a widen.
        _ <- streetImageryTable.upsertFromPoll(
          street.streetEdgeId,
          3,
          Seq(onStreet(street, 0, Some(oldest)), onStreet(street, 1, Some(newest)))
        )
        afterDatedPoll <- streetImageryTable.getForStreet(street.streetEdgeId)
        // A later conclusive poll that sees nothing attributable NULLs the median again -- its honest snapshot.
        _        <- streetImageryTable.upsertFromPoll(street.streetEdgeId, 3, Seq.empty)
        finalRow <- streetImageryTable.getForStreet(street.streetEdgeId)
      } yield (afterDatedPoll, finalRow))

      afterDatedPoll.map(_.medianNewestCapture) mustBe Some(Some(oldest))
      finalRow.map(_.oldestCapture) mustBe Some(Some(LocalDate.parse("2010-01-01")))
      finalRow.map(_.newestCapture) mustBe Some(Some(LocalDate.parse("2030-01-01")))
      finalRow.map(_.medianNewestCapture) mustBe Some(None)
      finalRow.map(_.nPanos) mustBe Some(42)
      finalRow.map(_.dataSource) mustBe Some(StreetImagerySource.ImageryScan)
      finalRow.map(_.updatedAt.isAfter(staleStamp)) mustBe Some(true)
    }
  }
}
