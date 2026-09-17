package controllers

import models.user.Role
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsArray, Json}
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._
import util.{AnonSession, RoleSession}

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Functional tests for the admin team page and its endpoints (`/admin/team/:teamId`, `/adminapi/team/:teamId`,
 * `/adminapi/userSearch`, #5381): the admin gate, the 404 for a team that doesn't exist, and the roster round trip.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class AdminTeamPageSpec extends PlaySpec with RoleSession with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private val NamePrefix = "spec-5381-"

  /** An id no team can have, so the 404 cases can't collide with a real team on a shared development database. */
  private val MissingTeamId = 2147483647

  private lazy val adminCookies: Seq[Cookie]  = sessionAs(Role.Administrator)
  private lazy val memberCookies: Seq[Cookie] = sessionAs(Role.Registered)
  private lazy val memberUserId: String       = userIdOf(memberCookies)

  /** A team created by `memberCookies`' account, which joins it in the same step, so the team starts with a member. */
  private lazy val teamId: Int = {
    val resp = route(
      app,
      FakeRequest(POST, "/userapi/createTeam")
        .withCookies(memberCookies: _*)
        .withJsonBody(Json.obj("name" -> s"$NamePrefix${System.nanoTime()}", "description" -> "A spec's team"))
        .withCSRFToken
    ).get
    status(resp) mustBe OK
    (contentAsJson(resp) \ "team_id").as[Int]
  }

  override def afterAll(): Unit = {
    val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
    Await.result(
      dbConfig.db.run(
        sqlu"""DELETE FROM user_team WHERE team_id IN (SELECT team_id FROM team WHERE name LIKE ${NamePrefix + "%"})"""
          .andThen(sqlu"DELETE FROM team WHERE name LIKE ${NamePrefix + "%"}")
      ),
      30.seconds
    )
    super.afterAll()
  }

  /** @return The team's current member list, as an admin sees it. */
  private def members(): Seq[String] = {
    val resp = route(app, FakeRequest(GET, s"/adminapi/team/$teamId").withCookies(adminCookies: _*)).get
    status(resp) mustBe OK
    (contentAsJson(resp) \ "members").as[JsArray].value.map(row => (row \ "user_id").as[String]).toSeq
  }

  "GET /admin/team/:teamId" should {
    "render the team for an admin" in {
      val resp = route(app, FakeRequest(GET, s"/admin/team/$teamId").withCookies(adminCookies: _*)).get
      status(resp) mustBe OK
      contentAsString(resp) must include("Add members")
    }

    "404 on a team id that matches no team" in {
      val resp = route(app, FakeRequest(GET, s"/admin/team/$MissingTeamId").withCookies(adminCookies: _*)).get
      status(resp) mustBe NOT_FOUND
    }

    "refuse a non-admin" in {
      val resp = route(app, FakeRequest(GET, s"/admin/team/$teamId").withCookies(memberCookies: _*)).get
      status(resp) must not be OK
    }
  }

  "GET /adminapi/team/:teamId" should {
    "carry the team, its members, and their totals" in {
      val resp = route(app, FakeRequest(GET, s"/adminapi/team/$teamId").withCookies(adminCookies: _*)).get
      status(resp) mustBe OK
      val json = contentAsJson(resp)
      (json \ "team" \ "team_id").as[Int] mustBe teamId
      (json \ "totals" \ "members").as[Int] mustBe 1
      (json \ "members").as[JsArray].value must have size 1
      (json \ "members" \ 0 \ "user_id").as[String] mustBe memberUserId
    }

    "404 on a team id that matches no team" in {
      val resp = route(app, FakeRequest(GET, s"/adminapi/team/$MissingTeamId").withCookies(adminCookies: _*)).get
      status(resp) mustBe NOT_FOUND
    }

    "refuse a non-admin" in {
      val resp = route(app, FakeRequest(GET, s"/adminapi/team/$teamId").withCookies(memberCookies: _*)).get
      status(resp) must not be OK
    }
  }

  "The roster controls" should {
    "add and remove a member, as the page drives them" in {
      val adminUserId = userIdOf(adminCookies)
      members() must contain theSameElementsAs Seq(memberUserId)

      val added = route(
        app,
        FakeRequest(PUT, s"/userapi/setUserTeam?userId=$adminUserId&teamId=$teamId")
          .withCookies(adminCookies: _*)
          .withCSRFToken
      ).get
      status(added) mustBe OK
      members() must contain theSameElementsAs Seq(memberUserId, adminUserId)

      val removed = route(
        app,
        FakeRequest(PUT, s"/userapi/leaveTeam?userId=$adminUserId").withCookies(adminCookies: _*).withCSRFToken
      ).get
      status(removed) mustBe OK
      members() must contain theSameElementsAs Seq(memberUserId)
    }
  }

  "GET /adminapi/userSearch" should {
    "return nothing for a blank query rather than the whole directory" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/userSearch?query=%20").withCookies(adminCookies: _*)).get
      status(resp) mustBe OK
      contentAsJson(resp).as[JsArray].value mustBe empty
    }

    "find an account by a fragment of its username, with the team it's already on" in {
      val username = (contentAsJson(
        route(app, FakeRequest(GET, s"/adminapi/team/$teamId").withCookies(adminCookies: _*)).get
      ) \ "members" \ 0 \ "username").as[String]
      val resp =
        route(app, FakeRequest(GET, s"/adminapi/userSearch?query=$username").withCookies(adminCookies: _*)).get
      status(resp) mustBe OK
      val hit = contentAsJson(resp).as[JsArray].value.find(row => (row \ "user_id").as[String] == memberUserId)
      hit.map(row => (row \ "team").asOpt[String]).flatten mustBe defined
    }

    "treat a LIKE wildcard as literal text rather than matching everyone" in {
      // A bare `%` is every account if the metacharacter reaches SQL unescaped; no username contains a literal one.
      val resp = route(app, FakeRequest(GET, "/adminapi/userSearch?query=%25").withCookies(adminCookies: _*)).get
      status(resp) mustBe OK
      contentAsJson(resp).as[JsArray].value mustBe empty
    }

    "refuse a non-admin at the auth guard, not the parameter binder" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/userSearch?query=a").withCookies(memberCookies: _*)).get
      status(resp) must not be OK
      status(resp) must not be BAD_REQUEST
    }

    "refuse an anonymous request with no query param at all" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/userSearch")).get
      status(resp) must not be BAD_REQUEST
    }
  }
}
