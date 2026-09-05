package controllers

import models.label.LabelMetadata
import models.user.Role
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.mvc.Cookie
import play.api.test.FakeRequest
import play.api.test.Helpers._
import service.LabelService
import util.{AnonSession, RoleSession}

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
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class AdminLabelPageSpec extends PlaySpec with RoleSession with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  private lazy val validLabelId: Option[Int] =
    Await
      .result(app.injector.instanceOf[LabelService].getRecentLabelMetadata(1), 60.seconds)
      .headOption
      .map((l: LabelMetadata) => l.labelId)

  private lazy val visitorCookies: Seq[Cookie] = sessionAs(Role.Registered)
  private lazy val adminCookies: Seq[Cookie]   = sessionAs(Role.Administrator)

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
