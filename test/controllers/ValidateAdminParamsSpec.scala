package controllers

import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsNull, JsObject, JsValue, Json}
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._

import java.util.UUID
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Functional tests for the admin gate on the Validate endpoints that hand back labels.
 *
 * `adminVersion` decides whether a response carries other people's data — the labeler's username and every
 * validation the label has already received — and it arrives in the request body, so on its own it is the client's
 * claim rather than a fact. Only /expertValidate sets it, behind `WithAdmin`, so a plain registered user asking for
 * it must be answered as the ordinary validator they are.
 *
 * Both label-bearing endpoints are covered: they route the claim through one guard, and a test on either alone
 * would leave the other free to drift.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class ValidateAdminParamsSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer = app.materializer

  private val XHR = "X-Requested-With" -> "XMLHttpRequest"

  /** `validate_params` claiming Expert Validate's admin view. */
  private val AdminClaim: JsObject = Json.obj(
    "admin_version"    -> true,
    "label_type"       -> JsNull,
    "user_ids"         -> JsNull,
    "neighborhood_ids" -> JsNull,
    "unvalidated_only" -> false
  )

  /**
   * Creates a throwaway UUID-tagged registered user — never an admin, whatever accounts the schema happens to hold.
   * @return Its email and session cookies.
   */
  private def signUpFreshUser(): (String, Seq[Cookie]) = {
    val tag   = UUID.randomUUID().toString.replace("-", "").take(20)
    val email = s"spec.$tag@example.test"
    val resp  = route(
      app,
      FakeRequest(POST, "/signUp")
        .withHeaders(XHR)
        .withFormUrlEncodedBody(
          "username"        -> s"spec$tag",
          "email"           -> email,
          "password"        -> "TestPass1",
          "passwordConfirm" -> "TestPass1",
          "terms"           -> "true",
          "returnUrl"       -> "/explore"
        )
        .withCSRFToken
    ).get
    status(resp) mustBe OK
    (email, cookies(resp).toSeq)
  }

  /** The validation mission a visit to /validate just created, as (missionId, labelTypeId, labelsValidated). */
  private def newestValidationMission(email: String): Option[(Int, Int, Int)] = {
    // Held as a local so its path-dependent Database type stays stable; a field would need an existential.
    val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
    Await.result(
      dbConfig.db.run(
        sql"""SELECT mission.mission_id, COALESCE(mission.label_type_id, 1), COALESCE(mission.labels_validated, 10)
              FROM mission
              INNER JOIN sidewalk_login.sidewalk_user ON mission.user_id = sidewalk_user.user_id
              WHERE sidewalk_user.email = $email AND mission.mission_type = 'validation'
              ORDER BY mission.mission_id DESC
              LIMIT 1""".as[(Int, Int, Int)].headOption
      ),
      30.seconds
    )
  }

  /** Asserts a label list came back without Expert Validate's per-label extras. */
  private def mustCarryNoAdminData(labels: Seq[JsValue]): Unit = {
    labels.foreach(label => (label \ "admin_data").asOpt[JsObject] mustBe None)
  }

  "POST /validationTask/moreLabels" should {
    "answer a registered user's adminVersion claim without admin data" in {
      val (_, userCookies) = signUpFreshUser()
      val body             = Json.obj(
        "label_type_id"      -> 1,
        "labels_needed"      -> 3,
        "excluded_label_ids" -> Json.arr(),
        "validate_params"    -> AdminClaim
      )
      val resp = route(
        app,
        FakeRequest(POST, "/validationTask/moreLabels")
          .withHeaders(XHR)
          .withCookies(userCookies: _*)
          .withJsonBody(body)
          .withCSRFToken
      ).get

      status(resp) mustBe OK
      val labels = (contentAsJson(resp) \ "labels").as[Seq[JsValue]]
      assume(labels.nonEmpty, "no Curb Ramp labels available to validate in this schema")
      mustCarryNoAdminData(labels)
    }
  }

  "POST /validationTask" should {
    "answer a registered user's adminVersion claim without admin data" in {
      val (email, userCookies) = signUpFreshUser()

      // Visiting Validate is what creates the mission the submission below reports progress on.
      status(route(app, FakeRequest(GET, "/validate").withCookies(userCookies: _*)).get) mustBe OK
      val mission = newestValidationMission(email)
      assume(mission.isDefined, "no validation mission available in this schema")
      val (missionId, labelTypeId, labelsValidated) = mission.get

      // The next mission's labels only come back once a mission is reported complete.
      val body = Json.obj(
        "interactions" -> Json.arr(),
        "environment"  -> Json.obj("mission_id" -> missionId, "language" -> "en", "css_zoom" -> 100),
        "validations"  -> Json.arr(),
        "mission_progress" -> Json.obj(
          "mission_id"      -> missionId,
          "mission_type"    -> "validation",
          "labels_progress" -> labelsValidated,
          "labels_total"    -> labelsValidated,
          "label_type_id"   -> labelTypeId,
          "completed"       -> true
        ),
        "validate_params" -> AdminClaim,
        "pano_histories"  -> Json.arr(),
        "source"          -> "Validate",
        "timestamp"       -> "2026-08-09T21:50:00.000Z"
      )
      val resp = route(
        app,
        FakeRequest(POST, "/validationTask")
          .withHeaders(XHR)
          .withCookies(userCookies: _*)
          .withJsonBody(body)
          .withCSRFToken
      ).get

      status(resp) mustBe OK
      val labels = (contentAsJson(resp) \ "labels").as[Seq[JsValue]]
      assume(labels.nonEmpty, "no labels available for a next mission in this schema")
      mustCarryNoAdminData(labels)
    }
  }
}
