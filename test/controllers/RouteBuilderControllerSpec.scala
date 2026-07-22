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
 * In-JVM functional tests for the RouteBuilder route CRUD (#3343/#3342): saving a named route (with its URL slug
 * and optional description), listing a user's routes, updating a route in place (rename, description, street
 * list), resolving /r/<slug> share links, and soft-deleting. Boots the real app against Postgres so routing, the
 * CSRF filter, Silhouette, the profanity guard, and the DAO layer all run.
 *
 * Ownership is the key contract: updates/deletes are scoped to the requesting user in the WHERE clause, so another
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
    val (streetIds, regionId) = streetsInRegion(userCookies, 1)
    (streetIds.head, regionId)
  }

  /** Fetches n distinct street ids that share one region, for routes whose street list gets edited. */
  private def streetsInRegion(userCookies: Seq[Cookie], n: Int): (Seq[Int], Int) = {
    val resp = route(
      app,
      FakeRequest(GET, "/contribution/streets/all?filterLowQuality=true").withCookies(userCookies: _*)
    ).get
    status(resp) mustBe OK
    val features           = (contentAsJson(resp) \ "features").as[Seq[JsValue]]
    val byRegion           = features.groupBy(f => (f \ "properties" \ "region_id").as[Int])
    val (regionId, inSame) = byRegion.find(_._2.size >= n).get
    (inSame.take(n).map(f => (f \ "properties" \ "street_edge_id").as[Int]), regionId)
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

  private def putRoute(userCookies: Seq[Cookie], routeId: Int, body: JsValue) = route(
    app,
    FakeRequest(PUT, s"/userapi/routes/$routeId")
      .withHeaders(XHR)
      .withCookies(userCookies: _*)
      .withJsonBody(body)
      .withCSRFToken
  ).get

  /** Fetches a route's street list as (street_id, reverse) pairs in walking order. */
  private def getRouteStreets(userCookies: Seq[Cookie], routeId: Int): Seq[(Int, Boolean)] = {
    val resp = route(app, FakeRequest(GET, s"/userapi/routes/$routeId/streets").withCookies(userCookies: _*)).get
    status(resp) mustBe OK
    (contentAsJson(resp) \ "streets")
      .as[Seq[JsValue]]
      .map(s => ((s \ "street_id").as[Int], (s \ "reverse").as[Boolean]))
  }

  private def streetsBody(streets: (Int, Boolean)*): JsValue =
    Json.obj("streets" -> streets.map { case (id, rev) => Json.obj("street_id" -> id, "reverse" -> rev) })

  /** A short unique tag for route names so slug assertions are deterministic against a shared database. */
  private def uniqueTag(): String = UUID.randomUUID().toString.replace("-", "").take(12)

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

    "generate a slug from the name, suffixing duplicates" in {
      val user                 = signUpFreshUser()
      val (streetId, regionId) = anyStreet(user)
      val tag                  = uniqueTag()

      val first = saveRoute(user, saveRouteBody(regionId, streetId, Some(s"Walk $tag")))
      status(first) mustBe OK
      (contentAsJson(first) \ "slug").as[String] mustBe s"walk-$tag"

      val second = saveRoute(user, saveRouteBody(regionId, streetId, Some(s"Walk $tag")))
      status(second) mustBe OK
      (contentAsJson(second) \ "slug").as[String] mustBe s"walk-$tag-2"

      val listed = listRoutes(user).find(r => (r \ "route_id").as[Int] == (contentAsJson(first) \ "route_id").as[Int])
      (listed.get \ "slug").as[String] mustBe s"walk-$tag"
    }

    "save an optional description, surfacing it in the route list" in {
      val user                 = signUpFreshUser()
      val (streetId, regionId) = anyStreet(user)

      val body = saveRouteBody(regionId, streetId, Some(s"Described Walk ${uniqueTag()}")) +
        ("description" -> Json.toJson("  An important route from our library to school.  "))
      val saved = saveRoute(user, body)
      status(saved) mustBe OK
      val routeId = (contentAsJson(saved) \ "route_id").as[Int]

      val listed = listRoutes(user).find(r => (r \ "route_id").as[Int] == routeId)
      (listed.get \ "description").as[String] mustBe "An important route from our library to school."
    }

    "reject a description over 500 characters (400)" in {
      val user                 = signUpFreshUser()
      val (streetId, regionId) = anyStreet(user)
      val body                 = saveRouteBody(regionId, streetId, None) + ("description" -> Json.toJson("x" * 501))
      status(saveRoute(user, body)) mustBe BAD_REQUEST
    }

    // A saved zero-street route is unexplorable (no mission distance) and invisible in listings, so its owner
    // couldn't delete it either — it has to be refused at the door.
    "reject a route with no streets (400)" in {
      val user          = signUpFreshUser()
      val (_, regionId) = anyStreet(user)
      val body          = Json.obj("region_id" -> regionId, "streets" -> Json.arr(), "name" -> "Empty Walk")
      status(saveRoute(user, body)) mustBe BAD_REQUEST
    }
  }

  "PUT /userapi/routes/:routeId with streets" should {
    "replace the street list in place, serving it back in the updated walking order" in {
      val user                  = signUpFreshUser()
      val (streetIds, regionId) = streetsInRegion(user, 2)
      val (a, b)                = (streetIds.head, streetIds(1))

      val saved = saveRoute(user, saveRouteBody(regionId, a, Some(s"Edit Walk ${uniqueTag()}")))
      status(saved) mustBe OK
      val routeId = (contentAsJson(saved) \ "route_id").as[Int]

      // Extend and reorder: the new first street (b) was inserted after a, so serving [b, a] proves the order
      // comes from position, not from the serial route_street_id.
      status(putRoute(user, routeId, streetsBody(b -> false, a -> true))) mustBe OK
      getRouteStreets(user, routeId) mustBe Seq((b, false), (a, true))

      // Shrink back to one street; the removed street's row is gone.
      status(putRoute(user, routeId, streetsBody(a -> false))) mustBe OK
      getRouteStreets(user, routeId) mustBe Seq((a, false))

      // The route kept its id through both edits (same list row, updated street count).
      val listed = listRoutes(user).find(r => (r \ "route_id").as[Int] == routeId)
      (listed.get \ "street_count").as[Int] mustBe 1
    }

    // UNIQUE (route_id, position) is not deferrable, so every edit that moves a row past another one has to
    // vacate before it lands. Each shape below duplicates a (route_id, position) pair if it doesn't.
    "reorder, insert mid-route, and remove non-tail streets without colliding on position" in {
      val user                  = signUpFreshUser()
      val (streetIds, regionId) = streetsInRegion(user, 3)
      val (a, b, c)             = (streetIds.head, streetIds(1), streetIds(2))

      val saved   = saveRoute(user, saveRouteBody(regionId, a, Some(s"Reorder Walk ${uniqueTag()}")))
      val routeId = (contentAsJson(saved) \ "route_id").as[Int]

      status(putRoute(user, routeId, streetsBody(a -> false, b -> false, c -> false))) mustBe OK

      // Reverse: every row swaps with its mirror, so a and c trade positions 0 and 2.
      status(putRoute(user, routeId, streetsBody(c -> true, b -> true, a -> true))) mustBe OK
      getRouteStreets(user, routeId) mustBe Seq((c, true), (b, true), (a, true))

      // Non-tail removal: dropping the middle street pulls a back from position 2 to 1.
      status(putRoute(user, routeId, streetsBody(c -> true, a -> true))) mustBe OK
      getRouteStreets(user, routeId) mustBe Seq((c, true), (a, true))

      // Mid-route insert: b lands on position 1 while a is still sitting there.
      status(putRoute(user, routeId, streetsBody(c -> true, b -> false, a -> true))) mustBe OK
      getRouteStreets(user, routeId) mustBe Seq((c, true), (b, false), (a, true))

      // Prepend: every existing row shifts one position later.
      status(putRoute(user, routeId, streetsBody(a -> false, c -> true, b -> false, a -> true))) mustBe OK
      getRouteStreets(user, routeId) mustBe Seq((a, false), (c, true), (b, false), (a, true))

      // Out-and-back: the same street twice, matched greedily in walking order.
      status(putRoute(user, routeId, streetsBody(b -> false, b -> true))) mustBe OK
      getRouteStreets(user, routeId) mustBe Seq((b, false), (b, true))
    }

    "reject an empty street list and an empty update (400), and 404 a non-owner's street update" in {
      val user                 = signUpFreshUser()
      val (streetId, regionId) = anyStreet(user)
      val saved                = saveRoute(user, saveRouteBody(regionId, streetId, None))
      val routeId              = (contentAsJson(saved) \ "route_id").as[Int]

      status(putRoute(user, routeId, Json.obj("streets" -> Json.arr()))) mustBe BAD_REQUEST
      status(putRoute(user, routeId, Json.obj())) mustBe BAD_REQUEST

      val other = signUpFreshUser()
      status(putRoute(other, routeId, streetsBody(streetId -> true))) mustBe NOT_FOUND
      getRouteStreets(user, routeId) mustBe Seq((streetId, false))
    }
  }

  "GET /r/:slug" should {
    "redirect current and retired slugs to Explore, 404ing unknown slugs and deleted routes" in {
      val user                 = signUpFreshUser()
      val (streetId, regionId) = anyStreet(user)
      val tag                  = uniqueTag()

      val saved = saveRoute(user, saveRouteBody(regionId, streetId, Some(s"Slug Walk $tag")))
      status(saved) mustBe OK
      val routeId = (contentAsJson(saved) \ "route_id").as[Int]
      val slug1   = (contentAsJson(saved) \ "slug").as[String]
      slug1 mustBe s"slug-walk-$tag"

      // The share link works without any session cookies.
      val visit = route(app, FakeRequest(GET, s"/r/$slug1")).get
      status(visit) mustBe FOUND
      header(LOCATION, visit).get must include(s"/explore?routeId=$routeId")

      // A rename regenerates the slug; the retired slug keeps redirecting.
      val renamed = putRoute(user, routeId, Json.obj("name" -> s"New Walk $tag"))
      status(renamed) mustBe OK
      val slug2 = (contentAsJson(renamed) \ "slug").as[String]
      slug2 mustBe s"new-walk-$tag"
      status(route(app, FakeRequest(GET, s"/r/$slug2")).get) mustBe FOUND
      status(route(app, FakeRequest(GET, s"/r/$slug1")).get) mustBe FOUND

      // Renaming back reclaims the original slug rather than minting a "-2" variant.
      val renamedBack = putRoute(user, routeId, Json.obj("name" -> s"Slug Walk $tag"))
      status(renamedBack) mustBe OK
      (contentAsJson(renamedBack) \ "slug").as[String] mustBe slug1

      status(route(app, FakeRequest(GET, s"/r/nope-$tag")).get) mustBe NOT_FOUND

      // Deleting the route kills both its current and retired share links.
      val delete = route(
        app,
        FakeRequest(DELETE, s"/userapi/routes/$routeId").withHeaders(XHR).withCookies(user: _*).withCSRFToken
      ).get
      status(delete) mustBe OK
      status(route(app, FakeRequest(GET, s"/r/$slug1")).get) mustBe NOT_FOUND
      status(route(app, FakeRequest(GET, s"/r/$slug2")).get) mustBe NOT_FOUND
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
