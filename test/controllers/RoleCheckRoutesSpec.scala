package controllers

import models.user.Role
import models.utils.MyPostgresProfile.api.given
import org.apache.pekko.stream.Materializer
import org.scalatest.Assertion
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsValue, Json}
import play.api.mvc.{Cookie, Result}
import play.api.test.CSRFTokenHelper.*
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.{AnonSession, RoleSession, RolledBackDb, SidewalkSpec}

import scala.concurrent.Future

/**
 * Checks that each "your own data" route and each signed-in-only route is wired to the right role check (#5841), so a
 * controller that drops its check or swaps in a looser one fails here. The checks themselves are in `WithRoleSpec`.
 * Where a route acts on a user (the team routes, and the streets read with seeded data), it also checks that it acts
 * on the user in the URL, not the caller.
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

  // Closed and hidden so it never shows up in a real team list while the suite runs on a shared database.
  private lazy val teamId: Int = run(
    sql"""INSERT INTO team (name, description, open, visible)
          VALUES (${TeamNamePrefix + System.nanoTime()}, '', FALSE, FALSE)
          RETURNING team_id""".as[Int].head
  )

  /** A street the registered user has audited, so the streets route has something to tell users apart by. */
  private lazy val auditedStreetId: Int = run(
    sql"""INSERT INTO audit_task (user_id, street_edge_id, completed, current_lat, current_lng)
          SELECT $registeredId, street_edge.street_edge_id, TRUE, 0, 0
          FROM street_edge
          INNER JOIN street_edge_region ON street_edge.street_edge_id = street_edge_region.street_edge_id
          INNER JOIN region ON street_edge_region.region_id = region.region_id
          WHERE street_edge.status = 'open' AND NOT region.deleted
              AND street_edge.street_edge_id NOT IN (SELECT tutorial_street_edge_id FROM config)
          LIMIT 1
          RETURNING street_edge_id""".as[Int].head
  )

  override def afterAll(): Unit = {
    // In a finally, so a failed delete can't skip RoleSession's demotion and leave an admin account behind.
    try {
      val _ = run(
        sqlu"""DELETE FROM user_team
                WHERE team_id IN (SELECT team_id FROM team WHERE name LIKE ${TeamNamePrefix + "%"})"""
          .andThen(sqlu"DELETE FROM team WHERE name LIKE ${TeamNamePrefix + "%"}")
          .andThen(sqlu"DELETE FROM audit_task WHERE user_id = $registeredId")
      )
    } finally super.afterAll()
  }

  private def get(path: String, cookies: Seq[Cookie]): Future[Result] =
    route(app, FakeRequest(GET, path).withCookies(cookies*)).get

  private def put(path: String, cookies: Seq[Cookie]): Future[Result] =
    route(app, FakeRequest(PUT, path).withCookies(cookies*).withCSRFToken).get

  /** Passes on the refusal a signed-in user gets: a 403, since signing in again wouldn't help. */
  private def mustBeForbidden(resp: Future[Result]): Assertion = status(resp) mustBe FORBIDDEN

  /** Passes on the refusal an anonymous user gets: a redirect to sign in. */
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

  "GET /contribution/streets" should {
    "return the streets of the user in the URL, not the caller's" in {
      val streetId = auditedStreetId // Seeds the audit before any request is sent.
      Seq(adminCookies, registeredCookies).foreach { cookies =>
        val resp = get(s"/contribution/streets?userId=$registeredId", cookies)
        status(resp) mustBe OK
        (contentAsJson(resp) \ "features").as[Seq[JsValue]].map(f => (f \ "properties" \ "street_edge_id").as[Int]) must
          contain(streetId)
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
      val cookies = freshAnonSession()
      val userId  = userIdOf(cookies)
      mustBeSentToSignIn(put(s"/userapi/setUserTeam?userId=$userId&teamId=$teamId", cookies))
      teamOf(userId) mustBe None
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

  /**
   * The routes guarded by `WithSignedIn`, with what a signed-in user gets back from an empty request. Signing out
   * other devices gets an account of its own, since it revokes the cookies the other tests share.
   */
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
        val cookies = if (path.endsWith("signOutOtherDevices")) sessionAs(Role.Registered) else registeredCookies
        val req     = FakeRequest(method, path).withCookies(cookies*).withJsonBody(Json.obj())
        status(route(app, req.withCSRFToken).get) mustBe signedInStatus
      }
      "send an anonymous user to sign in" in {
        val req = FakeRequest(method, path).withCookies(anonCookies*).withJsonBody(Json.obj())
        mustBeSentToSignIn(route(app, req.withCSRFToken).get)
      }
    }
  }
}
