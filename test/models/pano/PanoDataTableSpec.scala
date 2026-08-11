package models.pano

import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import service.PanoDataService.LiveImageryTtlDays
import slick.dbio.DBIO
import slick.jdbc.TransactionIsolation

import java.time.OffsetDateTime
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed contract test for `PanoDataTable.getReusableImageryStatus`, the lookup that lets an imagery check skip the
 * provider (#3004).
 *
 * Asserts the rule the query encodes against whatever rows the connected DB holds, rather than any particular data: a
 * known-expired GSV pano is always reusable, a live one only while its check is inside the TTL, and no other source is
 * reusable at all. Passes against an empty DB.
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

  "PanoDataTable.getReusableImageryStatus" should {
    "return an answer for exactly the panos the reuse rule covers" in {
      val expected: Map[String, Boolean] = sample.collect {
        case pano if pano.source == PanoSource.Gsv && (pano.expired || !pano.lastChecked.isBefore(cutoff)) =>
          pano.panoId -> !pano.expired
      }.toMap
      statuses mustBe expected
    }

    "reuse a known-expired pano no matter how long ago it was checked" in {
      val staleExpired = sample.filter(p => p.source == PanoSource.Gsv && p.expired && p.lastChecked.isBefore(cutoff))
      assume(staleExpired.nonEmpty, "connected DB has no expired GSV pano checked before the TTL cutoff")
      staleExpired.foreach(pano => statuses.get(pano.panoId) mustBe Some(false))
    }

    "make a live pano checked before the cutoff fall through to a fresh check" in {
      val staleLive = sample.filter(p => p.source == PanoSource.Gsv && !p.expired && p.lastChecked.isBefore(cutoff))
      assume(staleLive.nonEmpty, "connected DB has no live GSV pano checked before the TTL cutoff")
      staleLive.foreach(pano => statuses.get(pano.panoId) mustBe None)
    }

    "never answer for a source with no provider check behind it" in {
      val nonGsv = sample.filter(_.source != PanoSource.Gsv)
      assume(nonGsv.nonEmpty, "connected DB holds only GSV panos")
      nonGsv.foreach(pano => statuses.get(pano.panoId) mustBe None)
    }

    "return nothing when asked about no panos" in {
      run(panoDataTable.getReusableImageryStatus(Set.empty, cutoff)) mustBe empty
    }
  }
}
