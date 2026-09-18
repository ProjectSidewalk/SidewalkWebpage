package service

import models.pano.MapillaryAllowedSourceTable
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import slick.dbio.DBIO

import scala.concurrent.duration._
import scala.concurrent.{Await, Future}

/**
 * Tests for the deployment's Mapillary creator restriction (#5407).
 *
 * The rule itself is two pure functions, pinned first because everything else leans on them: an empty allowlist
 * admits every image (the unfiltered state every deployment starts in -- getting this backwards would blank every
 * Mapillary city), and a username is only ever accepted in a shape that is safe to store and to put in a query.
 *
 * The rest pins the list's bookkeeping against the connected database: re-adding a creator keeps the original record
 * of who turned the restriction on, and an edit is visible to the cached accessor at once, since that accessor is what
 * every page load and the nightly poll read. Adding through the service consults Mapillary, so these go through the
 * DAO and `removeCreator`, which do not.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class MapillarySourceServiceSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private def await[T](f: Future[T]): T = Await.result(f, 60.seconds)

  private val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private val table    = app.injector.instanceOf[MapillaryAllowedSourceTable]
  private val service  = app.injector.instanceOf[MapillarySourceService]

  private def run[T](action: DBIO[T]): T = await(dbConfig.db.run(action))

  private val TestCreator = "spec-5407-service"

  private def deleteTestCreator(): Unit = {
    val _ = run(sqlu"DELETE FROM mapillary_allowed_source WHERE source_value = $TestCreator")
  }

  /** Two real accounts to credit an add to, since `added_by` is a foreign key. */
  private lazy val userIds: Seq[String] =
    run(sql"SELECT user_id FROM sidewalk_login.sidewalk_user ORDER BY user_id LIMIT 2".as[String])

  "creatorAllowed" should {
    "admit every image when the allowlist is empty, creator or no creator" in {
      MapillarySourceService.creatorAllowed(Seq.empty, Some("anyone")) mustBe true
      MapillarySourceService.creatorAllowed(Seq.empty, None) mustBe true
    }

    "admit only the listed creators once there is a list" in {
      val allowed = Seq("profjfray", "alice")
      MapillarySourceService.creatorAllowed(allowed, Some("alice")) mustBe true
      MapillarySourceService.creatorAllowed(allowed, Some("stranger")) mustBe false
      // Mapillary's own creator_username filter is case-sensitive, and this has to agree with it.
      MapillarySourceService.creatorAllowed(allowed, Some("Alice")) mustBe false
      // An image whose response carried no creator can't be shown to be ours.
      MapillarySourceService.creatorAllowed(allowed, None) mustBe false
    }
  }

  "isPlausibleUsername" should {
    "accept the shapes Mapillary usernames take" in {
      Seq("profjfray", "makeability_lab", "a.b-c", "x" * 60).foreach { username =>
        MapillarySourceService.isPlausibleUsername(username) mustBe true
      }
    }

    "refuse anything unsafe to store or to put in a query" in {
      Seq("", " ", "two words", "a/b", "a&b=c", "o'brien", "x" * 61).foreach { username =>
        MapillarySourceService.isPlausibleUsername(username) mustBe false
      }
    }
  }

  "the allowlist" should {
    "keep the original adder when a creator is added twice" in {
      assume(userIds.size == 2, "fewer than two accounts in the connected database")
      deleteTestCreator()
      try {
        run(table.addCreator(TestCreator, userIds.head)) mustBe 1
        run(table.addCreator(TestCreator, userIds.last)) mustBe 0
        val (source, _) = run(table.allWithAdder).find(_._1.sourceValue == TestCreator).get
        source.addedBy mustBe Some(userIds.head)
      } finally deleteTestCreator()
    }

    "show a removal to the cached accessor at once" in {
      assume(userIds.nonEmpty, "no account in the connected database")
      deleteTestCreator()
      try {
        run(table.addCreator(TestCreator, userIds.head))
        // Read through the cache after a direct write: drop the key so this read is the one that fills it.
        await(
          app.injector.instanceOf[play.api.cache.AsyncCacheApi].remove(MapillarySourceService.AllowedCreatorsCacheKey)
        )
        await(service.getAllowedCreators) must contain(TestCreator)
        await(service.removeCreator(TestCreator)) mustBe 1
        await(service.getAllowedCreators) must not contain TestCreator
        await(service.removeCreator(TestCreator)) mustBe 0
      } finally deleteTestCreator()
    }
  }
}
