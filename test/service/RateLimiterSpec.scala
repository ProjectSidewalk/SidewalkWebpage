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
        story-submit { enabled = true, max-attempts = 2, window-seconds = 60 } # per-limiter override
      }
    """)))

  /** An ad-hoc limit, so counting behavior can be exercised without going through a config block. */
  private def lim(maxAttempts: Int, seconds: Int = 60, enabled: Boolean = true): RateLimiter.Limit =
    RateLimiter.Limit(maxAttempts, seconds.seconds, enabled)

  "RateLimiter.allow" should {
    "allow up to maxAttempts within a window, then deny" in {
      val rl = limiter(enabled = true)
      rl.allow("k", lim(3)) mustBe true
      rl.allow("k", lim(3)) mustBe true
      rl.allow("k", lim(3)) mustBe true
      rl.allow("k", lim(3)) mustBe false
    }

    "reset the counter once the window elapses" in {
      val rl = limiter(enabled = true)
      rl.allow("k", lim(2)) mustBe true
      rl.allow("k", lim(2)) mustBe true
      rl.allow("k", lim(2)) mustBe false
      rl.currentMs = 60000 // advance exactly one window
      rl.allow("k", lim(2)) mustBe true
    }

    "not reset until the full window has elapsed" in {
      val rl = limiter(enabled = true)
      rl.allow("k", lim(1)) mustBe true
      rl.currentMs = 59999 // one ms short of the window
      rl.allow("k", lim(1)) mustBe false
    }

    "track keys independently" in {
      val rl = limiter(enabled = true)
      rl.allow("a", lim(1)) mustBe true
      rl.allow("a", lim(1)) mustBe false
      rl.allow("b", lim(1)) mustBe true
    }

    "enforce a limit whose block opts in, even while global rate limiting is disabled" in {
      val rl    = limiter(enabled = false)
      val story = rl.limit("story-submit") // enabled = true, max-attempts = 2
      rl.allow("ip:1", story) mustBe true
      rl.allow("ip:1", story) mustBe true
      rl.allow("ip:1", story) mustBe false
    }

    "be a no-op for a limit that is not enabled" in {
      // A login limit with the global off and no block flag -> disabled -> never denies. The enabled decision belongs
      // to the Limit, so an endpoint can't accidentally consult the global flag instead of its own block's.
      val rl    = limiter(enabled = false)
      val login = rl.limit("login")
      (1 to 100).foreach(_ => rl.allow("ip:1", login) mustBe true)
    }
  }

  "RateLimiter.limit" should {
    "read max-attempts and window from the named config block" in {
      val login = limiter(enabled = true).limit("login")
      login.maxAttempts mustBe 3
      login.window mustBe 60.seconds
    }

    "let a block's own enabled flag override the global default when the global is off" in {
      val rl = limiter(enabled = false)
      rl.limit("story-submit").enabled mustBe true // block sets enabled = true
      rl.limit("login").enabled mustBe false       // no block flag -> inherits global (off)
    }

    "inherit the global enabled default when a block sets no flag" in {
      limiter(enabled = true).limit("login").enabled mustBe true
    }
  }

  // The check/charge/refund trio backs limits that should only cost something on failure — a sign-in throttle that
  // counted successes would lock a shared account out of its own logins (#1102).
  "RateLimiter.isBlocked with record and clear" should {
    "not spend budget on its own" in {
      val rl = limiter(enabled = true)
      (1 to 100).foreach(_ => rl.isBlocked("k", lim(1)) mustBe false)
    }

    "block only once maxAttempts have been recorded" in {
      val rl = limiter(enabled = true)
      rl.record("k", lim(2))
      rl.isBlocked("k", lim(2)) mustBe false
      rl.record("k", lim(2))
      rl.isBlocked("k", lim(2)) mustBe true
    }

    "stop blocking once the window elapses" in {
      val rl = limiter(enabled = true)
      rl.record("k", lim(1))
      rl.isBlocked("k", lim(1)) mustBe true
      rl.currentMs = 60000
      rl.isBlocked("k", lim(1)) mustBe false
    }

    "hand the whole budget back on clear" in {
      val rl = limiter(enabled = true)
      rl.record("k", lim(2))
      rl.record("k", lim(2))
      rl.isBlocked("k", lim(2)) mustBe true

      rl.clear("k")
      rl.isBlocked("k", lim(2)) mustBe false
      // A full budget, not a reprieve of one: two more failures fit before it blocks again.
      rl.record("k", lim(2))
      rl.isBlocked("k", lim(2)) mustBe false
      rl.record("k", lim(2))
      rl.isBlocked("k", lim(2)) mustBe true
    }

    "neither block nor count for a limit that is not enabled" in {
      val rl       = limiter(enabled = true)
      val disabled = lim(1, enabled = false)
      rl.record("k", disabled)
      rl.record("k", disabled)
      rl.isBlocked("k", disabled) mustBe false
      // Nothing was counted, so re-enabling finds an untouched budget rather than a hidden one.
      rl.isBlocked("k", lim(1)) mustBe false
    }
  }

  "RateLimiter.retryAfterSeconds" should {
    "report the time left in the key's window, not the window's full length" in {
      val rl = limiter(enabled = true)
      rl.allow("k", lim(1)) mustBe true
      rl.currentMs += 20000
      rl.retryAfterSeconds("k") mustBe Some(40L)
    }

    "round up, so the quoted moment is never before the window actually clears" in {
      val rl = limiter(enabled = true)
      rl.allow("k", lim(1)) mustBe true
      rl.currentMs += 19500 // 40.5s left: quoting 40 would send them back a half-second early.
      rl.retryAfterSeconds("k") mustBe Some(41L)
    }

    "never report zero for a window that has only just elapsed" in {
      val rl = limiter(enabled = true)
      rl.allow("k", lim(1)) mustBe true
      rl.currentMs += 60000
      rl.retryAfterSeconds("k") mustBe Some(1L)
    }

    "report nothing for a key that has never been seen" in {
      limiter(enabled = true).retryAfterSeconds("never-used") mustBe None
    }
  }
}
