package controllers

import models.user.Role
import models.utils.MyPostgresProfile.api.given
import org.apache.pekko.stream.Materializer
import org.scalatest.Assertion
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.Json
import play.api.mvc.{Cookie, Result}
import play.api.test.CSRFTokenHelper.*
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.{AnonSession, RoleSession, RolledBackDb, SidewalkSpec}

import scala.concurrent.Future

/**
 * Checks that each "your own data" route and each signed-in-only route is wired to the right role check (#5841). The
 * checks themselves are tested in `WithRoleSpec`; this spec catches a controller that drops its check, swaps it for a
 * looser one, or checks a different user id than the one it acts on.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class RoleCheckRoutesSpec
    extends SidewalkSpec
    with RoleSession
    with GuiceOneAppPerSuite
    with AnonSession
    with RolledBackDb {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // AnonSession mints one session per call and the limiter is per-IP; every suite in a run shares loopback.
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  given mat: Materializer = app.materializer

  private val TeamNamePrefix = "spec-5841-"

  private lazy val adminCookies: Seq[Cookie]      = sessionAs(Role.Administrator)
  private lazy val registeredCookies: Seq[Cookie] = sessionAs(Role.Registered)
  private lazy val registeredId: String           = userIdOf(registeredCookies)
  private lazy val otherCookies: Seq[Cookie]      = sessionAs(Role.Registered)
  private lazy val otherId: String                = userIdOf(otherCookies)
  private lazy val anonCookies: Seq[Cookie]       = freshAnonSession()
  private lazy val anonId: String                 = userIdOf(anonCookies)

  private lazy val teamId: Int =
    run(
      sql"INSERT INTO team (name, description) VALUES (${TeamNamePrefix + System.nanoTime()}, '') RETURNING team_id"
        .as[Int]
        .head
    )

  override def afterAll(): Unit = {
    run(
      sqlu"""DELETE FROM user_team WHERE team_id IN (SELECT team_id FROM team WHERE name LIKE ${TeamNamePrefix + "%"})"""
        .andThen(sqlu"DELETE FROM team WHERE name LIKE ${TeamNamePrefix + "%"}")
    )
    super.afterAll()
  }

  private def get(path: String, cookies: Seq[Cookie]): Future[Result] =
    route(app, FakeRequest(GET, path).withCookies(cookies*)).get

  private def put(path: String, cookies: Seq[Cookie]): Future[Result] =
    route(app, FakeRequest(PUT, path).withCookies(cookies*).withCSRFToken).get

  private def mustBeForbidden(resp: Future[Result]): Assertion = status(resp) mustBe FORBIDDEN

  private def mustBeSentToSignIn(resp: Future[Result]): Assertion = {
    status(resp) mustBe SEE_OTHER
    redirectLocation(resp).getOrElse("") must startWith("/signIn")
  }

  private def teamOf(userId: String): Option[Int] =
    run(sql"SELECT team_id FROM user_team WHERE user_id = $userId".as[Int].headOption)

  private val adminOrIsUserRoutes: Seq[(String, String => String)] = Seq(
    "GET /contribution/streets" -> (id => s"/contribution/streets?userId=$id"),
    "GET /userapi/mistakes"     -> (id => s"/userapi/mistakes?userId=$id"),
    "GET /userapi/labels"       -> (id => s"/userapi/labels?userId=$id")
  )

  adminOrIsUserRoutes.foreach { case (name, path) =>
    name should {
      "let an admin see someone else's data" in {
        status(get(path(registeredId), adminCookies)) mustBe OK
      }
      "let a user see their own data" in {
        status(get(path(registeredId), registeredCookies)) mustBe OK
      }
      "let an anonymous user see their own data" in {
        status(get(path(anonId), anonCookies)) mustBe OK
      }
      "refuse a user asking for someone else's data" in {
        mustBeForbidden(get(path(otherId), registeredCookies))
      }
      "send an anonymous user asking for someone else's data to sign in" in {
        mustBeSentToSignIn(get(path(otherId), anonCookies))
      }
    }
  }

  "PUT /userapi/setUserTeam" should {
    "let an admin move someone else onto a team" in {
      status(put(s"/userapi/setUserTeam?userId=$otherId&teamId=$teamId", adminCookies)) mustBe OK
      teamOf(otherId) mustBe Some(teamId)
    }
    "let a user join a team themselves" in {
      status(put(s"/userapi/setUserTeam?userId=$registeredId&teamId=$teamId", registeredCookies)) mustBe OK
      teamOf(registeredId) mustBe Some(teamId)
    }
    "refuse a user moving someone else, and leave that user's team alone" in {
      val before = teamOf(anonId)
      mustBeForbidden(put(s"/userapi/setUserTeam?userId=$anonId&teamId=$teamId", registeredCookies))
      teamOf(anonId) mustBe before
    }
    "send an anonymous user to sign in, even for their own team" in {
      mustBeSentToSignIn(put(s"/userapi/setUserTeam?userId=$anonId&teamId=$teamId", anonCookies))
      teamOf(anonId) mustBe None
    }
  }

  "PUT /userapi/leaveTeam" should {
    "let an admin take someone else off their team" in {
      status(put(s"/userapi/setUserTeam?userId=$otherId&teamId=$teamId", otherCookies)) mustBe OK
      status(put(s"/userapi/leaveTeam?userId=$otherId", adminCookies)) mustBe OK
      teamOf(otherId) mustBe None
    }
    "let a user leave their own team" in {
      status(put(s"/userapi/setUserTeam?userId=$registeredId&teamId=$teamId", registeredCookies)) mustBe OK
      status(put(s"/userapi/leaveTeam?userId=$registeredId", registeredCookies)) mustBe OK
      teamOf(registeredId) mustBe None
    }
    "refuse a user taking someone else off their team, and leave them on it" in {
      status(put(s"/userapi/setUserTeam?userId=$otherId&teamId=$teamId", otherCookies)) mustBe OK
      mustBeForbidden(put(s"/userapi/leaveTeam?userId=$otherId", registeredCookies))
      teamOf(otherId) mustBe Some(teamId)
    }
    "send an anonymous user to sign in, even for their own team" in {
      mustBeSentToSignIn(put(s"/userapi/leaveTeam?userId=$anonId", anonCookies))
    }
  }

  /** The routes guarded by `WithSignedIn`, with what a signed-in user gets back from an empty request. */
  private val signedInRoutes: Seq[(String, String, Int)] = Seq(
    (GET, "/dashboard", OK),
    (GET, "/dashboard/settings", OK),
    (POST, "/dashboard/settings", BAD_REQUEST),
    (POST, "/dashboard/settings/password", BAD_REQUEST),
    (POST, "/dashboard/settings/signOutOtherDevices", OK),
    (GET, "/userapi/crossCityStats", OK),
    (GET, "/timeCheck", OK)
  )

  signedInRoutes.foreach { case (method, path, signedInStatus) =>
    s"$method $path" should {
      "let a registered user through" in {
        val req = FakeRequest(method, path).withCookies(sessionAs(Role.Registered)*).withJsonBody(Json.obj())
        status(route(app, req.withCSRFToken).get) mustBe signedInStatus
      }
      "send an anonymous user to sign in" in {
        val req = FakeRequest(method, path).withCookies(anonCookies*).withJsonBody(Json.obj())
        mustBeSentToSignIn(route(app, req.withCSRFToken).get)
      }
    }
  }
}
