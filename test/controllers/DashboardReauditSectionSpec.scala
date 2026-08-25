package controllers

import models.audit.AuditTaskTableDef
import models.region.RegionTableDef
import models.street.{StreetEdgeRegionTableDef, StreetEdgeTableDef}
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._
import util.{RolledBackDb, StreetFixtures}

import java.util.UUID

/**
 * Renders /dashboard for seeded mappers and pins what the "Streets with newer imagery" section shows them (#4896).
 *
 * This is the only coverage of the section's own rules, which live in the controller's page-size constants and in
 * dashboard.scala.html rather than in any query: that a long backlog arrives as one visible page with the rest held
 * back, that the "show more" control promises exactly what is left, and that the two empty states are different --
 * a mapper who is fully up to date is told so, while one who has never mapped is shown nothing at all. Each is a
 * distinct branch that renders identically to a DOM check unless the page is actually rendered.
 *
 * Every mapper here signs up for real over the HTTP endpoint, because /dashboard is closed to anonymous sessions
 * (WithSignedIn). Their streets and audits are committed and swept in `afterAll`, which is mandatory rather than
 * tidy on a shared dev DB. Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD,
 * as in dev/CI).
 */
// BeforeAndAfterAll must be mixed in BEFORE GuiceOneAppPerSuite: linearization then runs afterAll inside the running
// app, rather than after the app (and its DB pool) has already been stopped.
class DashboardReauditSectionSpec
    extends PlaySpec
    with org.scalatest.BeforeAndAfterAll
    with GuiceOneAppPerSuite
    with RolledBackDb
    with StreetFixtures {

  // Every request here shares FakeRequest's default loopback address, so the sign-ups would eat one per-IP budget;
  // throttle behavior has its own coverage in UserAuthRateLimitSpec.
  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure("rate-limit.enabled" -> false)
      .build()

  private val auditTasks        = TableQuery[AuditTaskTableDef]
  private val streetEdges       = TableQuery[StreetEdgeTableDef]
  private val streetEdgeRegions = TableQuery[StreetEdgeRegionTableDef]
  private val regions           = TableQuery[RegionTableDef]

  /** Matches the controller's own paging constants, which are what these expectations are really about. */
  private val PageSize = 5

  private val XHR = "X-Requested-With" -> "XMLHttpRequest"

  private val seededStreetIds = scala.collection.mutable.Set[Int]()
  private val seededRegionIds = scala.collection.mutable.Set[Int]()
  private val seededUserIds   = scala.collection.mutable.Set[String]()

  /** A signed-in mapper: the cookies their dashboard is fetched with, and the user rows are keyed on. */
  private case class Mapper(userId: String, cookies: Seq[Cookie])

  private var backlogMapper: Option[Mapper]  = None
  private var upToDateMapper: Option[Mapper] = None
  private var newcomerMapper: Option[Mapper] = None
  private var backlogStreets: Seq[Int]       = Seq.empty
  private def backlog: Mapper                = backlogMapper.getOrElse(fail("backlog mapper was not seeded"))
  private def upToDate: Mapper               = upToDateMapper.getOrElse(fail("up-to-date mapper was not seeded"))
  private def newcomer: Mapper               = newcomerMapper.getOrElse(fail("newcomer mapper was not seeded"))

  /**
   * Registers a real account and returns it signed in.
   *
   * Sign-up rather than a direct row insert: /dashboard turns anonymous sessions away, and this is the one path that
   * hands back both a Registered identity and the authenticator cookie for it.
   */
  private def signUp(): Mapper = {
    val tag  = UUID.randomUUID().toString.replace("-", "").take(20)
    val resp = route(
      app,
      FakeRequest(POST, "/signUp")
        .withHeaders(XHR)
        .withFormUrlEncodedBody(
          "username"        -> s"spec$tag",
          "email"           -> s"spec.$tag@example.test",
          "password"        -> "TestPass1",
          "passwordConfirm" -> "TestPass1",
          "terms"           -> "true",
          "returnUrl"       -> "/"
        )
        .withCSRFToken
    ).get
    status(resp) mustBe OK
    val userId = run(sql"""SELECT user_id FROM sidewalk_user WHERE username = ${s"spec$tag"}""".as[String].head)
    seededUserIds += userId
    Mapper(userId, cookies(resp).toSeq)
  }

  /** Registers each row as it is created, so a failure part-way through the seed still leaves it to be swept. */
  private def seedRegion(): Int = {
    val regionId = run(insertRegion())
    seededRegionIds += regionId
    regionId
  }

  private def seedStreet(regionId: Int): Int = {
    val streetEdgeId = run(insertStreet(Some(regionId)))
    seededStreetIds += streetEdgeId
    streetEdgeId
  }

  override def beforeAll(): Unit = {
    super.beforeAll()
    val regionId = seedRegion()

    // Two rows more than a page, so the held-back remainder is smaller than a page and the control has to say so.
    val backlogUser = signUp()
    backlogStreets = (1 to PageSize + 2).map(_ => seedStreet(regionId))
    backlogStreets.zipWithIndex.foreach { case (streetEdgeId, i) =>
      val _ = run(audit(streetEdgeId, backlogUser.userId, taskEnd = now.minusYears(1L + i), outdated = true))
    }
    backlogMapper = Some(backlogUser)

    // Mapped something, nothing outdated. The praise state is gated on recorded distance, which is a nightly cache
    // rather than anything this mapper's fresh audit updates, so it has to be set for the state to be reachable.
    val upToDateUser = signUp()
    val _            = run(audit(seedStreet(regionId), upToDateUser.userId))
    val _            = run(sqlu"""UPDATE user_stat SET meters_audited = 500 WHERE user_id = ${upToDateUser.userId}""")
    upToDateMapper = Some(upToDateUser)

    newcomerMapper = Some(signUp())
  }

  override def afterAll(): Unit = {
    val userIds   = seededUserIds.toSeq
    val streetIds = seededStreetIds.toSeq
    val regionIds = seededRegionIds.toSeq
    val _         = run(
      DBIO
        .seq(
          auditTasks.filter(t => (t.userId inSet userIds) || (t.streetEdgeId inSet streetIds)).delete,
          streetEdgeRegions.filter(_.streetEdgeId inSet streetIds).delete,
          streetEdges.filter(_.streetEdgeId inSet streetIds).delete,
          regions.filter(_.regionId inSet regionIds).delete
        )
        .transactionally
    )
    super.afterAll()
  }

  private def dashboardHtml(mapper: Mapper): String = {
    val resp = route(app, FakeRequest(GET, "/dashboard").withCookies(mapper.cookies: _*)).get
    status(resp) mustBe OK
    contentAsString(resp)
  }

  /** The section's row elements, as rendered. */
  private def rowTags(html: String): Seq[String] =
    "<li class=\"ud-reaudit-row\"[^>]*>".r.findAllIn(html).toSeq

  "The dashboard's needs-re-audit section" should {
    "list the mapper's outdated streets, each linking into Explore at that street" in {
      val html = dashboardHtml(backlog)

      html must include("ud-reaudit-section")
      html must include("Spec Region")
      backlogStreets.foreach { streetEdgeId => html must include(s"/explore?streetEdgeId=$streetEdgeId") }
    }

    "render one page visibly and hold the rest back" in {
      // Every fetched row is in the DOM so "show more" is a reveal rather than a round trip; the ones past the first
      // page are what the hidden attribute (and the CSS rule behind it) collapse.
      val tags = rowTags(dashboardHtml(backlog))

      tags.size mustBe PageSize + 2
      tags.count(_.contains("hidden")) mustBe 2
    }

    "offer to show exactly the rows that are left" in {
      val html = dashboardHtml(backlog)

      html must include("ud-reaudit-show-more")
      html must include("<span class=\"ud-reaudit-more-count\">2</span>")
    }

    "measure each street in the reader's large unit rather than rounding it to nothing" in {
      // The seeded streets are a degree of longitude long, well past the km/miles switch, so a row that reported
      // the small unit (or a projected length) would not match.
      val html = dashboardHtml(backlog)

      html must include regex "111\\.3 km|69\\.2 mi"
    }

    "tell a mapper with nothing outstanding that they are up to date" in {
      val html = dashboardHtml(upToDate)

      html must include("ud-reaudit-empty")
      rowTags(html) mustBe empty
    }

    "say nothing at all to a mapper who has not mapped yet" in {
      // Praise for being up to date only makes sense once there is work to be up to date about.
      val html = dashboardHtml(newcomer)

      html must not include "ud-reaudit-section"
      html must not include "ud-reaudit-empty"
    }
  }
}
