package controllers

import models.user.Role
import models.utils.MyPostgresProfile.api.given
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.Json
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper.*
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.{AnonSession, RoleSession, RolledBackDb, SidewalkSpec}

/**
 * Functional tests for `PUT /adminapi/setRole` (#5591): an admin may only move a user between the admin-assignable
 * roles, never into or out of a system role like AI or Anonymous.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class AdminSetRoleSpec
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

  private lazy val adminCookies: Seq[Cookie] = sessionAs(Role.Administrator)

  private def setRoleRequest(userId: String, roleId: String) =
    route(
      app,
      FakeRequest(PUT, "/adminapi/setRole")
        .withHeaders("X-Requested-With" -> "XMLHttpRequest")
        .withCookies(adminCookies*)
        .withJsonBody(Json.obj("user_id" -> userId, "role_id" -> roleId))
        .withCSRFToken
    ).get

  private def roleOf(userId: String): String =
    run(sql"SELECT role::text FROM sidewalk_login.user_role WHERE user_id = $userId".as[String]).head

  "Setting a user's role from the Management page" should {
    "change it between admin-assignable roles" in {
      val userId = userIdOf(sessionAs(Role.Registered))
      status(setRoleRequest(userId, "Researcher")) mustBe OK
      roleOf(userId) mustBe "Researcher"
    }

    "refuse a role outside the admin-assignable ones" in {
      val userId = userIdOf(sessionAs(Role.Registered))
      Seq("AI", "Anonymous", "Owner", "NotARole").foreach { roleId =>
        status(setRoleRequest(userId, roleId)) mustBe BAD_REQUEST
      }
      roleOf(userId) mustBe "Registered"
    }

    "refuse changing a user whose current role isn't admin-assignable" in {
      Seq(Role.Ai, Role.Anonymous, Role.Owner).foreach { role =>
        val userId = userIdOf(sessionAs(role))
        val resp   = setRoleRequest(userId, "Registered")
        status(resp) mustBe BAD_REQUEST
        contentAsString(resp) mustBe s"${role.name} accounts can't have their role changed"
        roleOf(userId) mustBe role.name
      }
    }
  }
}
