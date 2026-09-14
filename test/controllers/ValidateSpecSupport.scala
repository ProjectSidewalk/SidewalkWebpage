package controllers

import play.api.Application
import play.api.libs.json.{JsNull, JsObject, Json}
import play.api.mvc.{Cookie, Result}
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._

import scala.concurrent.Future

/** The request shapes the Validate endpoint specs share, so a change to the body reaches every spec at once. */
object ValidateSpecSupport {

  private val XHR = "X-Requested-With" -> "XMLHttpRequest"

  /** `validate_params` claiming Expert Validate's admin view and its triage queue. */
  val AdminClaim: JsObject = Json.obj(
    "admin_version"    -> true,
    "label_type"       -> JsNull,
    "user_ids"         -> JsNull,
    "region_ids"       -> JsNull,
    "unvalidated_only" -> false,
    "triage"           -> true
  )

  /**
   * Posts to /validationTask/moreLabels for a few Curb Ramp labels under the given `validate_params`.
   *
   * @param app     The application under test.
   * @param params  The `validate_params` the page would post back.
   * @param cookies The session making the request.
   */
  def postMoreLabels(app: Application, params: JsObject, cookies: Seq[Cookie]): Future[Result] = {
    val body = Json.obj(
      "label_type"         -> "CurbRamp",
      "labels_needed"      -> 3,
      "excluded_label_ids" -> Json.arr(),
      "validate_params"    -> params
    )
    route(
      app,
      FakeRequest(POST, "/validationTask/moreLabels")
        .withHeaders(XHR)
        .withCookies(cookies: _*)
        .withJsonBody(body)
        .withCSRFToken
    ).get
  }
}
