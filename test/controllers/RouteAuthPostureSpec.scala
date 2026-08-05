package controllers

import com.google.inject.{Injector => GuiceInjector, Key, TypeLiteral}
import models.auth.DefaultEnv
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.apache.pekko.stream.Materializer
import org.scalatest.Assertion
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json._
import play.api.mvc.{Cookie, RequestHeader}
import play.api.routing.Router
import play.api.test.FakeRequest
import play.api.test.Helpers._
import play.silhouette.api.{LoginInfo, Silhouette}
import play.silhouette.impl.providers.CredentialsProvider

import scala.concurrent.{Await, ExecutionContext}
import scala.concurrent.duration._
import scala.util.matching.Regex

/**
 * Auth-posture tests for the routes touched by #4441: the public map-data feeds are reachable anonymously at their
 * canonical URLs, the /adminapi/ namespace refuses anonymous requests (401 to an XHR, a redirect into the
 * anonymous-signup flow to a navigation — see `ControllerUtils.anonSignupRedirect`), and retired URLs are gone.
 *
 * The namespace check is table-driven off the live route table rather than a hand-picked sample, so a newly added
 * /adminapi/ route that forgets its guard fails here instead of shipping. Two routes are on an explicit allow-list
 * (see `KnownAnonymousAdminApiRoutes`) — the residue of #4441, not an endorsement.
 *
 * Boots the full application with a real DB; asserts response contract/shape only, never data values. The per-record
 * shape checks `assume` a non-empty result set, so against an empty schema they report as CANCELED rather than
 * silently passing on zero records.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env).
 */
class RouteAuthPostureSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private val router = app.injector.instanceOf[Router]

  /** Every property key `/labels/all` publishes per feature. Asserted exactly, so an accidental add or drop fails. */
  private val LabelMapProperties: Set[String] = Set("label_id", "label_type", "severity", "correct", "has_validations",
    "ai_validation", "expired", "has_backup", "high_quality_user", "ai_generated", "tags")

  /** Every key `/neighborhoods/completionRate` publishes per region. */
  private val CompletionRateKeys: Set[String] =
    Set("region_id", "total_distance_m", "completed_distance_m", "rate", "name")

  /**
   * /adminapi/ routes that still answer anonymously, exempted from the namespace check below.
   *
   * Both are `controllers.api.LabelApiController` handlers — public-API code parked on an admin URL, the same
   * URL/posture mismatch #4441 set out to fix. They were left in place because they have no in-repo callers and are
   * likely consumed by external CV tooling, so moving or gating them needs sign-off first. Deleting an entry here is
   * the expected outcome of that decision; adding one should not happen without the same scrutiny.
   */
  private val KnownAnonymousAdminApiRoutes: Set[String] = Set(
    "/adminapi/panos",
    "/adminapi/labels/cvMetadata"
  )

  // A dynamic segment as Router.documentation renders it: "$name<regex>" (e.g. $teamId<[^/]+>).
  private val DynamicSegment: Regex = """\$[^<]+<[^>]*>""".r

  /** Turns a declared route pattern into a requestable path, substituting a value that binds as Int or String. */
  private def concreteRequestPath(pattern: String): String = DynamicSegment.replaceAllIn(pattern, "1")

  /** (method, requestable path) for every declared /adminapi/ route. */
  private val declaredAdminApiRoutes: Seq[(String, String)] = router.documentation.collect {
    case (method, pattern, _) if pattern.startsWith("/adminapi/") => (method, concreteRequestPath(pattern))
  }

  /**
   * Status of an unauthenticated request to a declared route, or None if nothing routes there.
   *
   * Write routes get an empty JSON body and the XHR fetch-metadata header. Without a parseable body they 415 in the
   * body parser before the auth guard ever runs, which would let a route pass the checks below without being gated at
   * all; `Sec-Fetch-Mode: cors` then pins the arm of `ControllerUtils.anonSignupRedirect` a real client would hit.
   */
  private def anonymousStatus(method: String, path: String): Option[Int] = {
    val base = FakeRequest(method, path).withHeaders("Sec-Fetch-Mode" -> "cors")
    val resp = if (method == GET) route(app, base) else route(app, base.withBody(Json.obj()))
    resp.map(status(_))
  }

  /**
   * Statuses that prove an anonymous request was turned away by the auth guard: 401 is the XHR arm of
   * `ControllerUtils.anonSignupRedirect`, 303 its navigation arm, 403 a `WithAdmin()` refusal.
   *
   * The namespace check asserts membership in this set rather than merely "not 2xx", because anything outside it — a
   * 400 from a path-parameter binder, a 404, a 415 from a body parser — means the request died before reaching the
   * guard and so says nothing about whether the route is gated. `concreteRequestPath` substitutes `1` for dynamic
   * segments, which binds for every /adminapi/ parameter today; the day one takes a type `1` can't bind as, a not-2xx
   * check would wave an ungated route through on the router's own rejection.
   */
  private val AuthRejections: Set[Int] = Set(UNAUTHORIZED, SEE_OTHER, FORBIDDEN)

  /**
   * Email of an existing user holding `role`, or None if this schema has none.
   *
   * Reads rather than creates: minting a user would leave a fixture account behind in whatever database the suite is
   * pointed at, and `sidewalk_login` is shared across every city schema on the host.
   */
  private def emailOfUserWithRole(role: String): Option[String] = {
    // Held as a local so its path-dependent Database type stays stable; a field would need an existential.
    val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
    Await.result(
      dbConfig.db.run(
        sql"""SELECT sidewalk_user.email
              FROM sidewalk_login.sidewalk_user
              INNER JOIN sidewalk_login.user_role ON sidewalk_user.user_id = user_role.user_id
              INNER JOIN sidewalk_login.role ON user_role.role_id = role.role_id
              WHERE role.role = $role
              LIMIT 1""".as[String].headOption
      ),
      30.seconds
    )
  }

  /**
   * Session cookie authenticating as `email`, for use with `FakeRequest.withCookies`.
   *
   * Mints a real CookieAuthenticator through the running app's own authenticator service, so requests traverse the
   * production auth path rather than a stubbed environment. `AuthenticationService.retrieve` looks the identity up by
   * email, which is why the login info's provider key is the address itself.
   */
  private def sessionCookieFor(email: String): Cookie = {
    implicit val ec: ExecutionContext         = app.actorSystem.dispatcher
    implicit val requestHeader: RequestHeader = FakeRequest() // Required by init; no state is read from it.

    // Resolved through Guice's TypeLiteral rather than injector.instanceOf: the latter takes a ClassTag, so the
    // DefaultEnv parameter erases and Guice looks for a raw Silhouette binding that does not exist.
    val silhouetteKey        = Key.get(new TypeLiteral[Silhouette[DefaultEnv]]() {})
    val authenticatorService =
      app.injector.instanceOf[GuiceInjector].getInstance(silhouetteKey).env.authenticatorService

    val created = authenticatorService.create(LoginInfo(CredentialsProvider.ID, email))
    Await.result(created.flatMap(authenticatorService.init(_)), 30.seconds)
  }

  /** Asserts that no route matches `path` (or that only a catch-all serves it a 404). */
  private def assertRouteGone(path: String): Assertion =
    route(app, FakeRequest(GET, path)) match {
      case None       => succeed
      case Some(resp) => status(resp) mustBe NOT_FOUND
    }

  "GET /labels/all" should {
    "serve the LabelMap GeoJSON feed anonymously" in {
      val resp = route(app, FakeRequest(GET, "/labels/all")).get
      status(resp) mustBe OK
      val json = contentAsJson(resp)
      (json \ "type").as[String] mustBe "FeatureCollection"
      (json \ "features").as[Seq[JsValue]] // Must be an array, empty or not.
      succeed
    }

    "publish exactly the documented property set on every feature" in {
      val features = (contentAsJson(route(app, FakeRequest(GET, "/labels/all")).get) \ "features").as[Seq[JsValue]]
      assume(features.nonEmpty, "no labels in this schema; per-feature shape needs a seeded DB")
      features.foreach { feature =>
        (feature \ "geometry" \ "type").as[String] mustBe "Point"
        (feature \ "geometry" \ "coordinates").as[Seq[Double]] must have size 2
        (feature \ "properties").as[JsObject].keys mustBe LabelMapProperties
      }
      succeed
    }

    "return an empty feature collection for a region that doesn't exist" in {
      val resp = route(app, FakeRequest(GET, "/labels/all?regions=999999999")).get
      status(resp) mustBe OK
      (contentAsJson(resp) \ "features").as[Seq[JsValue]] mustBe empty
    }

    "return an empty feature collection for a route that doesn't exist" in {
      val resp = route(app, FakeRequest(GET, "/labels/all?routes=999999999")).get
      status(resp) mustBe OK
      (contentAsJson(resp) \ "features").as[Seq[JsValue]] mustBe empty
    }

    // A present-but-empty value parses to Seq(""), which matches none of correct/incorrect/unsure/unvalidated and so
    // filters everything out. Pinned deliberately: it reads like a no-op filter but is the opposite.
    "treat an empty aiValidationOptions value as matching no result" in {
      val resp = route(app, FakeRequest(GET, "/labels/all?aiValidationOptions=")).get
      status(resp) mustBe OK
      (contentAsJson(resp) \ "features").as[Seq[JsValue]] mustBe empty
    }

    "ignore unparseable region and route IDs rather than erroring" in {
      val resp = route(app, FakeRequest(GET, "/labels/all?regions=abc&routes=def")).get
      status(resp) mustBe OK
    }
  }

  "GET /neighborhoods/completionRate" should {
    "serve neighborhood completion rates anonymously" in {
      val resp = route(app, FakeRequest(GET, "/neighborhoods/completionRate")).get
      status(resp) mustBe OK
      contentAsJson(resp).as[Seq[JsObject]] // Must be an array of objects, empty or not.
      succeed
    }

    "publish exactly the documented key set on every region" in {
      val rates = contentAsJson(route(app, FakeRequest(GET, "/neighborhoods/completionRate")).get).as[Seq[JsObject]]
      assume(rates.nonEmpty, "no regions in this schema; per-region shape needs a seeded DB")
      rates.foreach { rate =>
        rate.keys mustBe CompletionRateKeys
        (rate \ "rate").as[Double] must be >= 0.0
      }
      succeed
    }

    "filter by the regions param" in {
      val resp = route(app, FakeRequest(GET, "/neighborhoods/completionRate?regions=999999999")).get
      status(resp) mustBe OK
      contentAsJson(resp).as[Seq[JsObject]] mustBe empty
    }
  }

  "the /adminapi/ namespace" should {
    "refuse every anonymous request at the auth guard" in {
      // Vacuity guard: if Router.documentation's pattern format ever drifts, discovery finds nothing and `leaks` is
      // trivially empty, so this spec would pass while checking zero routes.
      declaredAdminApiRoutes.map(_._2) must contain("/adminapi/labelTags")

      val leaks = declaredAdminApiRoutes
        .filterNot { case (_, path) => KnownAnonymousAdminApiRoutes.contains(path) }
        .flatMap { case (method, path) => anonymousStatus(method, path).map(code => (method, path, code)) }
        .filterNot { case (_, _, code) => AuthRejections.contains(code) }

      withClue(s"not refused by the auth guard: ${leaks.map { case (m, p, c) => s"$m $p -> $c" }.mkString(", ")}. ") {
        leaks mustBe empty
      }
    }

    // The write routes are all JSON endpoints, so the auth guard is what must reject them — not their body parser.
    "reject an anonymous write with 401, not a body-parser error" in {
      val writeStatuses = declaredAdminApiRoutes.collect {
        case (method, path) if method != GET && !KnownAnonymousAdminApiRoutes.contains(path) =>
          (method, path, anonymousStatus(method, path))
      }
      writeStatuses must not be empty
      withClue(s"non-401 anonymous writes: $writeStatuses. ") {
        writeStatuses.filterNot { case (_, _, code) => code.contains(UNAUTHORIZED) } mustBe empty
      }
    }

    // Guards the allow-list against rot: a renamed or deleted route would otherwise leave a dead exemption that
    // silently keeps exempting nothing, and the next route to land on that path would inherit the pass.
    "still declare every route on the known-anonymous allow-list" in {
      val declaredPaths = declaredAdminApiRoutes.map(_._2).toSet
      KnownAnonymousAdminApiRoutes.diff(declaredPaths) mustBe empty
    }

    // The two routes #4441 changed, checked against both arms of ControllerUtils.anonSignupRedirect. The XHR arm is
    // the one that matters for /adminapi/labelTags: the Data Quality page fetches it, and a 401 lets that fetch fail
    // cleanly where a 303 would hand it an HTML sign-up page to parse as JSON.
    "answer an unauthenticated XHR on /adminapi/labelTags with 401, not the payload" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/labelTags").withHeaders("Sec-Fetch-Mode" -> "cors")).get
      status(resp) mustBe UNAUTHORIZED
    }

    "send an unauthenticated navigation to /adminapi/labelTags through the anonymous-signup flow (not 404)" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/labelTags").withHeaders("Sec-Fetch-Mode" -> "navigate")).get
      status(resp) mustBe SEE_OTHER
      redirectLocation(resp).value must startWith("/anonSignUp")
    }

    "answer an unauthenticated XHR on /adminapi/recalculateStreetPriority with 401" in {
      val request = FakeRequest(GET, "/adminapi/recalculateStreetPriority").withHeaders("Sec-Fetch-Mode" -> "cors")
      status(route(app, request).get) mustBe UNAUTHORIZED
    }

    "send an unauthenticated navigation to /adminapi/recalculateStreetPriority through anonymous signup (not 404)" in {
      val request = FakeRequest(GET, "/adminapi/recalculateStreetPriority").withHeaders("Sec-Fetch-Mode" -> "navigate")
      val resp    = route(app, request).get
      status(resp) mustBe SEE_OTHER
      redirectLocation(resp).value must startWith("/anonSignUp")
    }
  }

  // The anonymous checks above cannot tell WithAdmin() from WithOwner() — both reject a logged-out caller identically.
  // These sign in for real, so a tightened or loosened guard on the endpoint #4441 gated shows up as a failure.
  "GET /adminapi/labelTags, authenticated" should {
    "serve the tag counts to an administrator" in {
      val email = emailOfUserWithRole("Administrator")
      assume(email.isDefined, "no Administrator in this schema; authenticated checks need a seeded DB")
      val resp = route(app, FakeRequest(GET, "/adminapi/labelTags").withCookies(sessionCookieFor(email.get))).get
      status(resp) mustBe OK
      val counts = contentAsJson(resp).as[Seq[JsObject]]
      counts.foreach(_.keys mustBe Set("label_type", "tag", "count"))
      succeed
    }

    // The 403 body names the role the action demands, so this pins the guard to Administrator specifically: a swap to
    // WithOwner() would still 403 here, but the message would read "Owner" and this fails.
    "tell a signed-in non-admin exactly which role is required" in {
      val email = emailOfUserWithRole("Registered")
      assume(email.isDefined, "no Registered user in this schema; authenticated checks need a seeded DB")
      val resp = route(app, FakeRequest(GET, "/adminapi/labelTags").withCookies(sessionCookieFor(email.get))).get
      status(resp) mustBe FORBIDDEN
      contentAsString(resp) must include("Administrator")
    }
  }

  "the retired URLs" should {
    "no longer route /adminapi/neighborhoodCompletionRate" in {
      assertRouteGone("/adminapi/neighborhoodCompletionRate")
    }

    "no longer route /explore/recalculateStreetPriority" in {
      assertRouteGone("/explore/recalculateStreetPriority")
    }

    "no longer route the unused daily-count endpoints" in {
      assertRouteGone("/contribution/auditCounts/all")
      assertRouteGone("/userapi/labelCounts/all")
      assertRouteGone("/userapi/validationCounts/all")
    }
  }
}
