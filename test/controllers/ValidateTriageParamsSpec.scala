package controllers

import models.user.Role
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsObject, JsValue}
import play.api.mvc.Cookie
import play.api.test.FakeRequest
import play.api.test.Helpers._
import util.{AnonSession, RoleSession}

/**
 * Functional tests for the `triage` flag that decides which queue a Validate page draws from (#4715).
 *
 * The flag reaches the page two ways — a query parameter on the admin routes, and a field in the `validate_params`
 * body a running page posts back — and both are covered, because the pages read the embedded value and post it
 * straight back. Expert Validate defaults it on, plain Validate has no way to ask for it, and a body from an older
 * tab, which omits the field, still has to parse.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class ValidateTriageParamsSpec extends PlaySpec with RoleSession with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // This suite mints a session per test, and /anonSignUp is capped per IP per hour.
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  implicit lazy val mat: Materializer = app.materializer

  /** The Twirl views embed `param.validateParams` as a JS object literal, so the flag is read back as text. */
  private def embeddedTriage(body: String): Option[Boolean] =
    """triage:\s*(true|false)""".r.findFirstMatchIn(body).map(_.group(1).toBoolean)

  private def getPage(path: String, cookies: Seq[Cookie]): (Int, String) = {
    val resp = route(app, FakeRequest(GET, path).withCookies(cookies: _*)).get
    (status(resp), contentAsString(resp))
  }

  "GET /expertValidate" should {
    "put an admin on the triage queue by default" in {
      val (code, body) = getPage("/expertValidate", sessionAs(Role.Administrator))
      assume(code == OK, s"/expertValidate answered $code, so this schema cannot serve an expert mission")
      embeddedTriage(body) mustBe Some(true)
    }

    "hand back the shared stream when triage is explicitly turned off" in {
      val (code, body) = getPage("/expertValidate?triage=false", sessionAs(Role.Administrator))
      assume(code == OK, s"/expertValidate answered $code, so this schema cannot serve an expert mission")
      embeddedTriage(body) mustBe Some(false)
    }
  }

  "GET /adminValidate" should {
    "default to the triage queue like /expertValidate does" in {
      val (code, body) = getPage("/adminValidate", sessionAs(Role.Administrator))
      assume(code == OK, s"/adminValidate answered $code, so this schema cannot serve an expert mission")
      embeddedTriage(body) mustBe Some(true)
    }
  }

  "GET /validate" should {
    "never put an ordinary validator on the triage queue" in {
      val (code, body) = getPage("/validate", freshAnonSession())
      assume(code == OK, s"/validate answered $code, so this schema cannot serve a mission")
      embeddedTriage(body) mustBe Some(false)
    }
  }

  "POST /validationTask/moreLabels" should {
    val triageClaim: JsObject = ValidateSpecSupport.AdminClaim

    /** The same body from an older tab, which omits the triage field. */
    val claimWithoutTriage: JsObject = triageClaim - "triage"

    def moreLabels(params: JsObject, cookies: Seq[Cookie]) = ValidateSpecSupport.postMoreLabels(app, params, cookies)

    "answer a registered user's triage claim as the ordinary validator they are" in {
      val resp = moreLabels(triageClaim, sessionAs(Role.Registered))
      status(resp) mustBe OK
      val labels = (contentAsJson(resp) \ "labels").as[Seq[JsValue]]
      assume(labels.nonEmpty, "no Curb Ramp labels available to validate in this schema")
      labels.foreach(label => (label \ "admin_data").asOpt[JsObject] mustBe None)
    }

    "still parse a body that carries no triage field at all" in {
      status(moreLabels(claimWithoutTriage, sessionAs(Role.Registered))) mustBe OK
    }

    "reject triage without the admin view as a malformed body, not a server error" in {
      // A body that breaks the params' own invariant is the client's error, never the constructor's exception.
      val resp =
        moreLabels(triageClaim + ("admin_version" -> play.api.libs.json.JsBoolean(false)), sessionAs(Role.Registered))
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "status").as[String] mustBe "Error"
    }
  }
}
