package service

import com.typesafe.config.ConfigFactory
import org.scalatestplus.play.PlaySpec
import play.api.Configuration

import scala.concurrent.duration.DurationInt

/**
 * Unit tests for RateLimiter's fixed-window counting. No application/DB boot required; the clock is driven manually so
 * window expiry is deterministic.
 */
class RateLimiterSpec extends PlaySpec {

  /** A RateLimiter whose clock is a mutable field, so tests can advance time across window boundaries. */
  private class TestRateLimiter(config: Configuration) extends RateLimiter(config) {
    var currentMs: Long                = 0L
    override protected def nowMs: Long = currentMs
  }

  private def limiter(enabled: Boolean): TestRateLimiter =
    new TestRateLimiter(Configuration(ConfigFactory.parseString(s"""
      rate-limit {
        enabled = $enabled
        login { max-attempts = 3, window-seconds = 60 }
      }
    """)))

  "RateLimiter.allow" should {
    "allow up to maxAttempts within a window, then deny" in {
      val rl = limiter(enabled = true)
      rl.allow("k", 3, 60.seconds) mustBe true
      rl.allow("k", 3, 60.seconds) mustBe true
      rl.allow("k", 3, 60.seconds) mustBe true
      rl.allow("k", 3, 60.seconds) mustBe false
    }

    "reset the counter once the window elapses" in {
      val rl = limiter(enabled = true)
      rl.allow("k", 2, 60.seconds) mustBe true
      rl.allow("k", 2, 60.seconds) mustBe true
      rl.allow("k", 2, 60.seconds) mustBe false
      rl.currentMs = 60000 // advance exactly one window
      rl.allow("k", 2, 60.seconds) mustBe true
    }

    "not reset until the full window has elapsed" in {
      val rl = limiter(enabled = true)
      rl.allow("k", 1, 60.seconds) mustBe true
      rl.currentMs = 59999 // one ms short of the window
      rl.allow("k", 1, 60.seconds) mustBe false
    }

    "track keys independently" in {
      val rl = limiter(enabled = true)
      rl.allow("a", 1, 60.seconds) mustBe true
      rl.allow("a", 1, 60.seconds) mustBe false
      rl.allow("b", 1, 60.seconds) mustBe true
    }

    "be a no-op (always allow) when disabled" in {
      val rl = limiter(enabled = false)
      (1 to 100).foreach(_ => rl.allow("k", 1, 60.seconds) mustBe true)
    }
  }

  "RateLimiter.limit" should {
    "read max-attempts and window from the named config block" in {
      val lim = limiter(enabled = true).limit("login")
      lim.maxAttempts mustBe 3
      lim.window mustBe 60.seconds
    }
  }
}
