package controllers

import controllers.helper.ControllerUtils.MeasurementSystem
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.mvc.Cookie
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * The single-measurement-system contract (#4404): `ControllerUtils.measurementSystem` is the one units verdict, and
 * the shared layout stamps it on `<html data-measurement-system>` so `util.isMetric()` reads the server's answer back
 * instead of deriving units from the language separately. These specs pin the three inputs that decide it — the
 * language default, the user's override cookie, and a junk cookie value — because a stamp that disagrees with the
 * server leaves a page showing kilometer numbers under a "miles" label.
 *
 * Fetches /signIn because it serves every visitor with no session or data requirements.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class MeasurementSystemSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .build()

  private def stampOf(langCode: String, override_ : Option[String] = None): String =
    pageOf("/signIn", langCode, override_)

  private def pageOf(path: String, langCode: String, override_ : Option[String]): String = {
    val base    = FakeRequest(GET, path).withHeaders("Accept-Language" -> langCode)
    val request = override_.fold(base)(value => base.withCookies(Cookie(MeasurementSystem.CookieName, value)))
    val resp    = route(app, request).get
    status(resp) mustBe OK
    contentAsString(resp)
  }

  "The layout's data-measurement-system stamp" should {
    "fall back to the language's own system when the visitor has set no override" in {
      stampOf("en") must include("data-measurement-system=\"metric\"")
      stampOf("en-US") must include("data-measurement-system=\"imperial\"")
    }

    "honor an override cookie over the language default, in both directions" in {
      stampOf("en", Some(MeasurementSystem.Imperial)) must include("data-measurement-system=\"imperial\"")
      stampOf("en-US", Some(MeasurementSystem.Metric)) must include("data-measurement-system=\"metric\"")
    }

    // A cookie is visitor-supplied, so an unrecognized value must read as "no override" rather than reaching the page.
    "ignore a cookie value that names neither system" in {
      stampOf("en-US", Some("furlongs")) must include("data-measurement-system=\"imperial\"")
    }
  }

  "The distance words handed to i18next" should {
    // These are the only unit words the app has: client-side strings write {{unitAbbr}} / {{unitName}} and i18next
    // fills them from here. Lose them and every such string renders with an empty unit.
    "match the request's measurement system" in {
      val metric = stampOf("en")
      metric must include("\"unitAbbr\":\"km\"")
      metric must include("\"unitName\":\"kilometers\"")

      val imperial = stampOf("en-US")
      imperial must include("\"unitAbbr\":\"mi\"")
      imperial must include("\"unitName\":\"miles\"")
    }

    "follow an override rather than the language, and stay in the language's own words" in {
      stampOf("en", Some(MeasurementSystem.Imperial)) must include("\"unitAbbrSmall\":\"ft\"")
      stampOf("es", Some(MeasurementSystem.Imperial)) must include("\"unitName\":\"millas\"")
      stampOf("es") must include("\"unitNameSingular\":\"kilómetro\"")
    }
  }

  // Server-rendered pages read the same words through ControllerUtils.distanceUnitWords rather than branching on
  // isMetric over a second set of message keys, so a page can't label a converted number with the other system's unit.
  "A server-rendered distance" should {
    "carry the abbreviation of the chosen system on the leaderboard" in {
      val metric = pageOf("/leaderboard", "en", Some(MeasurementSystem.Metric))
      metric must include(" km")
      metric must not include " mi<"

      val imperial = pageOf("/leaderboard", "en", Some(MeasurementSystem.Imperial))
      imperial must include(" mi")
      imperial must not include " km<"
    }
  }
}
