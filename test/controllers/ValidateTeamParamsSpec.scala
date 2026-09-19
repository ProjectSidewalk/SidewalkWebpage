package controllers

import models.user.Role
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsBoolean, Json}
import play.api.test.FakeRequest
import play.api.test.Helpers._
import util.{AnonSession, RoleSession}

/**
 * Functional tests for Expert Validate's `teams` filter (#5342), as a query parameter and in `validate_params`.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class ValidateTeamParamsSpec extends PlaySpec with RoleSession with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer = app.materializer

  "GET /expertValidate" should {
    "reject a team that doesn't exist" in {
      val resp =
        route(
          app,
          FakeRequest(GET, "/expertValidate?teams=spec-5342-no-such-team").withCookies(
            sessionAs(Role.Administrator): _*
          )
        ).get
      status(resp) mustBe BAD_REQUEST
      contentAsString(resp) must include("teams provided were not found")
    }
  }

  "POST /validationTask/moreLabels" should {
    "reject team_ids without the admin view as a malformed body, not a server error" in {
      val params = ValidateSpecSupport.AdminClaim ++ Json.obj(
        "admin_version" -> JsBoolean(false),
        "triage"        -> false,
        "team_ids"      -> Json.arr(1)
      )
      val resp = ValidateSpecSupport.postMoreLabels(app, params, sessionAs(Role.Registered))
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "status").as[String] mustBe "Error"
    }
  }
}
