package views

import controllers.AssetsFinder
import models.user.SidewalkUserWithRole
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.i18n.{Lang, Messages, MessagesApi}
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.mvc.RequestHeader
import play.api.test.FakeRequest
import play.api.{Application, Configuration}
import service.{CityHours, CommonPageData, ConfigService}

import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

/**
 * Renders the Time Check page directly against synthetic hour breakdowns.
 *
 * The page is a `SecuredAction`, and the local database's multi-city volunteers can't be signed in from a test, so
 * the one branch that matters most for #4526 — a volunteer whose hours came from several cities — is unreachable
 * through a route spec. Rendering the template is how that branch gets exercised at all.
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
    SidewalkUserWithRole("test-user", "testmapper", "test@example.com", "Registered", communityService = false,
      infra3dAccess = false)

  private def render(cityHours: Seq[CityHours]): String =
    views.html.timeCheck(commonData, user, isMobile = false, cityHours).body

  "The Time Check page" should {
    "headline the total across every city, not just the one being viewed" in {
      val body = render(
        Seq(
          CityHours("teaneck-nj", "Teaneck", 6.25, isCurrentCity = true),
          CityHours("seattle-wa", "Seattle", 4.5, isCurrentCity = false)
        )
      )
      body must include(">10.8<") // 6.25 + 4.5, to one decimal
      body must include("Where your time came from")
      body must include("Teaneck")
      body must include("Seattle")
      body must include("6.2")
      body must include("4.5")
    }

    "mark the city being viewed, so a volunteer can tell which row this deployment produced" in {
      val body = render(
        Seq(
          CityHours("teaneck-nj", "Teaneck", 6.25, isCurrentCity = true),
          CityHours("seattle-wa", "Seattle", 4.5, isCurrentCity = false)
        )
      )
      body must include("tc-cities-here")
    }

    "stay a single number for a volunteer who has only worked in one city" in {
      val body = render(Seq(CityHours("teaneck-nj", "Teaneck", 3.5, isCurrentCity = true)))
      body must include(">3.5<")
      body must not include "Where your time came from"
      body must not include "tc-stat-scope"
    }

    "show zero rather than an error for a volunteer with nothing logged anywhere" in {
      val body = render(Seq.empty)
      body must include(">0.0<")
      body must not include "Where your time came from"
    }
  }
}
