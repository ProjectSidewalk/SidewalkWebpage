package views

import controllers.AssetsFinder
import formats.json.UserFormats._
import models.user.{SidewalkUserWithRole, UserStat}
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.i18n.{Lang, Messages, MessagesApi}
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsObject, Json}
import play.api.mvc.RequestHeader
import play.api.test.FakeRequest
import play.api.{Application, Configuration}
import service.{AdminUserProfileData, CityHours, CommonPageData, ConfigService, CrossCityHours}

import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

/**
 * The hours the Manage user page reports (#4986).
 *
 * What an admin reads there and what the user reads on `/timeCheck` are the same claim seen from both sides, so they
 * have to be the same number: a per-deployment figure on the admin side made a multi-city volunteer look like they had
 * inflated their total. That page fills its KPI from `adminGetCrossCityHours` after rendering, so the agreement is
 * pinned between that payload and what the volunteer's page displays, and separately that the page ships the ids and
 * URL its script needs. What the script does with the payload is `test/js/adminUserHours.test.js`.
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

  private val adminPage: String =
    views.html.userDashboard.manageUser(commonData, admin, subject, adminData, None, Seq.empty).body

  private def payload(cities: Seq[CityHours], unreachableCities: Int = 0): JsObject =
    Json.toJson(CrossCityHours(cities, unreachableCities)).as[JsObject]

  /** The headline figure the volunteer reads, out of the element that displays it rather than the page at large. */
  private def timeCheckHeadline(hours: CrossCityHours): Double = {
    val body = views.html.timeCheck(commonData, subject, isMobile = false, hours).body
    """<span class="tc-stat-num">([\d.]+)</span>""".r
      .findFirstMatchIn(body)
      .map(_.group(1).toDouble)
      .getOrElse(fail("no headline number on the Time Check page"))
  }

  "The Manage user page's hours" should {
    "report exactly what the user reads on their own Time Check page" in {
      // The disagreement between these two numbers is the whole of #4986: an admin verifying service hours against a
      // smaller figure than the volunteer was shown reads it as an inflated claim.
      val hours = CrossCityHours(twoCities, 0)
      (payload(twoCities) \ "total_hours").as[Double] mustBe timeCheckHeadline(hours)
    }

    "total every city, not just the deployment being administered" in {
      (payload(twoCities) \ "total_hours").as[Double] mustBe 10.8
    }

    "send a breakdown that adds up to the total displayed above it" in {
      // Rows that each round independently can add up to something other than a separately-rounded total, and a
      // breakdown that visibly fails to reconcile is what makes an admin doubt the headline.
      val json = payload(
        Seq(
          CityHours("teaneck-nj", "Teaneck", 0.3, isCurrentCity = true),
          CityHours("seattle-wa", "Seattle", 0.3, isCurrentCity = false)
        )
      )
      val rows = (json \ "cities").as[Seq[JsObject]].map(city => BigDecimal.decimal((city \ "hours").as[Double]))
      rows.sum.toDouble mustBe (json \ "total_hours").as[Double]
    }

    "ask for a breakdown once the time came from more than one city" in {
      (payload(twoCities) \ "show_breakdown").as[Boolean] mustBe true
      (payload(twoCities) \ "cities").as[Seq[JsObject]].map(city => (city \ "city_name").as[String]) mustBe
        Seq("Teaneck", "Seattle")
    }

    "stay a single number for a user who has only worked in this city" in {
      val json = payload(Seq(CityHours("teaneck-nj", "Teaneck", 3.5, isCurrentCity = true)))
      (json \ "total_hours").as[Double] mustBe 3.5
      (json \ "show_breakdown").as[Boolean] mustBe false
    }

    "name the city when the only city with hours isn't the one being administered" in {
      // Otherwise the admin gets a bare number that looks like it was earned on this deployment.
      val json = payload(Seq(CityHours("seattle-wa", "Seattle", 3.5, isCurrentCity = false)))
      (json \ "total_hours").as[Double] mustBe 3.5
      (json \ "show_breakdown").as[Boolean] mustBe true
    }

    "show zero rather than an error for a user who has done nothing anywhere" in {
      val json = payload(Seq.empty)
      (json \ "total_hours").as[Double] mustBe 0.0
      (json \ "show_breakdown").as[Boolean] mustBe false
    }

    "carry how many cities went untotalled, so the page can say the figure is a floor" in {
      (payload(twoCities, unreachableCities = 2) \ "unreachable_cities").as[Int] mustBe 2
      (payload(twoCities) \ "unreachable_cities").as[Int] mustBe 0
    }
  }

  "The Manage user page" should {
    "point its script at this user's hours endpoint" in {
      // The one link in the chain that breaks silently: a renamed route leaves the KPI stuck on its placeholder.
      adminPage must include(s"/adminapi/users/${subject.userId}/crossCityHours")
    }

    "ship the hooks the script fills, so the hours have somewhere to land" in {
      Seq("au-hours-kpi", "au-hours-value", "au-hours-label", "au-hours-cities", "au-hours-cities-table",
        "au-hours-note").foreach { id => adminPage must include(s"""id="$id"""") }
    }

    "tie the breakdown table to its heading for screen readers" in {
      adminPage must include("""id="au-hours-cities-title"""")
    }

    "keep the breakdown and its caveat out of the page until the hours arrive" in {
      // Both start hidden; an empty table and an empty callout are worse than nothing while the fetch is in flight.
      adminPage must include("""<div id="au-hours-cities" hidden>""")
      adminPage must include("""id="au-hours-note" hidden>""")
    }
  }
}
