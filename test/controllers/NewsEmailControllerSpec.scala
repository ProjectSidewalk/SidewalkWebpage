package controllers

import models.user.{NewsEmailOptOutSource, Role}
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsNull, Json}
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper.*
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import play.silhouette.api.util.PasswordInfo
import service.{AuthenticationService, NewsEmailTokenService, UserService}
import util.{SidewalkSpec, SignedUpAccounts}

import java.util.UUID
import scala.concurrent.{Await, Future}
import scala.concurrent.duration.*

/**
 * The newsletter opt-out end to end (#5864): unsubscribe link, sign-up box, Settings save, and admin send list.
 * Boots the real app against Postgres; `SignedUpAccounts` deletes the throwaway accounts afterwards.
 */
class NewsEmailControllerSpec extends SidewalkSpec with SignedUpAccounts with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // Every sign-up here comes from FakeRequest's one IP; throttling has its own spec (UserAuthRateLimitSpec).
      .configure("rate-limit.enabled" -> false)
      .build()

  given mat: Materializer = app.materializer

  private val tokens      = app.injector.instanceOf[NewsEmailTokenService]
  private val userService = app.injector.instanceOf[UserService]
  private val authService = app.injector.instanceOf[AuthenticationService]

  private def await[T](f: Future[T]): T = Await.result(f, 60.seconds)

  private def optedOut(userId: String) = await(userService.getNewsEmailOptOut(userId))

  /** A throwaway anonymous account, swept with the signed-up ones. */
  private def newAnonUser(): String = {
    val generated = await(authService.generateUniqueAnonUser())
    val pwInfo    = PasswordInfo("bcrypt-sha256", "spec-only-not-a-hash", None)
    val user      = await(authService.createUser(generated, "credentials", pwInfo, oldUserId = None))
    createdUserIds += user.userId
    user.userId
  }

  /** The Settings form as Settings.js posts it, with the news-email box in the given state. */
  private def saveSettings(sessionCookies: Seq[Cookie], username: String, newsEmail: Boolean) = {
    val body = Json.obj(
      "username"           -> username,
      "on_leaderboard"     -> true,
      "public_profile"     -> true,
      "community_service"  -> false,
      "measurement_system" -> "auto",
      "team_id"            -> JsNull,
      "news_email"         -> newsEmail
    )
    route(
      app,
      FakeRequest(POST, "/dashboard/settings").withCookies(sessionCookies*).withJsonBody(body).withCSRFToken
    ).get
  }

  "An unsubscribe token" should {
    "name its user, and reject one that was altered or made up" in {
      val (userId, _, _) = signUpFreshUser()
      val token          = tokens.token(userId)
      tokens.userId(token) mustBe Some(userId)

      val signature = token.drop(token.lastIndexOf('.') + 1)
      val flipped   = signature.dropRight(1) + (if (signature.last == 'A') 'B' else 'A')
      tokens.userId(s"$userId.$flipped") mustBe None
      tokens.userId(s"${UUID.randomUUID()}.$signature") mustBe None
      tokens.userId(userId) mustBe None
      tokens.userId(s".$signature") mustBe None
    }
  }

  "GET /unsubscribe" should {
    "show the confirm page for a genuine link without changing anything, since scanners follow links" in {
      val (userId, _, _) = signUpFreshUser()
      val resp           = route(app, FakeRequest(GET, s"/unsubscribe?token=${tokens.token(userId)}")).get
      status(resp) mustBe OK
      contentAsString(resp) must include(s"/unsubscribe?token=${tokens.token(userId)}")
      optedOut(userId) mustBe None
    }

    "404 a token that doesn't check out, or names an account that no longer exists" in {
      status(route(app, FakeRequest(GET, "/unsubscribe?token=not.a.token")).get) mustBe NOT_FOUND
      status(route(app, FakeRequest(GET, s"/unsubscribe?token=${tokens.token(UUID.randomUUID().toString)}")).get)
        .mustBe(NOT_FOUND)
    }
  }

  "POST /unsubscribe" should {
    "opt the link's account out with no session and no CSRF token, the way a mail client's one-click POST arrives" in {
      val (userId, _, _) = signUpFreshUser()
      val resp           = route(
        app,
        FakeRequest(POST, s"/unsubscribe?token=${tokens.token(userId)}")
          .withFormUrlEncodedBody("List-Unsubscribe" -> "One-Click")
      ).get
      status(resp) mustBe OK
      optedOut(userId).value.source mustBe NewsEmailOptOutSource.UnsubscribeLink
    }

    "change nothing for a bad token" in {
      val (userId, _, _) = signUpFreshUser()
      val resp           = route(app, FakeRequest(POST, s"/unsubscribe?token=$userId.forged")).get
      status(resp) mustBe NOT_FOUND
      optedOut(userId) mustBe None
    }
  }

  "The sign-up form's news box" should {
    "start checked only where the deployment's country has opt-out email law" in {
      val config        = app.injector.instanceOf[play.api.Configuration]
      val country       = config.get[String](s"city-params.country-id.${config.get[String]("city-id")}")
      val optOutCountry = config.get[Seq[String]]("news-email-opt-out-countries").contains(country)
      val page          = contentAsString(route(app, FakeRequest(GET, "/signUp")).get)
      page must include("name=\"newsEmail\"")
      page.contains("name=\"newsEmail\" value=\"true\" checked") mustBe optOutCountry
    }
  }

  "Signing up" should {
    "leave a new account subscribed when the news box is checked, and opt it out when it isn't" in {
      val (subscribed, _, _)   = signUpFreshUser()
      val (optedOutUser, _, _) = signUpFreshUser(newsEmail = false)
      optedOut(subscribed) mustBe None
      // Which sign-up reason depends on how the box starts in this deployment's country.
      val preChecked = app.injector.instanceOf[service.ConfigService].getNewsEmailPreChecked
      optedOut(optedOutUser).value.source mustBe {
        if (preChecked) NewsEmailOptOutSource.SignUpOptedOut else NewsEmailOptOutSource.SignUpNotOptedIn
      }
    }
  }

  "Saving Settings" should {
    "opt out when the news box is unchecked and back in when it is checked again" in {
      val (userId, _, sessionCookies) = signUpFreshUser()
      val username                    = await(authService.findByUserId(userId)).value.username
      status(saveSettings(sessionCookies, username, newsEmail = false)) mustBe OK
      optedOut(userId).value.source mustBe NewsEmailOptOutSource.Settings
      status(saveSettings(sessionCookies, username, newsEmail = true)) mustBe OK
      optedOut(userId) mustBe None
    }
  }

  "The send list" should {
    "hold subscribed registered accounts only, each with its unsubscribe link, and open to admins alone" in {
      val (subscribed, email, sessionCookies) = signUpFreshUser()
      val (optedOutUser, _, _)                = signUpFreshUser(newsEmail = false)
      val anonymous                           = newAnonUser()

      val recipients = await(userService.getNewsEmailRecipients)
      recipients.map(_._1) must contain(subscribed)
      recipients.map(_._1) must not contain optedOutUser
      recipients.map(_._1) must not contain anonymous

      status(route(app, FakeRequest(GET, "/adminapi/newsEmailRecipients.csv").withCookies(sessionCookies*)).get)
        .must(not be OK)

      await(authService.updateRole(subscribed, Role.Administrator))
      val csv = route(app, FakeRequest(GET, "/adminapi/newsEmailRecipients.csv").withCookies(sessionCookies*)).get
      status(csv) mustBe OK
      contentType(csv) mustBe Some("text/csv")
      val lines = contentAsString(csv).split("\n")
      lines.head mustBe "user_id,username,email,unsubscribe_url"
      lines.find(_.startsWith(s"$subscribed,")).value must endWith(s"/unsubscribe?token=${tokens.token(subscribed)}")
      lines.find(_.startsWith(s"$subscribed,")).value must include(s",$email,")
      lines.exists(_.startsWith(s"$optedOutUser,")) mustBe false
    }
  }
}
