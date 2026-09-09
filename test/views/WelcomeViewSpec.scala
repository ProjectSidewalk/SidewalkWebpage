package views

import controllers.AssetsFinder
import models.user.{Role, SidewalkUserWithRole}
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.i18n.{Lang, Messages, MessagesApi}
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.mvc.RequestHeader
import play.api.test.{CSRFTokenHelper, FakeRequest}
import play.api.{Application, Configuration}
import service.{CommonPageData, ConfigService}

import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

/**
 * Renders the post-signup welcome page directly.
 *
 * The page is only reachable right after a real registration, so the privacy panel added for #4375 — which is the
 * whole point of putting the choice in front of a brand-new user — has no route spec that can reach it. Rendering
 * the template is how it gets exercised.
 */
class WelcomeViewSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  // The page carries a service-hours form, so the request has to hold a CSRF token for the template to render.
  implicit private val request: RequestHeader = CSRFTokenHelper.addCSRFToken(FakeRequest())
  implicit private val messages: Messages     = app.injector.instanceOf[MessagesApi].preferred(Seq(Lang("en")))
  implicit private val assets: AssetsFinder   = app.injector.instanceOf[AssetsFinder]
  implicit private val config: Configuration  = app.injector.instanceOf[Configuration]

  private val commonData: CommonPageData =
    Await.result(app.injector.instanceOf[ConfigService].getCommonPageData(Lang("en")), 60.seconds)

  private val user =
    SidewalkUserWithRole("test-user", "testmapper", "test@example.com", Role.Registered, communityService = false,
      infra3dAccess = false)

  private def render(
      onLeaderboard: Boolean = true,
      publicProfile: Boolean = true,
      privateByDefault: Boolean = false
  ): String =
    views.html.authentication
      .welcome(commonData, user, "/explore", resumed = false, onLeaderboard, publicProfile, privateByDefault)
      .body

  "The welcome page" should {
    "tell a new user where their username shows up" in {
      val body = render()
      body must include("wl-privacy")
      body must include(user.username)
      body must include(Messages("welcome.privacy.title"))
    }

    "check each privacy box only when the user's flag is actually on" in {
      val bothOn = render(onLeaderboard = true, publicProfile = true)
      bothOn must include("""<input type="checkbox" id="wl-on-leaderboard" checked>""")
      bothOn must include("""<input type="checkbox" id="wl-public-profile" checked>""")

      val bothOff = render(onLeaderboard = false, publicProfile = false)
      bothOff must include("""<input type="checkbox" id="wl-on-leaderboard" >""")
      bothOff must include("""<input type="checkbox" id="wl-public-profile" >""")
    }

    "explain the private-by-default setting only on deployments that use it" in {
      render(privateByDefault = true) must include(Messages("welcome.privacy.default.private"))
      render(privateByDefault = false) must not include Messages("welcome.privacy.default.private")
    }
  }
}
