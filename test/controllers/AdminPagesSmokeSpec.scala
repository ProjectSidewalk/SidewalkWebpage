package controllers

import models.user.Role
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api.given
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.Json
import play.api.mvc.Cookie
import play.api.routing.Router
import play.api.test.CSRFTokenHelper.*
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import play.utils.UriEncoding
import service.AuthenticationService
import util.{AnonSession, RoleSession, SidewalkSpec}

import scala.concurrent.Await
import scala.concurrent.duration.*
import scala.util.matching.Regex

/**
 * HTTP smoke tests for every admin page (#4276): each renders for the role it requires, loads its own page entry, and
 * still carries the containers that entry writes into; and each refuses anyone below that role.
 *
 * Motivated by the #4272 split, where `/admin` kept rendering a template that called a removed `Admin()` and nothing
 * went red until someone opened the page. Each page loads one module entry (`frontend/js/pages/admin/<page>.js`) that
 * fills elements by id, so the entry tag and those ids are the contract a server-side test can see. A view that drops
 * the tag, names another page's entry, or renames a container renders its static text fine and its data sections
 * blank, with no console error for the Playwright smoke suite to catch.
 *
 * The id lists are a few load-bearing containers per page (status line, main charts and tables), not every id the
 * page's JS touches, so a cosmetic rename doesn't churn this spec. A last case walks the live route table, so a new
 * `/admin` page that isn't added here fails rather than going untested.
 *
 * Every page renders static HTML and fetches its data afterwards, so none of these depend on what the city holds;
 * CI's near-empty schema exercises them the same as a full one. The team and user pages make their own subject.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class AdminPagesSmokeSpec extends SidewalkSpec with RoleSession with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // Four sessions are minted here, and the anon-signup limiter is per IP, shared with every suite in the run.
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  /**
   * One admin page as the smoke test sees it.
   *
   * @param pattern The route as `conf/routes` declares it; `:teamId` and `:username` are filled in per run.
   * @param entry   The page's module entry under `build/js/`, without `.js`. Specs run against the unstaged build,
   *                where `build/js/<entry>.js` is the path the view emits.
   * @param shell   The layout entry every page of that family loads alongside its own.
   * @param ids     Containers the entry writes into, which must survive in the rendered body.
   * @param role    The least role the page admits.
   */
  private case class AdminPage(
      pattern: String,
      entry: String,
      ids: Seq[String],
      shell: String = "admin/shell",
      role: Role = Role.Administrator
  )

  private val Pages: Seq[AdminPage] = Seq(
    // /admin is the overview itself rather than a redirect to it; the #4272 regression was this route alone.
    AdminPage("/admin", "admin/overview", Seq("ov-pulse", "ov-attention", "ov-status", "ov-recent")),
    AdminPage("/admin/overview", "admin/overview", Seq("ov-pulse", "ov-attention", "ov-status", "ov-recent")),
    AdminPage(
      "/admin/coverage",
      "admin/coverage",
      Seq("coverage-status", "kpi-city-coverage", "coverage-legend", "coverage-bars-view", "coverage-distribution-view")
    ),
    AdminPage(
      "/admin/street-status",
      "admin/streetStatus",
      Seq("street-status-status", "kpi-total-streets", "street-status-legend", "trend-status-chart",
        "trend-reopen-candidates")
    ),
    AdminPage(
      "/admin/imagery",
      "admin/imagery",
      Seq("imagery-status", "imagery-pipeline-status", "imagery-poll-chart", "imagery-rotation",
        "imagery-freshness-chart")
    ),
    AdminPage(
      "/admin/sidewalks",
      "admin/sidewalks",
      Seq("sidewalks-status", "sidewalks-filters", "sidewalks-map", "sidewalks-legend")
    ),
    AdminPage(
      "/admin/label-map",
      "admin/labelMap",
      Seq("label-map-search", "label-map-search-input", "label-map-search-msg", "admin-labelmap-choropleth")
    ),
    AdminPage(
      "/admin/quality",
      "admin/quality",
      Seq("dq-status", "kpi-total-labels", "dq-labels", "dq-validation", "dq-trend", "dq-tags")
    ),
    AdminPage(
      "/admin/contributors",
      "admin/contributors",
      Seq("contrib-status", "kpi-contributors", "funnel-blocks", "contrib-top-labelers", "contrib-top-validators")
    ),
    AdminPage(
      "/admin/activity",
      "admin/activity",
      Seq("activity-status", "activity-latest", "activity-volume", "activity-active", "activity-feed")
    ),
    AdminPage("/admin/stories", "admin/stories", Seq("stories-status", "stories-queue")),
    AdminPage(
      "/admin/humans-vs-ai",
      "admin/humansVsAi",
      Seq("hva-status", "hva-summary", "kpi-ai-labels", "hva-type-mix", "hva-verdicts")
    ),
    AdminPage(
      "/admin/api-analytics",
      "admin/apiAnalytics",
      Seq("api-status", "kpi-external-calls", "api-trend", "api-endpoints", "api-formats")
    ),
    AdminPage(
      "/admin/management",
      "admin/management",
      Seq("mgmt-status", "mgmt-user-search", "mgmt-users", "mgmt-teams", "mgmt-maint-result")
    ),
    AdminPage(
      "/admin/partners",
      "admin/partners",
      Seq("partners-status", "official-contact-form", "official-contact-preview", "official-contact-status")
    ),
    AdminPage(
      "/admin/across-cities",
      "admin/acrossCities",
      Seq("ac-tbody", "ac-cities-map", "ac-attention", "ac-funnels", "ac-quality-tbody"),
      role = Role.Owner
    ),
    AdminPage(
      "/admin/health",
      "admin/health",
      Seq("health-pulse", "health-meta", "health-jobs", "health-locks", "health-connections"),
      role = Role.Owner
    ),
    AdminPage(
      "/admin/team/:teamId",
      "admin/team",
      Seq("team-status", "team-members", "team-add-search", "team-add-results")
    ),
    AdminPage(
      "/admin/user/:username",
      "dashboard/dashboard",
      Seq("ud-cities-status", "ud-cities-map", "ud-routes-list", "ud-mistakes", "ud-stories"),
      shell = "dashboard/shell"
    ),
    AdminPage(
      "/admin/user/:username/manage",
      "dashboard/manageUser",
      Seq("au-username", "au-role", "au-save-btn", "au-hours-value", "au-hours-cities-table"),
      shell = "dashboard/shell"
    )
  )

  /**
   * Admin page routes this suite leaves to another spec, each with where it's covered. `/admin/label/:labelId` is the
   * public spotlight page in admin mode and needs a real label, which `AdminLabelPageSpec` handles.
   */
  private val CoveredElsewhere: Map[String, String] = Map("/admin/label/:labelId" -> "AdminLabelPageSpec")

  private val NamePrefix = "spec-4276-"

  private lazy val adminCookies: Seq[Cookie]   = sessionAs(Role.Administrator)
  private lazy val ownerCookies: Seq[Cookie]   = sessionAs(Role.Owner)
  private lazy val visitorCookies: Seq[Cookie] = sessionAs(Role.Registered)

  /** A registered account for the user pages to be about, so neither page renders the admin viewing themself. */
  private lazy val subjectUsername: String = {
    val userId = userIdOf(sessionAs(Role.Registered))
    Await
      .result(app.injector.instanceOf[AuthenticationService].findByUserId(userId), 30.seconds)
      .map(_.username)
      .getOrElse(fail(s"The subject account $userId has no user row."))
  }

  /** A team made by the visitor account for the team page to show, deleted again in `afterAll`. */
  private lazy val teamId: Int = {
    val resp = route(
      app,
      FakeRequest(POST, "/userapi/createTeam")
        .withCookies(visitorCookies*)
        .withJsonBody(Json.obj("name" -> s"$NamePrefix${System.nanoTime()}", "description" -> "A smoke spec's team"))
        .withCSRFToken
    ).get
    status(resp) mustBe OK
    (contentAsJson(resp) \ "team_id").as[Int]
  }

  override def afterAll(): Unit = {
    val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
    Await.result(
      dbConfig.db.run(
        sqlu"""DELETE FROM user_team WHERE team_id IN (SELECT team_id FROM team WHERE name LIKE ${NamePrefix + "%"})"""
          .andThen(sqlu"DELETE FROM team WHERE name LIKE ${NamePrefix + "%"}")
      ),
      30.seconds
    )
    super.afterAll()
  }

  /** @return The requestable path for a page, its dynamic segments filled with this run's own subjects. */
  private def pathOf(page: AdminPage): String = {
    // Resolved only when the pattern needs them, so a failed team or subject setup fails just the pages that use it.
    val withTeam =
      if (page.pattern.contains(":teamId")) page.pattern.replace(":teamId", teamId.toString) else page.pattern
    if (withTeam.contains(":username"))
      withTeam.replace(":username", UriEncoding.encodePathSegment(subjectUsername, "UTF-8"))
    else withTeam
  }

  /** @return The session of the least role that may see the page. */
  private def cookiesFor(role: Role): Seq[Cookie] = if (role == Role.Owner) ownerCookies else adminCookies

  "Each admin page" should {
    Pages.foreach { page =>
      s"render GET ${page.pattern} for ${page.role.name}, with its entry and its containers" in {
        val resp = route(app, FakeRequest(GET, pathOf(page)).withCookies(cookiesFor(page.role)*)).get
        status(resp) mustBe OK
        val body = contentAsString(resp)

        withClue("the layout entry is not loaded: ")(body must include(s"build/js/${page.shell}.js"))
        withClue("the page entry is not loaded: ")(body must include(s"build/js/${page.entry}.js"))
        page.ids.foreach { id =>
          withClue(s"container #$id, which the page entry writes into, is missing: ")(
            body must include(s"""id="$id"""")
          )
        }
      }

      s"refuse GET ${page.pattern} to anyone below ${page.role.name}" in {
        val path = pathOf(page)

        // A cookie-less navigation is sent to mint a session rather than told the page doesn't exist.
        val anon = route(app, FakeRequest(GET, path)).get
        withClue("a logged-out caller: ")(status(anon) mustBe SEE_OTHER)
        withClue("a logged-out caller: ")(redirectLocation(anon).getOrElse("") must startWith("/anonSignUp"))

        // A signed-in caller without the role is refused by name, the branch an anonymous one never reaches.
        val belowRoles = if (page.role == Role.Owner) Seq(Role.Registered, Role.Administrator) else Seq(Role.Registered)
        belowRoles.foreach { role =>
          val cookies = if (role == Role.Administrator) adminCookies else visitorCookies
          val resp    = route(app, FakeRequest(GET, path).withCookies(cookies*)).get
          withClue(s"a ${role.name}: ")(status(resp) mustBe FORBIDDEN)
          withClue(s"a ${role.name}: ")(contentAsString(resp) must include(page.role.name))
        }
      }
    }
  }

  "The admin page table" should {
    "cover every GET /admin page the router declares" in {
      // A dynamic segment as Router.documentation renders it: "$name<regex>" (e.g. $teamId<[^/]+>).
      val dynamicSegment: Regex = """\$([^<]+)<[^>]*>""".r
      val declared              = app.injector
        .instanceOf[Router]
        .documentation
        .collect {
          case (GET, pattern, _) if pattern == "/admin" || pattern.startsWith("/admin/") =>
            dynamicSegment.replaceAllIn(pattern, m => Regex.quoteReplacement(":" + m.group(1)))
        }
        .toSet
      // Vacuity guard: if the documentation format drifts, discovery finds nothing and the check below passes empty.
      declared must contain("/admin/overview")

      val untested = declared -- Pages.map(_.pattern) -- CoveredElsewhere.keySet
      withClue("admin pages with no smoke test; add them to Pages: ")(untested mustBe empty)
    }
  }
}
