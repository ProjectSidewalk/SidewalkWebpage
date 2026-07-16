package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._

import java.util.UUID

/**
 * In-JVM functional tests for the RouteBuilder route CRUD (#3343/#3342): saving a named route, listing a user's
 * routes, renaming, and soft-deleting. Boots the real app against Postgres so routing, the CSRF filter, Silhouette,
 * the profanity guard, and the DAO layer all run.
 *
 * Ownership is the key contract: rename/delete are scoped to the requesting user in the WHERE clause, so another
 * user's mutation attempts must 404 without touching the row.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class RouteBuilderControllerSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer = app.materializer

  private val XHR = "X-Requested-With" -> "XMLHttpRequest"

  /** Creates a throwaway UUID-tagged registered user and returns its session cookies (incl. the authenticator). */
  private def signUpFreshUser(): Seq[Cookie] = {
    val tag  = UUID.randomUUID().toString.replace("-", "").take(20)
    val resp = route(
      app,
      FakeRequest(POST, "/signUp")
        .withHeaders(XHR)
        .withFormUrlEncodedBody(
          "username"        -> s"spec$tag",
          "email"           -> s"spec.$tag@example.test",
          "password"        -> "TestPass1",
          "passwordConfirm" -> "TestPass1",
          "terms"           -> "true",
          "returnUrl"       -> "/explore"
        )
        .withCSRFToken
    ).get
    status(resp) mustBe OK
    cookies(resp).toSeq
  }

  /** Fetches a real (street_edge_id, region_id) pair so saved routes reference valid streets. */
  private def anyStreet(userCookies: Seq[Cookie]): (Int, Int) = {
    val resp = route(
      app,
      FakeRequest(GET, "/contribution/streets/all?filterLowQuality=true").withCookies(userCookies: _*)
    ).get
    status(resp) mustBe OK
    val props = ((contentAsJson(resp) \ "features")(0) \ "properties").as[JsObject]
    ((props \ "street_edge_id").as[Int], (props \ "region_id").as[Int])
  }

  private def saveRouteBody(regionId: Int, streetId: Int, name: Option[String]): JsObject = {
    val base =
      Json.obj("region_id" -> regionId, "streets" -> Json.arr(Json.obj("street_id" -> streetId, "reverse" -> false)))
    name.map(n => base + ("name" -> Json.toJson(n))).getOrElse(base)
  }

  private def saveRoute(userCookies: Seq[Cookie], body: JsValue) = route(
    app,
    FakeRequest(POST, "/saveRoute").withHeaders(XHR).withCookies(userCookies: _*).withJsonBody(body).withCSRFToken
  ).get

  private def listRoutes(userCookies: Seq[Cookie]): Seq[JsValue] = {
    val resp = route(app, FakeRequest(GET, "/userapi/routes").withCookies(userCookies: _*)).get
    status(resp) mustBe OK
    contentAsJson(resp).as[Seq[JsValue]]
  }

  "The RouteBuilder routes" should {
    "exist and redirect an unauthenticated GET /userapi/routes to sign-in (3xx, not 404)" in {
      val sc = status(route(app, FakeRequest(GET, "/userapi/routes")).get)
      sc must be >= 300
      sc must be < 400
    }

    Seq(POST -> "/saveRoute", PUT -> "/userapi/routes/1", DELETE -> "/userapi/routes/1").foreach { case (verb, path) =>
      s"exist and redirect an unauthenticated $verb $path to sign-in (3xx, not 404)" in {
        val sc = status(route(app, FakeRequest(verb, path).withJsonBody(Json.obj()).withCSRFToken).get)
        sc must be >= 300
        sc must be < 400
      }
    }
  }

  "POST /saveRoute" should {
    "save a named route, echoing the trimmed name" in {
      val user                 = signUpFreshUser()
      val (streetId, regionId) = anyStreet(user)

      val resp = saveRoute(user, saveRouteBody(regionId, streetId, Some("  My Test Walk  ")))
      status(resp) mustBe OK
      (contentAsJson(resp) \ "route_id").asOpt[Int] mustBe defined
      (contentAsJson(resp) \ "name").as[String] mustBe "My Test Walk"
    }

    "fall back to a default name when none is submitted" in {
      val user                 = signUpFreshUser()
      val (streetId, regionId) = anyStreet(user)

      val resp = saveRoute(user, saveRouteBody(regionId, streetId, None))
      status(resp) mustBe OK
      val routeId = (contentAsJson(resp) \ "route_id").as[Int]
      (contentAsJson(resp) \ "name").as[String] mustBe s"Route $routeId"
    }

    "reject an offensive route name via the profanity guard (400)" in {
      val user                 = signUpFreshUser()
      val (streetId, regionId) = anyStreet(user)
      status(saveRoute(user, saveRouteBody(regionId, streetId, Some("shithead street")))) mustBe BAD_REQUEST
    }

    "reject a route name over 100 characters (400)" in {
      val user                 = signUpFreshUser()
      val (streetId, regionId) = anyStreet(user)
      status(saveRoute(user, saveRouteBody(regionId, streetId, Some("x" * 101)))) mustBe BAD_REQUEST
    }
  }

  "GET /userapi/routes, PUT and DELETE /userapi/routes/:routeId" should {
    "list, rename, and soft-delete the user's own routes, and 404 another user's mutations" in {
      val owner                = signUpFreshUser()
      val (streetId, regionId) = anyStreet(owner)

      // Save a route and find it in the owner's list with its display stats.
      val saved = saveRoute(owner, saveRouteBody(regionId, streetId, Some("Ownership Walk")))
      status(saved) mustBe OK
      val routeId = (contentAsJson(saved) \ "route_id").as[Int]

      val listed = listRoutes(owner).find(r => (r \ "route_id").as[Int] == routeId)
      listed mustBe defined
      (listed.get \ "name").as[String] mustBe "Ownership Walk"
      (listed.get \ "region_id").as[Int] mustBe regionId
      (listed.get \ "region_name").asOpt[String] mustBe defined
      (listed.get \ "street_count").as[Int] mustBe 1
      (listed.get \ "distance_meters").as[Double] must be >= 0d
      (listed.get \ "created_at").asOpt[String] mustBe defined

      // Another user cannot rename or delete it (404), and the row is untouched.
      val other         = signUpFreshUser()
      val renameByOther = route(
        app,
        FakeRequest(PUT, s"/userapi/routes/$routeId")
          .withHeaders(XHR)
          .withCookies(other: _*)
          .withJsonBody(Json.obj("name" -> "Hijacked"))
          .withCSRFToken
      ).get
      status(renameByOther) mustBe NOT_FOUND
      val deleteByOther = route(
        app,
        FakeRequest(DELETE, s"/userapi/routes/$routeId").withHeaders(XHR).withCookies(other: _*).withCSRFToken
      ).get
      status(deleteByOther) mustBe NOT_FOUND

      // The owner renames it; the list reflects the new name.
      val rename = route(
        app,
        FakeRequest(PUT, s"/userapi/routes/$routeId")
          .withHeaders(XHR)
          .withCookies(owner: _*)
          .withJsonBody(Json.obj("name" -> "Renamed Walk"))
          .withCSRFToken
      ).get
      status(rename) mustBe OK
      (contentAsJson(rename) \ "name").as[String] mustBe "Renamed Walk"
      val renamed = listRoutes(owner).find(r => (r \ "route_id").as[Int] == routeId)
      (renamed.get \ "name").as[String] mustBe "Renamed Walk"

      // Renaming to a blank name is rejected.
      val renameEmpty = route(
        app,
        FakeRequest(PUT, s"/userapi/routes/$routeId")
          .withHeaders(XHR)
          .withCookies(owner: _*)
          .withJsonBody(Json.obj("name" -> "   "))
          .withCSRFToken
      ).get
      status(renameEmpty) mustBe BAD_REQUEST

      // The owner soft-deletes it; it disappears from the list, and a second delete 404s.
      val delete = route(
        app,
        FakeRequest(DELETE, s"/userapi/routes/$routeId").withHeaders(XHR).withCookies(owner: _*).withCSRFToken
      ).get
      status(delete) mustBe OK
      listRoutes(owner).exists(r => (r \ "route_id").as[Int] == routeId) mustBe false
      val deleteAgain = route(
        app,
        FakeRequest(DELETE, s"/userapi/routes/$routeId").withHeaders(XHR).withCookies(owner: _*).withCSRFToken
      ).get
      status(deleteAgain) mustBe NOT_FOUND
    }
  }
}
