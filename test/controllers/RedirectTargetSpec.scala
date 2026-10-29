package controllers

import models.utils.MyPostgresProfile.api.*
import org.scalatest.concurrent.Eventually.*
import org.scalatest.time.{Millis, Seconds, Span}
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.mvc.Result
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.{SidewalkSpec, SignedUpAccounts}

import java.util.UUID
import scala.concurrent.Future

/** Every route that redirects to a caller-supplied target must keep the browser on this site. */
class RedirectTargetSpec extends SidewalkSpec with SignedUpAccounts with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].configure("rate-limit.enabled" -> false).build()

  private val OffSite = "https%3A%2F%2Fevil.example"

  private lazy val (_, _, session) = signUpFreshUser()

  private lazy val authCookie = app.configuration.get[String]("silhouette.authenticator.cookieName")

  /** @return Whether `result` tells the browser to drop its sign-in cookie. */
  private def clearsSession(result: Future[Result]): Boolean = cookies(result).get(authCookie).exists(_.value.isEmpty)

  "The landing page's referrer redirect" should {
    "send an off-site `to` home" in {
      redirectLocation(route(app, FakeRequest(GET, s"/?r=spec&to=$OffSite")).get) mustBe Some("/")
    }

    "follow a local `to`" in {
      redirectLocation(route(app, FakeRequest(GET, "/?r=spec&to=%2Fexplore")).get) mustBe Some("/explore")
    }
  }

  "/changeLanguage" should {
    "send an off-site url home" in {
      val result = route(app, FakeRequest(GET, s"/changeLanguage?url=$OffSite&language=es")).get
      redirectLocation(result) mustBe Some("/")
    }

    "redirect without setting the language for a malformed or unsupported tag" in {
      for (lang <- Seq("not_a_tag%21", "xx")) {
        val result = route(app, FakeRequest(GET, s"/changeLanguage?url=%2Fexplore&language=$lang")).get
        status(result) mustBe SEE_OTHER
        redirectLocation(result) mustBe Some("/explore")
        cookies(result).exists(_.name.endsWith("PLAY_LANG")) mustBe false
      }
    }
  }

  "/signOut" should {
    "send an off-site url home" in {
      val result = route(app, FakeRequest(GET, s"/signOut?url=$OffSite").withCookies(session*)).get
      redirectLocation(result) mustBe Some("/")
    }

    "sign a user out and follow a local url" in {
      val (_, _, ownSession) = signUpFreshUser()
      val result             = route(app, FakeRequest(GET, "/signOut?url=%2Fexplore").withCookies(ownSession*)).get
      redirectLocation(result) mustBe Some("/explore")
      clearsSession(result) mustBe true
    }

    "send a visitor with no session home, without making an account" in {
      val result = route(app, FakeRequest(GET, "/signOut?url=%2Fexplore")).get
      redirectLocation(result) mustBe Some("/")
      cookies(result).get(authCookie) mustBe None
    }

    "not sign a user out from another site's link" in {
      val request =
        FakeRequest(GET, "/signOut?url=%2Fexplore").withCookies(session*).withHeaders("Sec-Fetch-Site" -> "cross-site")
      val result = route(app, request).get
      redirectLocation(result) mustBe Some("/")
      cookies(result).get(authCookie) mustBe None
    }
  }

  "/anonSignUp" should {
    "send a signed-in user's off-site url home" in {
      val result = route(app, FakeRequest(GET, s"/anonSignUp?url=$OffSite").withCookies(session*)).get
      redirectLocation(result) mustBe Some("/")
    }

    "send a new anonymous user's off-site or non-ASCII url home" in {
      for (url <- Seq(OffSite, "%2F%E4%B8%AD")) {
        val marker = UUID.randomUUID().toString
        val result = route(app, FakeRequest(GET, s"/anonSignUp?url=$url&spec=$marker")).get
        redirectLocation(result) mustBe Some(s"/?spec=$marker")
        // The sign-up's activity-log write is async; poll for the marker to find the new account and clean it up.
        createdUserIds += eventually(timeout(Span(10, Seconds)), interval(Span(200, Millis))) {
          val ids = runAccounts(
            sql"SELECT user_id FROM webpage_activity WHERE activity LIKE ${s"%spec=$marker%"}".as[String]
          )
          ids must have size 1
          ids.head
        }
      }
    }
  }
}
