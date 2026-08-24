package controllers

import models.label.LabelMetadata
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.mvc.Cookie
import play.api.test.FakeRequest
import play.api.test.Helpers._
import service.LabelService
import slick.dbio.DBIO
import util.AnonSession

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Functional tests for the admin's view of a label, GET /admin/label/:labelId (#4633): the public /label/:labelId
 * spotlight page rendered in admin mode.
 *
 * The admin payload the card fetches carries usernames, so the guard is pinned with a real signed-in non-admin (a
 * logged-out caller is refused identically whatever role an action wants). The rest pins what admin mode adds to the
 * page — and that the public page doesn't get it.
 *
 * Seeds its own callers the way ImageryAdminSpec does: a session minted through the real anonymous-signup route and
 * promoted with a DB write, undone afterwards.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class AdminLabelPageSpec extends PlaySpec with BeforeAndAfterAll with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  private val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  private lazy val validLabelId: Option[Int] =
    Await
      .result(app.injector.instanceOf[LabelService].getRecentLabelMetadata(1), 60.seconds)
      .headOption
      .map((l: LabelMetadata) => l.labelId)

  private var promotedUserIds: List[String] = Nil

  /** A fresh session holding `role`; the account is identified by what the signup created. */
  private def sessionAs(role: String): Seq[Cookie] = {
    val before  = run(sql"SELECT user_id FROM sidewalk_login.sidewalk_user".as[String]).toSet
    val cookies = freshAnonSession()
    val minted  = run(sql"SELECT user_id FROM sidewalk_login.sidewalk_user".as[String]).toSet -- before
    minted.size mustBe 1
    promotedUserIds ::= minted.head
    promote(minted.head, role)
    cookies
  }

  private def promote(userId: String, role: String): Unit = {
    val _ = run(
      sqlu"""UPDATE sidewalk_login.user_role
             SET role_id = (SELECT role_id FROM sidewalk_login.role WHERE role = $role)
             WHERE user_id = $userId"""
    )
  }

  // Registered rather than Anonymous: an Anonymous caller is sent to sign in, so only a registered one reaches the
  // branch that refuses by role name.
  private lazy val visitorCookies: Seq[Cookie] = sessionAs("Registered")
  private lazy val adminCookies: Seq[Cookie]   = sessionAs("Administrator")

  override def afterAll(): Unit = {
    promotedUserIds.foreach(id => promote(id, "Anonymous"))
    super.afterAll()
  }

  private def as(cookies: Seq[Cookie], path: String) = route(app, FakeRequest(GET, path).withCookies(cookies: _*)).get

  "GET /admin/label/:labelId" should {
    "refuse a signed-in visitor, naming the role it wants" in {
      val resp = as(visitorCookies, "/admin/label/1")
      status(resp) mustBe FORBIDDEN
      contentAsString(resp) must include("Administrator")
    }

    "send a logged-out caller to sign in rather than answering with a 404" in {
      val resp = route(app, FakeRequest(GET, "/admin/label/1").withHeaders("Sec-Fetch-Mode" -> "navigate")).get
      status(resp) mustBe SEE_OTHER
    }

    "render the spotlight page with the label detail card in admin mode" in {
      validLabelId match {
        case None     => cancel("No labels in the connected test DB; cannot exercise the valid-label path.")
        case Some(id) =>
          val resp = as(adminCookies, s"/admin/label/$id")
          status(resp) mustBe OK
          val body = contentAsString(resp)
          // Same page as /label/:id (the shared-label bundle drives it), plus the card's admin section.
          body must include("js/shared-label/build/shared-label.js")
          body must include("label-detail--inline")
          body must include("label-detail__details--admin")
          body must include("\"admin\":true")
          // Still no city-wide label layer: the admin page inherits the spotlight's cheap nearby-labels map.
          body must not include "/labels/all"
      }
    }

    "return 404 for a nonexistent label id" in {
      status(as(adminCookies, "/admin/label/999999999")) mustBe NOT_FOUND
    }
  }

  "GET /label/:labelId" should {
    "never render the admin section, even for an admin" in {
      validLabelId match {
        case None     => cancel("No labels in the connected test DB; cannot exercise the valid-label path.")
        case Some(id) =>
          val body = contentAsString(as(adminCookies, s"/label/$id"))
          body must include("\"admin\":false")
          body must not include "label-detail__details--admin"
      }
    }
  }

  "the retired admin task replay" should {
    "no longer route /admin/task/:taskId or /adminapi/auditpath/:id" in {
      for (path <- Seq("/admin/task/1", "/adminapi/auditpath/1")) {
        status(as(adminCookies, path)) mustBe NOT_FOUND
      }
    }
  }
}
