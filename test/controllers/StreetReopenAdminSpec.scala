package controllers

import models.user.Role
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.Json
import play.api.mvc.Cookie
import play.api.test.FakeRequest
import play.api.test.Helpers._
import slick.dbio.DBIO
import util.{AnonSession, RoleSession}

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Functional tests for the regained-imagery reopen endpoints (#4929): the one state-changing surface on the admin
 * Street Status page.
 *
 * Reopening rewrites a street's routability, so the guard is what gets pinned first — a signed-in non-admin must be
 * refused by role, not just anonymity (RouteAuthPostureSpec already pins the anonymous posture for every /adminapi
 * route). The rest pins the HTTP contract the page's queue reads: a stale row answers 409 with the street's actual
 * status rather than reopening twice, a bogus id answers 404, and a dismiss is idempotent. The full DB effects of a
 * successful reopen are covered in StreetLifecycleServiceSpec; no test here mutates a real street.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI); the
 * scheduling actors are disabled.
 */
class StreetReopenAdminSpec extends PlaySpec with RoleSession with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // AnonSession mints one session per call and the limiter is per-IP; every suite in a run shares loopback.
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  private val XHR = "X-Requested-With" -> "XMLHttpRequest"

  private lazy val visitorCookies: Seq[Cookie] = sessionAs(Role.Registered)
  private lazy val adminCookies: Seq[Cookie]   = sessionAs(Role.Administrator)

  /** An open street, whose reopen attempt must be refused as a no-op conflict. */
  private lazy val openStreetId: Option[Int] =
    run(
      sql"SELECT street_edge_id FROM street_edge WHERE status = 'open' ORDER BY street_edge_id LIMIT 1"
        .as[Int]
        .headOption
    )

  private def request(method: String, path: String, cookies: Seq[Cookie]) =
    route(app, FakeRequest(method, path).withHeaders(XHR).withCookies(cookies: _*)).get

  "the reopen endpoints" should {
    "refuse a signed-in visitor by role" in {
      Seq(PUT -> "/adminapi/streets/1/reopen", DELETE -> "/adminapi/streets/1/reopenCandidate").foreach {
        case (method, path) =>
          val resp = request(method, path, visitorCookies)
          status(resp) mustBe FORBIDDEN
          contentAsString(resp) must include("Administrator")
      }
    }
  }

  "PUT /adminapi/streets/:id/reopen" should {
    "answer 409 with the street's actual status when it isn't no_imagery" in {
      assume(openStreetId.isDefined, "no open street in the connected database")
      val resp = request(PUT, s"/adminapi/streets/${openStreetId.get}/reopen", adminCookies)
      status(resp) mustBe CONFLICT
      (contentAsJson(resp) \ "message").as[String] must include("'open'")
      // The refusal must leave no trace in the transition log.
      run(sql"""SELECT COUNT(*) FROM street_edge_status_change
                WHERE street_edge_id = ${openStreetId.get} AND source = 'admin_reopen'""".as[Int].head) mustBe 0
    }

    "answer 404 for a street that doesn't exist" in {
      status(request(PUT, s"/adminapi/streets/${Int.MaxValue}/reopen", adminCookies)) mustBe NOT_FOUND
    }
  }

  "DELETE /adminapi/streets/:id/reopenCandidate" should {
    "dismiss a queued candidate, then keep succeeding once there is nothing left to dismiss" in {
      assume(openStreetId.isDefined, "no street in the connected database to queue")
      val streetId = openStreetId.get
      run(sqlu"""INSERT INTO street_reopen_candidate (street_edge_id, n_panos)
                 VALUES ($streetId, 1) ON CONFLICT (street_edge_id) DO NOTHING""")
      try {
        val first = request(DELETE, s"/adminapi/streets/$streetId/reopenCandidate", adminCookies)
        status(first) mustBe OK
        contentAsJson(first) mustBe Json.obj("status" -> "success", "street_edge_id" -> streetId, "dismissed" -> 1)

        val second = request(DELETE, s"/adminapi/streets/$streetId/reopenCandidate", adminCookies)
        status(second) mustBe OK
        (contentAsJson(second) \ "dismissed").as[Int] mustBe 0
      } finally {
        val _ = run(sqlu"DELETE FROM street_reopen_candidate WHERE street_edge_id = $streetId")
      }
    }
  }
}
