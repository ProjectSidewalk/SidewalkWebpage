package views

import controllers.AssetsFinder
import models.user.{SidewalkUserWithRole, UserStat}
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.i18n.{Lang, Messages, MessagesApi}
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.mvc.RequestHeader
import play.api.test.FakeRequest
import play.api.{Application, Configuration}
import service.{AdminUserProfileData, CityHours, CommonPageData, ConfigService, CrossCityHours}

import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

/**
 * Renders the Manage user page directly against synthetic hour breakdowns (#4986).
 *
 * The hours an admin reads here and the hours the user reads on `/timeCheck` are the same claim seen from both sides,
 * so they have to be the same number: a per-deployment figure here made a multi-city volunteer look like they had
 * inflated their total. Both pages are `SecuredAction`s over a database that has one city locally, so the multi-city
 * case they must agree on is only reachable by rendering the templates.
 */
class AdminUserViewSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit private val request: RequestHeader = FakeRequest()
  implicit private val messages: Messages     = app.injector.instanceOf[MessagesApi].preferred(Seq(Lang("en")))
  implicit private val assets: AssetsFinder   = app.injector.instanceOf[AssetsFinder]
  implicit private val config: Configuration  = app.injector.instanceOf[Configuration]

  private val commonData: CommonPageData =
    Await.result(app.injector.instanceOf[ConfigService].getCommonPageData(Lang("en")), 60.seconds)

  private val admin =
    SidewalkUserWithRole("admin-user", "testadmin", "admin@example.com", "Administrator", communityService = false,
      infra3dAccess = false)
  private val subject =
    SidewalkUserWithRole("test-user", "testmapper", "test@example.com", "Registered", communityService = false,
      infra3dAccess = false)

  private val userStats = UserStat(1, subject.userId, 0d, None, highQuality = true, None, 0, None, excluded = false,
    onLeaderboard = true, publicProfile = true)
  private val adminData = AdminUserProfileData(None, userStats, Seq.empty)

  private val twoCities = Seq(
    CityHours("teaneck-nj", "Teaneck", 6.3, isCurrentCity = true),
    CityHours("seattle-wa", "Seattle", 4.5, isCurrentCity = false)
  )

  private def render(cities: Seq[CityHours], unreachableCities: Int = 0): String =
    views.html.userDashboard
      .adminUser(commonData, admin, subject, adminData, CrossCityHours(cities, unreachableCities), None, Seq.empty)
      .body

  /** The hours KPI, read out of the tile that displays it rather than off the page at large. */
  private def kpiHours(body: String): Double =
    """<span class="coverage-kpi-value">([\d.]+) h</span>""".r
      .findFirstMatchIn(body)
      .map(_.group(1).toDouble)
      .getOrElse(fail("no hours KPI rendered"))

  "The Manage user page" should {
    "report the user's total across every city, not just the deployment being administered" in {
      kpiHours(render(twoCities)) mustBe 10.8
    }

    "report exactly what the user reads on their own Time Check page" in {
      // The disagreement between these two numbers is the whole of #4986: an admin verifying service hours against a
      // smaller figure than the volunteer was shown reads it as an inflated claim.
      val hours     = CrossCityHours(twoCities, 0)
      val adminBody = views.html.userDashboard
        .adminUser(commonData, admin, subject, adminData, hours, None, Seq.empty)
        .body
      val volunteerBody = views.html.timeCheck(commonData, subject, isMobile = false, hours).body

      val volunteerTotal = """<span class="tc-stat-num">([\d.]+)</span>""".r
        .findFirstMatchIn(volunteerBody)
        .map(_.group(1).toDouble)
        .getOrElse(fail("no headline number on the Time Check page"))
      kpiHours(adminBody) mustBe volunteerTotal
    }

    "break the total down by city, marking the deployment being administered" in {
      val body = render(twoCities)
      body must include("Where their time came from")
      body must include("Teaneck")
      body must include("Seattle")
      body must include(">6.3<")
      body must include(">4.5<")
      body must include("(this deployment)")
    }

    "tie the breakdown table to its heading for screen readers" in {
      val body = render(twoCities)
      body must include("""id="au-hours-cities-title"""")
      body must include("""aria-labelledby="au-hours-cities-title"""")
    }

    "stay a single number for a user who has only worked in this city" in {
      val body = render(Seq(CityHours("teaneck-nj", "Teaneck", 3.5, isCurrentCity = true)))
      kpiHours(body) mustBe 3.5
      body must not include "Where their time came from"
    }

    "name the city when the only city with hours isn't the one being administered" in {
      // Otherwise the admin gets a bare number that looks like it was earned on this deployment.
      val body = render(Seq(CityHours("seattle-wa", "Seattle", 3.5, isCurrentCity = false)))
      kpiHours(body) mustBe 3.5
      body must include("Where their time came from")
      body must include("Seattle")
      body must not include "(this deployment)"
    }

    "show zero rather than an error for a user who has done nothing anywhere" in {
      kpiHours(render(Seq.empty)) mustBe 0.0
    }

    "say so when a city couldn't be reached, rather than quietly showing less time" in {
      val body = render(Seq(CityHours("teaneck-nj", "Teaneck", 3.5, isCurrentCity = true)), unreachableCities = 2)
      body must include("Couldn't total 2 cities just now")
    }

    "count a single unreachable city in the singular" in {
      val body = render(Seq(CityHours("teaneck-nj", "Teaneck", 3.5, isCurrentCity = true)), unreachableCities = 1)
      body must include("Couldn't total 1 city just now")
    }

    "keep quiet about unreachable cities when every city was totalled" in {
      render(twoCities) must not include "Couldn't total"
    }
  }
}
