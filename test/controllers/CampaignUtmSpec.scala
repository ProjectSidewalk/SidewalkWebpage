package controllers

import controllers.helper.ControllerUtils.UtmCookieName
import models.utils.MyPostgresProfile.api.*
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.mvc.{Cookie, Result}
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

  private def freshCampaign(): String = s"spec-${UUID.randomUUID().toString.take(8)}"

  /** @return `(user_id, utm_source, utm_campaign)` for every row of the campaign's accounts, queued for cleanup. */
  private def utmRows(campaign: String): Seq[(String, Option[String], Option[String])] = {
    val rows = runAccounts(
      sql"""SELECT user_id, utm_source, utm_campaign FROM sidewalk_login.user_utm
            WHERE utm_campaign = $campaign OR user_id IN (
              SELECT user_id FROM sidewalk_login.user_utm WHERE utm_campaign = $campaign
            )""".as[(String, Option[String], Option[String])]
    )
    createdUserIds ++= rows.map(_._1)
    rows
  }

  /** @return The cookie a cookie-less landing visit sets. */
  private def landingCookie(campaign: String): Cookie = {
    val landing = route(app, FakeRequest(GET, s"/?utm_source=spec&utm_campaign=$campaign")).get
    status(landing) mustBe SEE_OTHER
    cookies(landing).get(UtmCookieName).getOrElse(fail("landing page set no campaign cookie"))
  }

  private def clearsUtmCookie(result: Future[Result]): Boolean =
    cookies(result).get(UtmCookieName).exists(_.maxAge.exists(_ <= 0))

  "A campaign link to the landing page" should {
    "save nothing yet when the visitor has no account" in {
      val campaign = freshCampaign()
      landingCookie(campaign)
      utmRows(campaign) mustBe empty
    }

    "be saved when /anonSignUp creates the account, which clears the cookie" in {
      val campaign = freshCampaign()
      val signUp   = route(app, FakeRequest(GET, "/anonSignUp?url=%2F").withCookies(landingCookie(campaign))).get
      status(signUp) mustBe SEE_OTHER
      clearsUtmCookie(signUp) mustBe true
      utmRows(campaign).map(r => (r._2, r._3)) mustBe Seq((Some("spec"), Some(campaign)))
    }

    "be saved when /signUp creates the account" in {
      val campaign       = freshCampaign()
      val (userId, _, _) = signUpFreshUser(Seq(landingCookie(campaign)))
      utmRows(campaign).map(_._1) mustBe Seq(userId)
    }

    "be saved beside a second campaign link that leads straight to /anonSignUp" in {
      val campaign = freshCampaign()
      val signUp   = route(
        app,
        FakeRequest(GET, "/anonSignUp?url=%2F&utm_source=direct").withCookies(landingCookie(campaign))
      ).get
      status(signUp) mustBe SEE_OTHER
      utmRows(campaign).flatMap(_._2).sorted mustBe Seq("direct", "spec")
    }

    "skip a cookie value that can't be decoded" in {
      val campaign = freshCampaign()
      val tampered = Cookie(UtmCookieName, s"utm_campaign=$campaign&utm_source=%zz&utm_bogus=1")
      status(route(app, FakeRequest(GET, "/anonSignUp?url=%2F").withCookies(tampered)).get) mustBe SEE_OTHER
      utmRows(campaign).map(r => (r._2, r._3)) mustBe Seq((None, Some(campaign)))
    }
  }
}
