package controllers

import models.utils.MyPostgresProfile.api.*
import org.scalatest.concurrent.Eventually.*
import org.scalatest.time.{Millis, Seconds, Span}
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.{SidewalkSpec, SignedUpAccounts}

import java.util.UUID

/** Every route that redirects to a caller-supplied target must keep the browser on this site. */
class RedirectTargetSpec extends SidewalkSpec with SignedUpAccounts with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].configure("rate-limit.enabled" -> false).build()

  private val OffSite = "https%3A%2F%2Fevil.example"

  private lazy val (_, _, session) = signUpFreshUser()

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

    "redirect a visitor with no session straight to the url, without making an account" in {
      val result = route(app, FakeRequest(GET, "/signOut?url=%2Fexplore")).get
      status(result) mustBe SEE_OTHER
      redirectLocation(result) mustBe Some("/explore")
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
