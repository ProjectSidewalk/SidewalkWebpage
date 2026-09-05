package views

import controllers.AssetsFinder
import models.user.{Role, SidewalkUserWithRole}
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.i18n.{Lang, Messages, MessagesApi}
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.mvc.RequestHeader
import play.api.test.FakeRequest
import play.api.{Application, Configuration}
import service.{CityHours, CommonPageData, ConfigService, CrossCityHours}

import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

/**
 * Renders the Time Check page directly against synthetic hour breakdowns.
 *
 * The page is a `SecuredAction`, and the local database's multi-city volunteers can't be signed in from a test, so
 * the one branch that matters most for #4526 — a volunteer whose hours came from several cities — is unreachable
 * through a route spec. Rendering the template is how that branch gets exercised at all.
 *
 * Fixture hours are always multiples of 0.1, because that is the contract `UserService.getCrossCityHours` guarantees:
 * it rounds before the view sees anything, so the headline is the sum of the rows exactly as rendered.
 */
class TimeCheckViewSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit private val request: RequestHeader = FakeRequest()
  implicit private val messages: Messages     = app.injector.instanceOf[MessagesApi].preferred(Seq(Lang("en")))
  implicit private val assets: AssetsFinder   = app.injector.instanceOf[AssetsFinder]
  implicit private val config: Configuration  = app.injector.instanceOf[Configuration]

  private val commonData: CommonPageData =
    Await.result(app.injector.instanceOf[ConfigService].getCommonPageData(Lang("en")), 60.seconds)

  private val user =
    SidewalkUserWithRole("test-user", "testmapper", "test@example.com", Role.Registered, communityService = false,
      infra3dAccess = false)

  private def render(cities: Seq[CityHours], unreachableCities: Int = 0): String =
    views.html.timeCheck(commonData, user, isMobile = false, CrossCityHours(cities, unreachableCities)).body

  /** The headline figure, read out of the element that displays it rather than off the page at large. */
  private def headline(body: String): Double =
    """<span class="tc-stat-num">([\d.]+)</span>""".r
      .findFirstMatchIn(body)
      .map(_.group(1).toDouble)
      .getOrElse(fail("no headline number rendered"))

  /** The hours cell of each breakdown row, in the order rendered. */
  private def rowHours(body: String): Seq[Double] =
    """<td>([\d.]+)</td>""".r.findAllMatchIn(body).map(_.group(1).toDouble).toSeq

  "The Time Check page" should {
    "headline the total across every city, not just the one being viewed" in {
      val body = render(
        Seq(
          CityHours("teaneck-nj", "Teaneck", 6.3, isCurrentCity = true),
          CityHours("seattle-wa", "Seattle", 4.5, isCurrentCity = false)
        )
      )
      body must include(">10.8<")
      body must include("Where your time came from")
      body must include("Teaneck")
      body must include("Seattle")
      body must include(">6.3<")
      body must include(">4.5<")
    }

    "render a headline that is exactly the sum of the rows beneath it" in {
      // Rows that each round independently can add up to something other than a separately-rounded total, so the
      // service rounds first and the page only ever sums what it displays.
      val body = render(
        Seq(
          CityHours("teaneck-nj", "Teaneck", 0.3, isCurrentCity = true),
          CityHours("seattle-wa", "Seattle", 0.3, isCurrentCity = false)
        )
      )
      headline(body) mustBe 0.6
      rowHours(body).sum mustBe headline(body)
    }

    "mark the city being viewed, so a volunteer can tell which row this deployment produced" in {
      val body = render(
        Seq(
          CityHours("teaneck-nj", "Teaneck", 6.3, isCurrentCity = true),
          CityHours("seattle-wa", "Seattle", 4.5, isCurrentCity = false)
        )
      )
      body must include("tc-cities-here")
    }

    "tie the breakdown table to its heading for screen readers" in {
      val body = render(
        Seq(
          CityHours("teaneck-nj", "Teaneck", 6.3, isCurrentCity = true),
          CityHours("seattle-wa", "Seattle", 4.5, isCurrentCity = false)
        )
      )
      body must include("""id="tc-cities-title"""")
      body must include("""aria-labelledby="tc-cities-title"""")
    }

    "stay a single number for a volunteer who has only worked in this city" in {
      val body = render(Seq(CityHours("teaneck-nj", "Teaneck", 3.5, isCurrentCity = true)))
      body must include(">3.5<")
      body must not include "Where your time came from"
      body must not include "tc-stat-scope"
    }

    "name the city when the only city with hours isn't the one being viewed" in {
      // Otherwise a volunteer who mapped only in Seattle, opening Teaneck's page, gets a bare unattributed number.
      val body = render(Seq(CityHours("seattle-wa", "Seattle", 3.5, isCurrentCity = false)))
      body must include(">3.5<")
      body must include("Where your time came from")
      body must include("Seattle")
      body must not include "tc-cities-here"
    }

    "show zero rather than an error for a volunteer with nothing logged anywhere" in {
      val body = render(Seq.empty)
      body must include(">0.0<")
      body must not include "Where your time came from"
    }

    "say so when a city couldn't be reached, rather than quietly reporting less time" in {
      val body = render(Seq(CityHours("teaneck-nj", "Teaneck", 3.5, isCurrentCity = true)), unreachableCities = 2)
      body must include("tc-incomplete")
      body must include("we couldn't check 2 cities just now")
    }

    "count a single unreachable city in the singular" in {
      val body = render(Seq(CityHours("teaneck-nj", "Teaneck", 3.5, isCurrentCity = true)), unreachableCities = 1)
      body must include("we couldn't check 1 city just now")
    }

    "keep quiet about unreachable cities when every city was totalled" in {
      val body = render(Seq(CityHours("teaneck-nj", "Teaneck", 3.5, isCurrentCity = true)))
      body must not include "tc-incomplete"
    }
  }
}
