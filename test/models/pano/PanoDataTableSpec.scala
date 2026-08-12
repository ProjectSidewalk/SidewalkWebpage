package models.pano

import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import service.PanoDataService.{LiveImageryTtlDays, MaxUnexpiredPanosPerSweep}
import slick.dbio.DBIO
import slick.jdbc.TransactionIsolation

import java.time.OffsetDateTime
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed contract tests for the two `PanoDataTable` queries behind imagery-expiry checking: the reuse lookup that
 * lets a foreground check skip the provider (#3004), and the sampling query the nightly sweep draws from (#4862).
 *
 * Both assert the rule the query encodes against whatever rows the connected DB holds, rather than any particular
 * data: a known-expired pano is always reusable, a live one only while its check is inside the TTL, and a source with
 * no provider check behind it is neither reusable nor ever sampled. Passes against an empty DB.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI). The
 * eager scheduling actors are disabled so they don't fire background work during the test.
 */
class PanoDataTableSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val panoDataTable = app.injector.instanceOf[PanoDataTable]
  // Keep the DatabaseConfig as a stable val and call .db.run inline; binding .db to its own val would infer a
  // path-dependent existential type that needs -language:existentials.
  private val dbConfig                   = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  private val cutoff: OffsetDateTime = OffsetDateTime.now.minusDays(LiveImageryTtlDays)

  // Both reads happen in one repeatable-read transaction so they see the same snapshot: the exact-match assertion below
  // compares them directly, and other suites run in parallel and write pano_data (AiSubmissionSpec inserts and deletes
  // rows; savePanoInfo bumps last_checked), which would otherwise let a row shift between the two queries.
  private val (sample, statuses) = run(
    (for {
      rows     <- panoDataTable.panoDataRecords.sortBy(_.panoId).take(1000).result
      statuses <- panoDataTable.getReusableImageryStatus(rows.map(_.panoId).toSet, cutoff)
    } yield (rows, statuses)).transactionally.withTransactionIsolation(TransactionIsolation.RepeatableRead)
  )

  private def checkable(pano: PanoData): Boolean = PanoSource.providerCheckedSources.contains(pano.source)

  "PanoDataTable.getReusableImageryStatus" should {
    "return an answer for exactly the panos the reuse rule covers" in {
      val expected: Map[String, Boolean] = sample.collect {
        case pano if checkable(pano) && (pano.expired || !pano.lastChecked.isBefore(cutoff)) =>
          pano.panoId -> !pano.expired
      }.toMap
      statuses mustBe expected
    }

    "reuse a known-expired pano no matter how long ago it was checked" in {
      val staleExpired = sample.filter(p => checkable(p) && p.expired && p.lastChecked.isBefore(cutoff))
      assume(staleExpired.nonEmpty, "connected DB has no expired provider-checked pano checked before the TTL cutoff")
      staleExpired.foreach(pano => statuses.get(pano.panoId) mustBe Some(false))
    }

    "make a live pano checked before the cutoff fall through to a fresh check" in {
      val staleLive = sample.filter(p => checkable(p) && !p.expired && p.lastChecked.isBefore(cutoff))
      assume(staleLive.nonEmpty, "connected DB has no live provider-checked pano checked before the TTL cutoff")
      staleLive.foreach(pano => statuses.get(pano.panoId) mustBe None)
    }

    "never answer for a source with no provider check behind it" in {
      val unchecked = sample.filterNot(checkable)
      assume(unchecked.nonEmpty, "connected DB holds only provider-checked panos")
      unchecked.foreach(pano => statuses.get(pano.panoId) mustBe None)
    }

    "return nothing when asked about no panos" in {
      run(panoDataTable.getReusableImageryStatus(Set.empty, cutoff)) mustBe empty
    }
  }

  // Sample both halves of the nightly sweep alongside the pano_data rows they came from, in one snapshot, so the
  // per-pano assertions below compare a result against the row that actually produced it.
  private val sampleSize                                    = 500
  private val (unexpiredSample, expiredSample, sampledRows) = run(
    (for {
      unexpired <- panoDataTable.getPanoIdsToCheckExpiration(sampleSize, expired = false)
      expired   <- panoDataTable.getPanoIdsToCheckExpiration(sampleSize, expired = true)
      rows      <- panoDataTable.panoDataRecords
        .filter(_.panoId inSet (unexpired ++ expired).map(_._1).toSet)
        .result
    } yield (unexpired, expired, rows.map(pano => pano.panoId -> pano).toMap)).transactionally
      .withTransactionIsolation(TransactionIsolation.RepeatableRead)
  )
  // Upper bound on the staleness cutoff the queries built from their own now(), which ran before this line.
  private val staleCutoff: OffsetDateTime = OffsetDateTime.now.minusMonths(3)

  "PanoDataTable.getPanoIdsToCheckExpiration" should {
    "pair every sampled pano with the source it is actually stored under" in {
      // The sweep dispatches on this source, so a wrong one checks the pano against the wrong provider's API.
      assume(unexpiredSample.nonEmpty || expiredSample.nonEmpty, "connected DB has no panos due for an expiry check")
      (unexpiredSample ++ expiredSample).foreach { case (panoId, source) =>
        sampledRows.get(panoId).map(_.source) mustBe Some(source)
      }
    }

    "only sample panos whose imagery a provider can actually be asked about" in {
      assume(unexpiredSample.nonEmpty || expiredSample.nonEmpty, "connected DB has no panos due for an expiry check")
      (unexpiredSample ++ expiredSample).foreach { case (_, source) =>
        PanoSource.providerCheckedSources must contain(source)
      }
    }

    "only sample panos that are due, on the side of the expired flag that was asked for" in {
      assume(unexpiredSample.nonEmpty || expiredSample.nonEmpty, "connected DB has no panos due for an expiry check")
      unexpiredSample.foreach { case (panoId, _) => sampledRows(panoId).expired mustBe false }
      expiredSample.foreach { case (panoId, _) => sampledRows(panoId).expired mustBe true }
      (unexpiredSample ++ expiredSample).foreach { case (panoId, _) =>
        sampledRows(panoId).lastChecked.isBefore(staleCutoff) mustBe true
      }
    }

    "include Mapillary panos, not just GSV ones" in {
      // Counted independently of the query under test, and a minute past the cutoff so a pano landing on the boundary
      // can't count as due here while the query's own now() saw it as fresh.
      val dueMapillary = run(
        panoDataTable.panoDataRecords
          .join(panoDataTable.labelTable)
          .on(_.panoId === _.panoId)
          .filter(_._1.source === PanoSource.Mapillary)
          .filter(_._1.lastChecked < staleCutoff.minusMinutes(1))
          .map(_._1.panoId)
          .countDistinct
          .result
      )
      assume(dueMapillary > 0, "connected DB has no labeled Mapillary pano due for an expiry check")

      // Drawn at the sweep's own nightly cap rather than reusing the smaller sample above: on a GSV-heavy city a
      // Mapillary pano can sit behind more than `sampleSize` staler GSV ones, and a pano beyond the real cap is one
      // the sweep wouldn't have reached either.
      val nightlyDraw = run(for {
        unexpired <- panoDataTable.getPanoIdsToCheckExpiration(MaxUnexpiredPanosPerSweep, expired = false)
        expired   <- panoDataTable.getPanoIdsToCheckExpiration(MaxUnexpiredPanosPerSweep, expired = true)
      } yield unexpired ++ expired)
      nightlyDraw.map(_._2) must contain(PanoSource.Mapillary)
    }

    "return nothing when asked for no panos" in {
      run(panoDataTable.getPanoIdsToCheckExpiration(0, expired = false)) mustBe empty
    }
  }
}
