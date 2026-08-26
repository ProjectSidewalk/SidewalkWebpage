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

import java.time.OffsetDateTime
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed contract test for `pano_imagery_change`, the imagery-transition log (#4947, evolution 364).
 *
 * `pano_data.expired_at` cannot answer "what went away in March": it is cleared when the imagery returns, so the
 * recovery retroactively empties the week the pano expired in. The log exists to survive that round trip, and these
 * cases are the two halves of the contract that makes it worth having — every real crossing is recorded exactly
 * once, and nothing else is. The second half is what keeps the table small enough to be free: the nightly sweep
 * re-checks every already-expired pano, and a labeler's viewer re-upserts every pano they load.
 *
 * Seeds its own pano rather than hunting for one in the connected DB, so it can never pass vacuously. Requires a
 * Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI); the scheduling actors
 * are disabled so no background sweep touches the row mid-test.
 */
class PanoImageryLogSpec extends PlaySpec with BeforeAndAfterAll with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val panoDataTable      = app.injector.instanceOf[PanoDataTable]
  private val imageryChangeTable = app.injector.instanceOf[PanoImageryChangeTable]
  private val dbConfig           = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  private val panoId = "test-4947-imagery-log"

  /** The pano as a user's viewer would first record it: present, unexpired, never expired. */
  private def freshPano(viewedAt: OffsetDateTime): PanoData = PanoData(
    panoId = panoId, width = Some(16384), height = Some(8192), tileWidth = Some(512), tileHeight = Some(512),
    captureDate = "2020-06", copyright = Some("test"), lat = Some(47.0), lng = Some(-122.0), cameraHeading = Some(0d),
    cameraPitch = Some(0d), cameraRoll = Some(0d), expired = false, lastViewed = viewedAt, panoHistorySaved = None,
    lastChecked = viewedAt, source = PanoSource.Gsv, hasBackup = Some(false), address = None, sourceMetadata = None
  )

  /** The log for the seeded pano, oldest first, as (direction, source) pairs. */
  private def events: Seq[(Boolean, String)] =
    run(
      sql"""SELECT expired, source::text FROM pano_imagery_change
            WHERE pano_id = $panoId ORDER BY pano_imagery_change_id""".as[(Boolean, String)]
    )

  /** Puts the pano back to present-and-unexpired with an empty log, so each case starts from a known state. */
  private def reset(): Unit = {
    run(sqlu"DELETE FROM pano_data WHERE pano_id = $panoId")
    run(panoDataTable.upsert(freshPano(OffsetDateTime.now)))
    val _ = run(sqlu"DELETE FROM pano_imagery_change WHERE pano_id = $panoId")
  }

  override def beforeAll(): Unit = {
    super.beforeAll()
    val _ = run(sqlu"DELETE FROM pano_data WHERE pano_id = $panoId")
  }

  override def afterAll(): Unit = {
    val _ = run(sqlu"DELETE FROM pano_data WHERE pano_id = $panoId")
    super.afterAll()
  }

  "the imagery log" should {
    "record a provider check that finds the imagery gone" in {
      reset()
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), OffsetDateTime.now))
      events mustBe Seq(true -> "provider_check")
    }

    "record nothing when a later check confirms an expiry it already knows about" in {
      reset()
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), OffsetDateTime.now))
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), OffsetDateTime.now.plusDays(1)))
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), OffsetDateTime.now.plusDays(2)))
      // The sweep re-checks every expired pano nightly. Logging those would cost a row per pano per night and bury
      // the transitions in confirmations.
      events mustBe Seq(true -> "provider_check")
    }

    "record a provider check that finds the imagery back" in {
      reset()
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), OffsetDateTime.now))
      run(panoDataTable.updateExpiredStatus(panoId, expired = false, Some(false), OffsetDateTime.now))
      events mustBe Seq(true -> "provider_check", false -> "provider_check")
    }

    "record nothing when a check confirms imagery that was never missing" in {
      reset()
      run(panoDataTable.updateExpiredStatus(panoId, expired = false, Some(false), OffsetDateTime.now))
      events mustBe empty
    }

    "record a labeler's view as the imagery coming back" in {
      reset()
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), OffsetDateTime.now))
      run(panoDataTable.upsert(freshPano(OffsetDateTime.now)))
      // Also the guard on the tempting "fix" for the snapshot race: `FOR UPDATE` on the upsert's `edge` collides
      // with the same statement's own write of the row, and this uncontended case silently stops logging.
      events mustBe Seq(true -> "provider_check", false -> "pano_view")
    }

    "record the recovery of a pano that expired before expiry dates were kept" in {
      reset()
      run(sqlu"UPDATE pano_data SET expired = TRUE, expired_at = NULL WHERE pano_id = $panoId")
      run(panoDataTable.updateExpiredStatus(panoId, expired = false, Some(false), OffsetDateTime.now))
      // Pre-358 expiries have no date for 364's backfill to seed a loss from, so their recoveries arrive unpaired.
      // That is why the chart can show more recoveries than losses, and why the page says so out loud.
      events mustBe Seq(false -> "provider_check")
    }

    "record nothing when a labeler views a pano that was never expired" in {
      reset()
      run(panoDataTable.upsert(freshPano(OffsetDateTime.now)))
      run(panoDataTable.upsert(freshPano(OffsetDateTime.now)))
      // Every pano a labeler loads is upserted, so a row here would be a row per pano view.
      events mustBe empty
    }

    "record nothing for a pano being seen for the first time" in {
      run(sqlu"DELETE FROM pano_data WHERE pano_id = $panoId")
      run(panoDataTable.upsert(freshPano(OffsetDateTime.now)))
      // A first sighting is not a transition, and a log row would reference a pano row that did not exist when the
      // statement began.
      events mustBe empty
    }

    "keep every crossing of a pano that flickers" in {
      reset()
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), OffsetDateTime.now))
      run(panoDataTable.updateExpiredStatus(panoId, expired = false, Some(false), OffsetDateTime.now))
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), OffsetDateTime.now))
      events mustBe Seq(
        true  -> "provider_check",
        false -> "provider_check",
        true  -> "provider_check"
      )
    }

    "go when the pano goes" in {
      reset()
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), OffsetDateTime.now))
      run(sqlu"DELETE FROM pano_data WHERE pano_id = $panoId")
      // ON DELETE CASCADE: the history of a deleted pano describes nothing, and would hold an orphan reference.
      events mustBe empty
    }
  }

  "the writers' row counts" should {

    // The CTEs put two more statements in front of the one the DBIO[Int] comes from. Were a rewrite to take the
    // count from the log INSERT, a write would report 0 rows touched on the very transitions it exists to record.
    "count the pano row the flip touched, not the log row it wrote" in {
      reset()
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), OffsetDateTime.now)) mustBe 1
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), OffsetDateTime.now)) mustBe 1
      run(panoDataTable.updateExpiredStatus(panoId, expired = false, Some(false), OffsetDateTime.now)) mustBe 1
    }

    "report an upsert as one row whether or not it logged a recovery" in {
      reset()
      run(panoDataTable.upsert(freshPano(OffsetDateTime.now))) mustBe 1
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), OffsetDateTime.now))
      run(panoDataTable.upsert(freshPano(OffsetDateTime.now))) mustBe 1
    }

    "report no rows touched for a pano that isn't there" in {
      run(sqlu"DELETE FROM pano_data WHERE pano_id = $panoId")
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), OffsetDateTime.now)) mustBe 0
      events mustBe empty
    }
  }

  "transitionsByWeek" should {

    /** Window totals in each direction. Every case compares a delta, so other panos in the DB can't move a result. */
    def seededCounts(since: OffsetDateTime): (Int, Int) = {
      val weeks = run(imageryChangeTable.transitionsByWeek(since))
      (weeks.map(_.expiredCount).sum, weeks.map(_.returnedCount).sum)
    }

    "count a loss in its own week and a later recovery in that week, not instead of it" in {
      reset()
      val before = seededCounts(OffsetDateTime.now.minusWeeks(4))
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), OffsetDateTime.now.minusWeeks(3)))
      run(panoDataTable.updateExpiredStatus(panoId, expired = false, Some(false), OffsetDateTime.now))

      // The regression this table exists to prevent: reading pano_data.expired_at instead, the recovery clears the
      // column and the loss vanishes from its week entirely, so the same two events would net to nothing.
      seededCounts(OffsetDateTime.now.minusWeeks(4)) mustBe (before._1 + 1, before._2 + 1)
    }

    "count a pano once per direction however many times it crossed that week" in {
      reset()
      val before = seededCounts(OffsetDateTime.now.minusWeeks(1))
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), OffsetDateTime.now))
      run(panoDataTable.updateExpiredStatus(panoId, expired = false, Some(false), OffsetDateTime.now))
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), OffsetDateTime.now))

      // Three crossings, one pano: a flickering provider would otherwise read as a spike in panos lost.
      seededCounts(OffsetDateTime.now.minusWeeks(1)) mustBe (before._1 + 1, before._2 + 1)
    }

    "leave out transitions older than the window" in {
      reset()
      val before = seededCounts(OffsetDateTime.now.minusWeeks(4))
      run(panoDataTable.updateExpiredStatus(panoId, expired = true, Some(false), OffsetDateTime.now))
      seededCounts(OffsetDateTime.now.minusWeeks(4))._1 mustBe before._1 + 1

      run(sqlu"""UPDATE pano_imagery_change SET changed_at = now() - INTERVAL '20 weeks'
                 WHERE pano_id = $panoId""")

      // The row is still there — the log is append-only — it is simply outside what this window asks for.
      events.size mustBe 1
      seededCounts(OffsetDateTime.now.minusWeeks(4)) mustBe before
    }
  }
}
