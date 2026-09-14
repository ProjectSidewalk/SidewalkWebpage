package controllers

import models.user.{MeasurementSystem, UserSettingsTableDef}
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._
import util.{AnonSession, RoleSession, RolledBackDb}

/**
 * The single-measurement-system contract (#4404): `ControllerUtils.measurementSystem` is the one units verdict, and
 * the shared layout stamps it on `<html data-measurement-system>` so `util.isMetric()` reads the server's answer back
 * instead of deriving units from the language separately. These specs pin the two inputs that decide it, the units
 * saved to the user's account and the language default, because a stamp that disagrees with the server leaves a page
 * showing kilometer numbers under a "miles" label.
 *
 * A saved choice belongs to an account, so each page is fetched with a fresh session, and their settings rows are
 * deleted in afterAll. Fetches /leaderboard because it renders for every visitor and always shows a distance.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class MeasurementSystemSpec
    extends PlaySpec
    with RoleSession
    with GuiceOneAppPerSuite
    with AnonSession
    with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .configure("rate-limit.anon-signup.enabled" -> false) // One session per page, more than the limiter allows.
      .build()

  /** Accounts behind the sessions this suite minted, so afterAll can delete their settings. */
  private val sessionUserIds = scala.collection.mutable.Set[String]()

  /**
   * Renders a page for a fresh session whose account has `saved` as its units.
   *
   * @param langCode The Accept-Language to render in.
   * @param saved    The account's saved units, or None for no saved choice.
   * @return         The /leaderboard page body.
   */
  private def pageOf(langCode: String, saved: Option[MeasurementSystem.Value] = None): String = {
    val session = freshAnonSession()
    val userId  = userIdOf(session)
    sessionUserIds += userId
    saved.foreach { system =>
      val _ = run(sqlu"""INSERT INTO sidewalk_login.user_settings (user_id, measurement_system)
                         VALUES ($userId, ${system.toString}::sidewalk_login.measurement_system)""")
    }
    val request = FakeRequest(GET, "/leaderboard").withHeaders("Accept-Language" -> langCode).withCookies(session: _*)
    val resp    = route(app, request).get
    status(resp) mustBe OK
    contentAsString(resp)
  }

  override def afterAll(): Unit = {
    val _ = run(TableQuery[UserSettingsTableDef].filter(_.userId inSet sessionUserIds.toSeq).delete)
    super.afterAll()
  }

  "The layout's data-measurement-system stamp" should {
    "follow the language's own system when the account has no saved choice" in {
      pageOf("en") must include("data-measurement-system=\"metric\"")
      pageOf("en-US") must include("data-measurement-system=\"imperial\"")
    }

    // A saved choice follows the user into every city (#3720), whatever language each one renders in.
    "follow the units saved to the account over the language, in both directions" in {
      pageOf("en", Some(MeasurementSystem.Imperial)) must include("data-measurement-system=\"imperial\"")
      pageOf("en-US", Some(MeasurementSystem.Metric)) must include("data-measurement-system=\"metric\"")
    }
  }

  "The distance words handed to i18next" should {
    // These are the only unit words the app has: client-side strings write {{unitAbbr}} / {{unitName}} and i18next
    // fills them from here. Lose them and every such string renders with an empty unit.
    "match the request's measurement system" in {
      val metric = pageOf("en")
      metric must include("\"unitAbbr\":\"km\"")
      metric must include("\"unitName\":\"kilometers\"")

      val imperial = pageOf("en-US")
      imperial must include("\"unitAbbr\":\"mi\"")
      imperial must include("\"unitName\":\"miles\"")
    }

    "follow a saved choice rather than the language, and stay in the language's own words" in {
      pageOf("en", Some(MeasurementSystem.Imperial)) must include("\"unitAbbrSmall\":\"ft\"")
      pageOf("es", Some(MeasurementSystem.Imperial)) must include("\"unitName\":\"millas\"")
      pageOf("es") must include("\"unitNameSingular\":\"kilómetro\"")
    }
  }

  // Server-rendered pages read the same words through ControllerUtils.distanceUnitWords rather than branching on
  // isMetric over a second set of message keys, so a page can't label a converted number with the other system's unit.
  "A server-rendered distance" should {
    "carry the abbreviation of the chosen system on the leaderboard" in {
      // Anchored on the closing tag: a bare " mi" also matches " minutes" and " missions", so it would pass on a page
      // that rendered no distance at all. The community band always renders one, so both directions have a subject.
      val metric = pageOf("en", Some(MeasurementSystem.Metric))
      metric must include(" km<")
      metric must not include " mi<"

      val imperial = pageOf("en", Some(MeasurementSystem.Imperial))
      imperial must include(" mi<")
      imperial must not include " km<"
    }
  }
}
