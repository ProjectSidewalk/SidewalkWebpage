package models.pano

import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import slick.dbio.DBIO

import java.time.temporal.ChronoUnit
import java.time.{Instant, OffsetDateTime}
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed contract test for `pano_data.expired_at` (#4928, evolution 358).
 *
 * The column answers "when did this pano's imagery go away", which `last_checked` cannot: the nightly sweep re-checks
 * already-expired panos and bumps `last_checked` every time, so only a value written on the false -> true edge can
 * date the disappearance. Every case here is that edge condition — stamped once, never re-stamped by a confirming
 * re-check, cleared when the imagery comes back.
 *
 * Seeds its own pano rather than hunting for one in the connected DB, so it can never pass vacuously. Requires a
 * Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI); the scheduling actors
 * are disabled so no background sweep touches the row mid-test.
 */
class PanoExpiredAtSpec extends PlaySpec with BeforeAndAfterAll with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val panoDataTable = app.injector.instanceOf[PanoDataTable]
  private val dbConfig      = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  private val panoId = "test-4928-expired-at"

  /** The pano as a user's viewer would first record it: present, unexpired, never expired. */
  private def freshPano(viewedAt: OffsetDateTime): PanoData = PanoData(
    panoId = panoId, width = Some(16384), height = Some(8192), tileWidth = Some(512), tileHeight = Some(512),
    captureDate = "2020-06", copyright = Some("test"), lat = Some(47.0), lng = Some(-122.0), cameraHeading = Some(0d),
    cameraPitch = Some(0d), cameraRoll = Some(0d), expired = false, lastViewed = viewedAt, panoHistorySaved = None,
    lastChecked = viewedAt, source = PanoSource.Gsv, hasBackup = Some(false), address = None, sourceMetadata = None
  )

  /** Truncated to microseconds, the precision Postgres stores — a raw Instant carries nanoseconds it drops. */
  private def expiredAt: Option[Instant] =
    run(sql"SELECT expired_at FROM pano_data WHERE pano_id = $panoId".as[Option[OffsetDateTime]].head)
      .map(_.toInstant.truncatedTo(ChronoUnit.MICROS))

  private def micros(time: OffsetDateTime): Instant = time.toInstant.truncatedTo(ChronoUnit.MICROS)

  private def isExpired: Boolean =
    run(sql"SELECT expired FROM pano_data WHERE pano_id = $panoId".as[Boolean].head)

  override def beforeAll(): Unit = {
    super.beforeAll()
    val _ = run(sqlu"DELETE FROM pano_data WHERE pano_id = $panoId")
  }

  override def afterAll(): Unit = {
    val _ = run(sqlu"DELETE FROM pano_data WHERE pano_id = $panoId")
    super.afterAll()
  }

  "pano_data.expired_at" should {
    "be null for a pano that has never expired" in {
      run(panoDataTable.upsert(freshPano(OffsetDateTime.now)))
      isExpired mustBe false
      expiredAt mustBe None
    }

    "be stamped when the sweep first finds the imagery gone" in {
      val goneAt = OffsetDateTime.now
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), goneAt))
      isExpired mustBe true
      expiredAt mustBe Some(micros(goneAt))
    }

    "keep the original date when a later sweep confirms the same expiry" in {
      val firstStamp = expiredAt
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), OffsetDateTime.now.plusDays(30)))
      expiredAt mustBe firstStamp
    }

    "clear when a re-check finds the imagery back" in {
      run(panoDataTable.updateExpiredStatus(panoId, expired = false, Some(false), OffsetDateTime.now))
      isExpired mustBe false
      expiredAt mustBe None
    }

    "re-stamp with the new date when the pano expires a second time" in {
      val goneAgainAt = OffsetDateTime.now
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), goneAgainAt))
      expiredAt mustBe Some(micros(goneAgainAt))
    }

    "clear when a user views the pano again" in {
      run(panoDataTable.upsert(freshPano(OffsetDateTime.now)))
      isExpired mustBe false
      expiredAt mustBe None
    }

    "reject an expiry date on a pano that is not expired" in {
      an[Exception] must be thrownBy {
        run(sqlu"UPDATE pano_data SET expired_at = now() WHERE pano_id = $panoId")
      }
    }
  }

  "newlyExpiredByWeek" should {
    "count a pano in the week its imagery went away" in {
      val goneAt = OffsetDateTime.now
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), goneAt))
      val weeks = run(panoDataTable.newlyExpiredByWeek(goneAt.minusDays(1)))
      weeks.map(_.panoCount).sum must be >= 1
    }

    "leave out panos that expired before expiry dates were recorded" in {
      // The whole point of the undated count: those panos are absent from every week rather than piled onto one.
      val countedBefore = run(panoDataTable.newlyExpiredByWeek(OffsetDateTime.now.minusWeeks(1))).map(_.panoCount).sum
      val undatedBefore = run(panoDataTable.countExpiredWithoutExpiryDate)

      run(sqlu"UPDATE pano_data SET expired_at = NULL WHERE pano_id = $panoId")

      run(panoDataTable.newlyExpiredByWeek(OffsetDateTime.now.minusWeeks(1))).map(_.panoCount).sum mustBe
        countedBefore - 1
      run(panoDataTable.countExpiredWithoutExpiryDate) mustBe undatedBefore + 1
    }
  }
}
