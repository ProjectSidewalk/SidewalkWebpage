package controllers

import models.user.{NewsEmailOptOutSource, NewsEmailSuppression, Role}
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsArray, JsNull, Json}
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper.*
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import play.silhouette.api.util.PasswordInfo
import service.{AuthenticationService, NewsEmailTokenService, UserService}
import util.{SidewalkSpec, SignedUpAccounts}

import java.time.{Instant, OffsetDateTime}
import java.util.UUID
import scala.concurrent.{Await, Future}
import scala.concurrent.duration.*

/**
 * The newsletter opt-out end to end (#5864): unsubscribe link, sign-up box, Settings save, admin send list, and the
 * import of bounced and spam-reported addresses.
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

  private def optedOut(userId: String) = await(userService.getNewsEmailStatus(userId)).optOut

  private def consentedAt(userId: String) = await(userService.getNewsEmailStatus(userId)).consentedAt

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

  private def suppression(email: String, reason: String, at: String) =
    Json.obj("email" -> email, "reason" -> reason, "at" -> at)

  private def importSuppressions(sessionCookies: Seq[Cookie], rows: JsArray) =
    route(
      app,
      FakeRequest(POST, "/adminapi/newsEmailSuppressions").withCookies(sessionCookies*).withJsonBody(rows).withCSRFToken
    ).get

  private def reportSpam(email: String): Unit = {
    val complaint = NewsEmailSuppression(email, NewsEmailOptOutSource.Complaint, OffsetDateTime.now())
    await(userService.importNewsEmailSuppressions(Seq(complaint))) mustBe 1
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

    "404 a token that doesn't check out, names an account that no longer exists, or is missing" in {
      status(route(app, FakeRequest(GET, "/unsubscribe?token=not.a.token")).get) mustBe NOT_FOUND
      val missing = route(app, FakeRequest(GET, "/unsubscribe")).get
      status(missing) mustBe NOT_FOUND
      contentAsString(missing) must include("/dashboard/settings#email")
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
      header("Referrer-Policy", resp) mustBe Some("no-referrer")
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
      // Which sign-up reason depends on how the box starts in this deployment's country, as does whether a ticked
      // box counts as consent (only a box that started unchecked does).
      val preChecked = app.injector.instanceOf[service.ConfigService].getNewsEmailPreChecked
      consentedAt(subscribed).isDefined mustBe !preChecked
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
      consentedAt(userId) mustBe defined
    }

    "leave an account that reported the newsletter as spam opted out, with the box locked" in {
      val (userId, email, sessionCookies) = signUpFreshUser()
      val username                        = await(authService.findByUserId(userId)).value.username
      reportSpam(email)
      status(saveSettings(sessionCookies, username, newsEmail = true)) mustBe OK
      optedOut(userId).value.source mustBe NewsEmailOptOutSource.Complaint
      consentedAt(userId) mustBe None

      val page = contentAsString(route(app, FakeRequest(GET, "/dashboard/settings").withCookies(sessionCookies*)).get)
      page must include regex """id="set-news-email"[^>]*disabled"""
      page must include("reported one of our emails as spam")
    }
  }

  "Importing the mail sender's suppression list" should {
    "opt out the accounts behind its addresses with the sender's time and reason, for admins alone" in {
      val (bounced, bouncedEmail, _)       = signUpFreshUser()
      val (complained, complainedEmail, _) = signUpFreshUser()
      val (admin, _, sessionCookies)       = signUpFreshUser()
      val rows                             = Json.arr(
        // The sender may spell an address in any letter case; ours are stored in lower case.
        suppression(bouncedEmail.toUpperCase, "bounce", "2026-11-20T12:00:00Z"),
        // The export script writes times the way Python does, with microseconds and a numeric offset.
        suppression(complainedEmail, "complaint", "2026-11-21T08:30:00.123000+01:00"),
        suppression(s"nobody.${UUID.randomUUID()}@example.test", "bounce", "2026-11-20T12:00:00Z")
      )

      status(importSuppressions(sessionCookies, rows)) must not be OK
      optedOut(bounced) mustBe None

      await(authService.updateRole(admin, Role.Administrator))
      val imported = importSuppressions(sessionCookies, rows)
      status(imported) mustBe OK
      contentAsJson(imported) mustBe Json.obj("addresses" -> 3, "opted_out" -> 2)
      optedOut(bounced).value.source mustBe NewsEmailOptOutSource.Bounce
      optedOut(bounced).value.at.toInstant mustBe Instant.parse("2026-11-20T12:00:00Z")
      optedOut(complained).value.source mustBe NewsEmailOptOutSource.Complaint
      optedOut(complained).value.at.toInstant mustBe Instant.parse("2026-11-21T07:30:00.123Z")
      await(userService.getNewsEmailRecipients).map(_._1) must contain noneOf (bounced, complained)

      // The whole list is exported after every send, so the same rows come back each time.
      contentAsJson(importSuppressions(sessionCookies, rows)) mustBe Json.obj("addresses" -> 3, "opted_out" -> 0)
    }

    "keep an earlier opt-out's reason over a bounce, but not over a spam report" in {
      val (userId, email, _) = signUpFreshUser()
      await(userService.optOutOfNewsEmail(userId, NewsEmailOptOutSource.Settings))
      val bounce = NewsEmailSuppression(email, NewsEmailOptOutSource.Bounce, OffsetDateTime.now())
      await(userService.importNewsEmailSuppressions(Seq(bounce))) mustBe 0
      optedOut(userId).value.source mustBe NewsEmailOptOutSource.Settings

      reportSpam(email)
      optedOut(userId).value.source mustBe NewsEmailOptOutSource.Complaint
      await(userService.importNewsEmailSuppressions(Seq(bounce))) mustBe 0
      optedOut(userId).value.source mustBe NewsEmailOptOutSource.Complaint
    }

    "refuse the whole file over one bad row, naming it" in {
      val (userId, email, sessionCookies) = signUpFreshUser()
      await(authService.updateRole(userId, Role.Administrator))
      val (other, otherEmail, _) = signUpFreshUser()
      // Only the sender's two reasons may be imported; the rest are the user's own to set.
      val badReason = Json.arr(
        suppression(otherEmail, "bounce", "2026-11-20T12:00:00Z"),
        suppression(email, "settings", "2026-11-20T12:00:00Z")
      )
      val refused = importSuppressions(sessionCookies, badReason)
      status(refused) mustBe BAD_REQUEST
      contentAsString(refused) must include("(1)/reason")
      status(importSuppressions(sessionCookies, Json.arr(suppression(otherEmail, "bounce", "yesterday")))) mustBe
        BAD_REQUEST
      optedOut(other) mustBe None
    }
  }

  "The send list" should {
    "hold subscribed registered accounts only, each with its unsubscribe link, and open to admins alone" in {
      val (subscribed, email, sessionCookies) = signUpFreshUser()
      val (optedOutUser, _, _)                = signUpFreshUser(newsEmail = false)
      val anonymous                           = newAnonUser()
      // An anonymous account an admin promoted keeps its placeholder address, which must never be mailed.
      val promotedAnonymous = newAnonUser()
      await(authService.updateRole(promotedAnonymous, Role.Registered))

      val recipients = await(userService.getNewsEmailRecipients)
      recipients.map(_._1) must contain(subscribed)
      recipients.map(_._1) must not contain optedOutUser
      recipients.map(_._1) must not contain anonymous
      recipients.map(_._1) must not contain promotedAnonymous

      status(route(app, FakeRequest(GET, "/adminapi/newsEmailRecipients.csv").withCookies(sessionCookies*)).get)
        .must(not be OK)

      await(authService.updateRole(subscribed, Role.Administrator))
      val csv = route(app, FakeRequest(GET, "/adminapi/newsEmailRecipients.csv").withCookies(sessionCookies*)).get
      status(csv) mustBe OK
      contentType(csv) mustBe Some("text/csv")
      val lines = contentAsString(csv).split("\n")
      lines.head mustBe "user_id,username,email,unsubscribe_url"
      lines.find(_.startsWith(s"$subscribed,")).value must endWith(s"/unsubscribe?token=${tokens.token(subscribed)}")
      // An admin opens this in a spreadsheet, so nothing in it may start as a formula.
      lines.forall(line => !line.split(",").exists(cell => cell.headOption.exists("=+-@".contains(_)))) mustBe true
      lines.find(_.startsWith(s"$subscribed,")).value must include(s",$email,")
      lines.exists(_.startsWith(s"$optedOutUser,")) mustBe false
    }
  }
}
