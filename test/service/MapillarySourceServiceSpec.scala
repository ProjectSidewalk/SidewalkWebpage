package service

import models.pano.{MapillarySourceMode, MapillarySourceTable}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.Json
import slick.dbio.DBIO

import scala.concurrent.duration._
import scala.concurrent.{Await, Future}

/**
 * Tests for the deployment's Mapillary creator restriction (#5407).
 *
 * The rules are pure functions, pinned first because everything else leans on them: only Restrict with creators
 * listed excludes any image (getting this backwards would blank every Mapillary city, or a merely preferring one),
 * and a username is only ever accepted in a shape that is safe to store and to put in a query.
 *
 * The rest pins the bookkeeping against the connected database: re-adding a creator keeps the original record of who
 * listed them, and an edit to the list or the mode is visible to the cached accessor at once, since that accessor is
 * what every page load and the nightly poll read. Adding through the service consults Mapillary, so these go through the
 * DAO and `removeCreator`, which do not.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class MapillarySourceServiceSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private def await[T](f: Future[T]): T = Await.result(f, 60.seconds)

  private val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private val table    = app.injector.instanceOf[MapillarySourceTable]
  private val service  = app.injector.instanceOf[MapillarySourceService]

  private def run[T](action: DBIO[T]): T = await(dbConfig.db.run(action))

  private val TestCreator = "spec-5407-service"

  private def deleteTestCreator(): Unit = {
    val _ = run(sqlu"DELETE FROM mapillary_source WHERE source_value = $TestCreator")
  }

  /** Two real accounts to credit an add to, since `added_by` is a foreign key. */
  private lazy val userIds: Seq[String] =
    run(sql"SELECT user_id FROM sidewalk_login.sidewalk_user ORDER BY user_id LIMIT 2".as[String])

  "imageUsable" should {
    import MapillarySourceService.{MapillarySources, imageUsable}
    val listed = Seq("profjfray", "alice")

    "admit every image when no creator is listed, whatever the mode" in {
      MapillarySourceMode.all.foreach { mode =>
        imageUsable(MapillarySources(mode, Seq.empty), Some("anyone")) mustBe true
        imageUsable(MapillarySources(mode, Seq.empty), None) mustBe true
      }
    }

    "admit every image under Prefer, since preferring outranks rather than excludes" in {
      val prefer = MapillarySources(MapillarySourceMode.Prefer, listed)
      imageUsable(prefer, Some("stranger")) mustBe true
      imageUsable(prefer, None) mustBe true
    }

    "admit only the listed creators under Restrict" in {
      val restrict = MapillarySources(MapillarySourceMode.Restrict, listed)
      imageUsable(restrict, Some("alice")) mustBe true
      imageUsable(restrict, Some("stranger")) mustBe false
      // Exact, because images carry Mapillary's spelling and the list stores that same spelling (canonicalCreator).
      imageUsable(restrict, Some("Alice")) mustBe false
      // An image whose response carried no creator can't be shown to be ours.
      imageUsable(restrict, None) mustBe false
    }
  }

  "MapillarySourceMode.fromName" should {
    "read back every mode by the name the DB CHECK stores, and nothing else" in {
      MapillarySourceMode.all.foreach(mode => MapillarySourceMode.fromName(mode.name) mustBe Some(mode))
      MapillarySourceMode.fromName("Prefer") mustBe None
      MapillarySourceMode.fromName("") mustBe None
    }
  }

  "canonicalCreator" should {
    "return Mapillary's spelling, whatever case the lookup was typed in" in {
      val response = Json.parse("""{"data": [{"id": "1", "creator": {"id": "9", "username": "profjfray"}}]}""")
      MapillarySourceService.canonicalCreator(response) mustBe Right(Some("profjfray"))
    }

    "report no imagery when Mapillary found none" in {
      MapillarySourceService.canonicalCreator(Json.parse("""{"data": []}""")) mustBe Right(None)
    }

    "refuse a response it can't read a creator from, rather than guess one" in {
      MapillarySourceService.canonicalCreator(Json.parse("""{"error": {}}""")).isLeft mustBe true
      MapillarySourceService.canonicalCreator(Json.parse("""{"data": [{"id": "1"}]}""")).isLeft mustBe true
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

  "the list" should {
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
          app.injector.instanceOf[play.api.cache.AsyncCacheApi].remove(MapillarySourceService.SourcesCacheKey)
        )
        await(service.getSources).creators must contain(TestCreator)
        await(service.removeCreator(TestCreator)) mustBe 1
        await(service.getSources).creators must not contain TestCreator
        await(service.removeCreator(TestCreator)) mustBe 0
      } finally deleteTestCreator()
    }
  }

  "the mode" should {
    "round-trip through the cached accessor at once, and be restored after" in {
      val original = await(service.getSources).mode
      try {
        MapillarySourceMode.all.foreach { mode =>
          await(service.setMode(mode)) mustBe 1
          await(service.getSources).mode mustBe mode
        }
      } finally {
        val _ = await(service.setMode(original))
      }
    }
  }
}
