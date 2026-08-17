package util

import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.mvc.Cookie
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Mints anonymous sessions for the specs that drive SecuredAction routes over HTTP.
 *
 * Each call creates a distinct persistent user, so a spec that asserts on rows keyed by user gets a clean identity per
 * call. Mix into a `PlaySpec with GuiceOneAppPerSuite`.
 *
 * `/anonSignUp` is capped at 100 per IP per hour (`rate-limit.anon-signup`) and every suite in a run shares the
 * loopback address, so a suite that mints more than a couple of sessions must disable the limiter in its
 * `fakeApplication()` with `.configure("rate-limit.anon-signup.enabled" -> false)`; otherwise repeat runs start
 * hitting 429s, which surface here as a failed session mint rather than as anything about the code under test.
 */
trait AnonSession { this: PlaySpec with GuiceOneAppPerSuite =>

  /**
   * Mints a fresh anonymous session and returns its cookies.
   *
   * @param headers Extra request headers. Silhouette fingerprints a session by User-Agent, so cookies minted under one
   *                UA are rejected when replayed under another — pass the same UA here that the requests will carry.
   * @return The session cookies, to pass to subsequent requests via `withCookies`.
   */
  protected def freshAnonSession(headers: (String, String)*): Seq[Cookie] = {
    val resp = route(app, FakeRequest(GET, "/anonSignUp?url=%2F").withHeaders(headers: _*)).get
    status(resp) mustBe SEE_OTHER
    cookies(resp).toSeq
  }
}
