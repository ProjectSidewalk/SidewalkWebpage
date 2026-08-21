package controllers

import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneServerPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.ws.WSClient
import play.api.test.Helpers._

/**
 * End-to-end proof that client IPs are spoof-resistant (#1102): Play's forwarded-header processing
 * (`play.http.forwarded.*`) resolves `remoteAddress` by walking X-Forwarded-For right-to-left past trusted proxies,
 * so a client-supplied left-hand hop can't move a request into a different rate-limit bucket.
 *
 * This needs a real server (`route()` bypasses the server layer where the header is processed). The test client
 * connects from 127.0.0.1 — a trusted proxy, i.e. exactly the position of the prod Apache reverse proxy — so the
 * rightmost X-Forwarded-For entry plays the role of the address Apache appends for the true client.
 */
class ForwardedClientIpSpec extends PlaySpec with GuiceOneServerPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure(
        "rate-limit.enabled"                    -> true,
        "rate-limit.anon-signup.max-attempts"   -> 1,
        "rate-limit.anon-signup.window-seconds" -> 3600
      )
      .build()

  "Client IP resolution behind the reverse proxy" should {
    "key rate limits on the rightmost untrusted X-Forwarded-For hop, ignoring client-supplied ones" in {
      val ws                      = app.injector.instanceOf[WSClient]
      def anonSignUp(xff: String) =
        await(
          ws.url(s"http://localhost:$port/anonSignUp")
            .withHttpHeaders("X-Forwarded-For" -> xff)
            .withFollowRedirects(false)
            .get()
        )

      // Budget is 1 per IP. The rightmost hop (what the trusted proxy appends: the true client) is the bucket key.
      anonSignUp("6.6.6.6, 2.2.2.2").status mustBe SEE_OTHER

      // Same true client, different spoofed left-hand hop: must land in the same bucket and get throttled. Under the
      // old first-XFF-value resolution this would have been a fresh bucket and a 303.
      val throttled = anonSignUp("9.9.9.9, 2.2.2.2")
      throttled.status mustBe TOO_MANY_REQUESTS
      throttled.header("Retry-After") mustBe defined
      throttled.header("Location") mustBe empty

      // A different true client is its own bucket.
      anonSignUp("6.6.6.6, 3.3.3.3").status mustBe SEE_OTHER
    }
  }
}
