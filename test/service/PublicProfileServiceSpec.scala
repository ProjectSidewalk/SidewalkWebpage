package service

import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder

import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

/**
 * DB-backed functional test for the public-profile privacy gate and trophy queries (User Dashboard redesign). Boots
 * the real app (real Slick/PostGIS) and calls UserService directly, so it covers the actual findByUsername +
 * getPrivacySettings + TrophyTable SQL without needing Silhouette fixtures for the SecuredAction controllers.
 *
 * Assertions use a username/user id that cannot exist, so they are deterministic against whatever the connected DB
 * contains: an unknown mapper must resolve to "not found" (never leak), and the trophy queries must run and return an
 * empty result rather than throwing. Requires Postgres+PostGIS (DATABASE_URL / _USER / _PASSWORD, as in dev/CI).
 */
class PublicProfileServiceSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val userService = app.injector.instanceOf[UserService]

  // A username/id that cannot exist, so every assertion below is deterministic regardless of DB contents.
  private val ghostName = "__no_such_user_ud_spec__"
  private val ghostId   = "00000000-0000-0000-0000-000000000000"

  private def await[T](f: => scala.concurrent.Future[T]): T = Await.result(f, 60.seconds)

  "UserService.resolveVisibleUser (public-profile map gate)" should {
    "return None for an unknown username, whether or not the viewer claims to be the owner" in {
      await(userService.resolveVisibleUser(ghostName, isOwner = false)) mustBe None
      await(userService.resolveVisibleUser(ghostName, isOwner = true)) mustBe None
    }
  }

  "UserService.getPublicProfile" should {
    "return None (the not-found state) for an unknown username" in {
      await(
        userService.getPublicProfile(ghostName, isOwner = false, isMetric = false, cityName = "Testville")
      ) mustBe None
    }
  }

  "UserService.getPrivacySettings" should {
    "return None when the user has no user_stat row (privacy-safe: reads as private downstream)" in {
      await(userService.getPrivacySettings(ghostId)) mustBe None
    }
  }

  "UserService.getTrophies" should {
    "run all four queries and return an empty list for a user with no contributions (no crash)" in {
      await(userService.getTrophies(ghostId, "Testville")) mustBe empty
    }
  }
}
