package controllers

import models.user.Role
import org.apache.pekko.stream.Materializer
import org.scalatest.Assertion
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.mvc.{Cookie, Result}
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.{AnonSession, RoleSession, SidewalkSpec}

import java.time.ZonedDateTime
import scala.concurrent.duration.*
import scala.concurrent.{Await, ExecutionContext, Future}

/**
 * A session cookie that is garbage, tampered with, or expired must count as no session at all, never as the user it
 * once belonged to (#5841). Revoked cookies (after a password change) are covered by `ChangePasswordSpec`.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class StaleSessionSpec extends SidewalkSpec with RoleSession with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // AnonSession mints one session per call and the limiter is per-IP; every suite in a run shares loopback.
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  given mat: Materializer    = app.materializer
  given ec: ExecutionContext = app.injector.instanceOf[ExecutionContext]

  private val cookieName: String = app.configuration.get[String]("silhouette.authenticator.cookieName")

  /** An admin, so a cookie wrongly accepted would open someone else's data, not just a page. */
  private lazy val adminCookies: Seq[Cookie] = sessionAs(Role.Administrator)

  /** Another user's labels: only an admin may read them, and without a session the request gets a 401. */
  private lazy val someoneElsesLabels: String = s"/userapi/labels?userId=${userIdOf(freshAnonSession())}"

  private def withAuthenticator(cookies: Seq[Cookie], value: String): Seq[Cookie] =
    cookies.map(c => if (c.name == cookieName) c.copy(value = value) else c)

  private def authenticatorValue(cookies: Seq[Cookie]): String =
    cookies.find(_.name == cookieName).map(_.value).getOrElse(fail(s"No $cookieName cookie in the session."))

  /** @return The response to a fetch, which gets a 401 without a session rather than a new anonymous account. */
  private def fetch(path: String, cookies: Seq[Cookie]): Future[Result] =
    route(app, FakeRequest(GET, path).withCookies(cookies*).withHeaders("Sec-Fetch-Mode" -> "cors")).get

  /** Passes if the cookies act as no session: refused another user's data, and sent off to make an anonymous one. */
  private def mustBeLoggedOut(cookies: Seq[Cookie]): Assertion = {
    status(fetch(someoneElsesLabels, cookies)) mustBe UNAUTHORIZED
    val page = route(app, FakeRequest(GET, "/dashboard").withCookies(cookies*)).get
    status(page) mustBe SEE_OTHER
    redirectLocation(page).getOrElse("") must startWith("/anonSignUp")
  }

  "A session cookie" should {
    "act as its user while it's good" in {
      status(fetch(someoneElsesLabels, adminCookies)) mustBe OK
    }

    "count as logged out when it's garbage" in {
      mustBeLoggedOut(withAuthenticator(adminCookies, "not-a-session"))
    }

    "count as logged out when it's been tampered with" in {
      val value   = authenticatorValue(adminCookies)
      val flipped = if (value.last == 'A') 'B' else 'A'
      mustBeLoggedOut(withAuthenticator(adminCookies, value.dropRight(1) + flipped))
    }

    "count as logged out once it has expired" in {
      given request: FakeRequest[?] = FakeRequest().withCookies(adminCookies*)
      val expired                   = Await.result(
        authenticatorService.retrieve.flatMap {
          case Some(auth) =>
            authenticatorService.init(auth.copy(expirationDateTime = ZonedDateTime.now().minusMinutes(1)))
          case None => Future.failed(IllegalStateException("The admin session resolves to no authenticator."))
        },
        30.seconds
      )
      mustBeLoggedOut(withAuthenticator(adminCookies, expired.value))
    }
  }
}
