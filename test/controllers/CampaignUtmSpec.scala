package controllers

import controllers.helper.ControllerUtils.UtmCookieName
import models.utils.MyPostgresProfile.api.*
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.mvc.{Cookie, Result}
import play.api.test.CSRFTokenHelper.*
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.{SidewalkSpec, SignedUpAccounts}

import java.util.UUID
import scala.concurrent.Future

/**
 * Campaign links reach `user_utm` for visitors with no account yet (#5611). Each test uses its own campaign name so its
 * rows, and the accounts behind them, can be found and cleaned up.
 */
class CampaignUtmSpec extends SidewalkSpec with SignedUpAccounts with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].configure("rate-limit.enabled" -> false).build()

  private val CampaignPrefix = "specutm-"

  private def freshCampaign(): String = s"$CampaignPrefix${UUID.randomUUID().toString.take(8)}"

  /**
   * @return `(user_id, utm_source, utm_campaign)` for every row of the campaign's accounts, in visit order; fails if row
   *         ids don't follow that order. Queues the accounts for cleanup.
   */
  private def utmRows(campaign: String): Seq[(String, Option[String], Option[String])] = {
    def query(orderBy: String) = runAccounts(
      sql"""SELECT user_id, utm_source, utm_campaign FROM sidewalk_login.user_utm
            WHERE user_id IN (SELECT user_id FROM sidewalk_login.user_utm WHERE utm_campaign = $campaign)
            ORDER BY #$orderBy""".as[(String, Option[String], Option[String])]
    )
    val rows = query("timestamp, user_utm_id")
    createdUserIds ++= rows.map(_._1)
    query("user_utm_id") mustBe rows
    rows
  }

  /** @return The campaign cookie a landing visit without an account sets, given cookies from earlier visits. */
  private def landingCookie(query: String, held: Seq[Cookie] = Seq.empty): Cookie = {
    val landing = route(app, FakeRequest(GET, s"/?$query").withCookies(held*)).get
    status(landing) mustBe SEE_OTHER
    cookies(landing).get(UtmCookieName).getOrElse(fail("landing page set no campaign cookie"))
  }

  private def anonSignUp(query: String, held: Cookie*): Future[Result] = {
    val signUp = route(app, FakeRequest(GET, s"/anonSignUp?url=%2F$query").withCookies(held*)).get
    status(signUp) mustBe SEE_OTHER
    signUp
  }

  private def clearsUtmCookie(result: Future[Result]): Boolean =
    cookies(result).get(UtmCookieName).exists(_.maxAge.exists(_ <= 0))

  override def afterAll(): Unit = {
    try runAccounts(sqlu"DELETE FROM webpage_activity WHERE activity LIKE ${s"%utm_campaign=$CampaignPrefix%"}"): Unit
    finally super.afterAll()
  }

  "A campaign link to the landing page" should {
    "save nothing yet when the visitor has no account" in {
      val campaign = freshCampaign()
      landingCookie(s"utm_campaign=$campaign")
      utmRows(campaign) mustBe empty
    }

    "be saved right away for a signed-in visitor" in {
      val campaign             = freshCampaign()
      val (userId, _, session) = signUpFreshUser()
      val landing              = route(app, FakeRequest(GET, s"/?utm_campaign=$campaign").withCookies(session*)).get
      status(landing) mustBe SEE_OTHER
      cookies(landing).get(UtmCookieName) mustBe None
      utmRows(campaign).map(_._1) mustBe Seq(userId)
    }

    "be saved when /anonSignUp creates the account, which clears the cookie" in {
      val campaign = freshCampaign()
      val signUp   = anonSignUp("", landingCookie(s"utm_source=spec&utm_campaign=$campaign"))
      clearsUtmCookie(signUp) mustBe true
      utmRows(campaign).map(r => (r._2, r._3)) mustBe Seq((Some("spec"), Some(campaign)))
    }

    "be saved when /signUp creates the account, which clears the cookie" in {
      val campaign            = freshCampaign()
      val held                = landingCookie(s"utm_campaign=$campaign")
      val (userId, _, signUp) = signUpFreshUser(Seq(held))
      signUp.find(_.name == UtmCookieName).exists(_.maxAge.exists(_ <= 0)) mustBe true
      utmRows(campaign).map(_._1) mustBe Seq(userId)
    }

    "be credited to an existing account that signs in, which clears the cookie" in {
      val campaign           = freshCampaign()
      val (userId, email, _) = signUpFreshUser()
      val signIn             = route(
        app,
        FakeRequest(POST, "/authenticate/credentials")
          .withCookies(landingCookie(s"utm_campaign=$campaign"))
          .withHeaders("X-Requested-With" -> "XMLHttpRequest")
          .withFormUrlEncodedBody("email" -> email, "password" -> signUpPassword, "rememberMe" -> "false")
          .withCSRFToken
      ).get
      status(signIn) mustBe OK
      clearsUtmCookie(signIn) mustBe true
      utmRows(campaign).map(_._1) mustBe Seq(userId)
    }

    "keep every visit, saved in the order they happened, before a link straight to /anonSignUp" in {
      val campaign = freshCampaign()
      val first    = landingCookie(s"utm_source=first&utm_campaign=$campaign")
      val second   = landingCookie(s"utm_source=second&utm_campaign=$campaign", Seq(first))
      anonSignUp("&utm_source=direct", second)
      utmRows(campaign).flatMap(_._2) mustBe Seq("first", "second", "direct")
    }

    "save the first of a repeated param, without the NUL bytes Postgres rejects" in {
      val campaign = freshCampaign()
      val signUp   = anonSignUp("", landingCookie(s"utm_source=a%00b&utm_source=c&utm_campaign=$campaign"))
      clearsUtmCookie(signUp) mustBe true
      utmRows(campaign).flatMap(_._2) mustBe Seq("ab")
    }

    "ignore a cookie that can't be read" in {
      val campaign = freshCampaign()
      val signUp   = anonSignUp(s"&utm_campaign=$campaign", Cookie(UtmCookieName, "not-json%zz"))
      clearsUtmCookie(signUp) mustBe true
      utmRows(campaign).map(_._3) mustBe Seq(Some(campaign))
    }
  }
}
