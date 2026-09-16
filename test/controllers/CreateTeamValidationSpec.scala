package controllers

import models.user.Role
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.Json
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._
import util.{AnonSession, RoleSession}

/**
 * Functional tests for `POST /userapi/createTeam`'s name rules (#5342): no comma or all-digit name, and no duplicate
 * ignoring case/outer spaces (evolution 393's `team_name_key`).
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class CreateTeamValidationSpec extends PlaySpec with RoleSession with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private def createTeam(name: String) = {
    val cookies = sessionAs(Role.Registered)
    route(
      app,
      FakeRequest(POST, "/userapi/createTeam")
        .withCookies(cookies: _*)
        .withJsonBody(Json.obj("name" -> name, "description" -> ""))
        .withCSRFToken
    ).get
  }

  "POST /userapi/createTeam" should {
    "reject a name with a comma" in {
      val resp = createTeam(s"spec-5342-a,${System.nanoTime()}")
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "success").as[Boolean] mustBe false
    }

    "reject a name that is all digits" in {
      val resp = createTeam("48291")
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "success").as[Boolean] mustBe false
    }

    "reject a name already taken, ignoring case and outer spaces" in {
      val name  = s"spec-5342-b-${System.nanoTime()}"
      val first = createTeam(name)
      status(first) mustBe OK
      (contentAsJson(first) \ "success").as[Boolean] mustBe true

      val second = createTeam(s"  ${name.toUpperCase}  ")
      status(second) mustBe BAD_REQUEST
      (contentAsJson(second) \ "success").as[Boolean] mustBe false
    }

    "accept a plain, unique name" in {
      val resp = createTeam(s"spec-5342-c-${System.nanoTime()}")
      status(resp) mustBe OK
      (contentAsJson(resp) \ "success").as[Boolean] mustBe true
    }
  }
}
