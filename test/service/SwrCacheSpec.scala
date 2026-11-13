package service

import org.scalatest.concurrent.Eventually
import org.scalatest.time.{Seconds, Span}
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.SidewalkSpec

import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.*
import scala.concurrent.{Await, Future, Promise}

/**
 * What #5418 added to [[SwrCache]], against the app's real Play cache: `put`, which lets a job that has already
 * computed a value seed it for the request path and which a slower refresh must not overwrite, and the cold-wait
 * deadline, which turns a compute that outlasts the request into a `None` while the compute keeps running toward the
 * cache.
 *
 * Every key is unique to its test so nothing here can see, or leave, another test's value; the cache is per JVM and
 * the suite shares one. The computes are `Promise`s the tests complete by hand, so "still running" and "finished" are
 * states the test controls rather than timing it hopes for.
 */
class SwrCacheSpec extends SidewalkSpec with GuiceOneAppPerSuite with Eventually {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val swrCache                  = app.injector.instanceOf[SwrCache]
  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)
  private def freshKey(): String        = s"SwrCacheSpec:${UUID.randomUUID()}"

  /** A value with identity: the tests prove sharing by `eq`, which an `Int` or `String` could satisfy by accident. */
  private case class Payload(n: Int)

  "put" should {
    "seed a value that staleWhileRevalidate then serves without computing" in {
      val key    = freshKey()
      val seeded = Payload(1)
      await(swrCache.put(key, seeded, 1.hour))

      val served = await(swrCache.staleWhileRevalidate[Payload](key, 10.minutes, 1.hour)(fail("compute ran")))
      assert(served eq seeded)
    }

    "seed a value the deadline variant serves as a hit" in {
      val key    = freshKey()
      val seeded = Payload(2)
      await(swrCache.put(key, seeded, 1.hour))

      val served =
        await(swrCache.staleWhileRevalidateWithin[Payload](key, 10.minutes, 1.hour, 1.second)(fail("compute ran")))
      assert(served.exists(_ eq seeded))
    }

    "outlive a refresh that started before the put and finished after it" in {
      // The nightly seed's race: a request-triggered compute reads pre-clustering inputs, the job seeds the
      // post-clustering value while it runs, and the compute lands last. The seed must be what is served.
      val key      = freshKey()
      val promise  = Promise[Payload]()
      val computed = Payload(6)
      val seeded   = Payload(7)

      val refresh = swrCache.staleWhileRevalidateWithin[Payload](key, 10.minutes, 1.hour, 200.millis)(promise.future)
      await(refresh) mustBe None
      await(swrCache.put(key, seeded, 1.hour))

      assert(await(swrCache.staleWhileRevalidate[Payload](key, 10.minutes, 1.hour)(fail("compute ran"))) eq seeded)
      promise.success(computed)

      // The skipped write is a no-op with nothing to await, so the proof is that the seed stays served: an overwrite
      // would land within milliseconds of the compute completing, well inside this window.
      val until = System.nanoTime() + 1.second.toNanos
      while (System.nanoTime() < until) {
        assert(await(swrCache.staleWhileRevalidate[Payload](key, 10.minutes, 1.hour)(fail("compute ran"))) eq seeded)
        Thread.sleep(50)
      }
    }
  }

  "staleWhileRevalidateWithin" should {
    "answer None at the deadline, keep the one compute running, and serve its value once it lands" in {
      val key                      = freshKey()
      val promise                  = Promise[Payload]()
      val runs                     = AtomicInteger(0)
      def compute: Future[Payload] = { runs.incrementAndGet(); promise.future }

      // Cold: nothing cached, the compute never finishes inside the deadline.
      val first = await(swrCache.staleWhileRevalidateWithin[Payload](key, 10.minutes, 1.hour, 200.millis)(compute))
      first mustBe None
      runs.get() mustBe 1

      // A retry inside the window attaches to the same in-flight compute rather than starting another; with a longer
      // deadline it is the caller that sees the value land.
      val second = swrCache.staleWhileRevalidateWithin[Payload](key, 10.minutes, 1.hour, 20.seconds)(compute)
      runs.get() mustBe 1

      val value = Payload(3)
      promise.success(value)
      // The second call's result resolves only after the value is in the cache, so this doubles as the wait.
      assert(await(second).exists(_ eq value))

      // Warm now: a hit, so no compute at all.
      val third = await(swrCache.staleWhileRevalidateWithin[Payload](key, 10.minutes, 1.hour, 1.second)(compute))
      assert(third.exists(_ eq value))
      runs.get() mustBe 1
    }

    "share the in-flight compute with staleWhileRevalidate on the same key" in {
      val key                      = freshKey()
      val promise                  = Promise[Payload]()
      val runs                     = AtomicInteger(0)
      def compute: Future[Payload] = { runs.incrementAndGet(); promise.future }

      await(swrCache.staleWhileRevalidateWithin[Payload](key, 10.minutes, 1.hour, 200.millis)(compute)) mustBe None
      // The blocking variant finds the compute already running and waits on it instead of starting a second.
      val blocking = swrCache.staleWhileRevalidate[Payload](key, 10.minutes, 1.hour)(compute)
      runs.get() mustBe 1

      val value = Payload(4)
      promise.success(value)
      assert(await(blocking) eq value)
      runs.get() mustBe 1
    }

    "return the value when the compute beats the deadline" in {
      val key   = freshKey()
      val value = Payload(5)

      val served =
        await(
          swrCache.staleWhileRevalidateWithin[Payload](key, 10.minutes, 1.hour, 20.seconds)(Future.successful(value))
        )
      assert(served.exists(_ eq value))
    }

    "surface the compute's failure rather than a None" in {
      val key  = freshKey()
      val boom =
        swrCache.staleWhileRevalidateWithin[Payload](key, 10.minutes, 1.hour, 20.seconds)(
          Future.failed(IllegalStateException("db down"))
        )
      an[IllegalStateException] must be thrownBy await(boom)
    }
  }

  "a failed compute with a failure backoff" should {
    "refuse the next cold request at once, then compute again once the backoff ends" in {
      val key                          = freshKey()
      val backoff                      = 300.millis
      val runs                         = AtomicInteger(0)
      val failure                      = IllegalStateException("db down")
      def compute: Future[Payload]     = { runs.incrementAndGet(); Future.failed(failure) }
      def serve(c: => Future[Payload]) = swrCache.staleWhileRevalidate[Payload](key, 1.minute, 1.hour, backoff)(c)

      intercept[IllegalStateException](await(serve(compute)))
      val refused = intercept[SwrCache.RecentlyFailedException](await(serve(compute)))
      assert(refused.getCause eq failure)
      refused.retryAfter must be <= backoff
      runs.get mustBe 1

      eventually(timeout(Span(5, Seconds)))(swrCache.isBackingOff(key, backoff) mustBe false)
      val recovered = Payload(7)
      assert(await(serve(Future.successful(recovered))) eq recovered)
    }

    "keep serving the cached value without starting refreshes during the backoff" in {
      val key     = freshKey()
      val backoff = 1.minute
      val seeded  = Payload(8)
      await(swrCache.put(key, seeded, 1.hour))
      val runs                     = AtomicInteger(0)
      def failing: Future[Payload] = { runs.incrementAndGet(); Future.failed(IllegalStateException("db down")) }
      // Zero freshness: every serve is stale and asks for a refresh, so only the backoff can hold one back.
      def serve() = await(swrCache.staleWhileRevalidate[Payload](key, Duration.Zero, 1.hour, backoff)(failing))

      assert(serve() eq seeded)
      // Wait for the failed refresh to be recorded; until then a serve would share it, which proves nothing.
      eventually(timeout(Span(5, Seconds)))(swrCache.isBackingOff(key, backoff) mustBe true)
      (1 to 5).foreach(_ => assert(serve() eq seeded))
      runs.get mustBe 1
    }

    "not hold back the next compute when no backoff is asked for" in {
      val key                      = freshKey()
      val runs                     = AtomicInteger(0)
      def failing: Future[Payload] = { runs.incrementAndGet(); Future.failed(IllegalStateException("db down")) }

      intercept[IllegalStateException](await(swrCache.staleWhileRevalidate[Payload](key, 1.minute, 1.hour)(failing)))
      intercept[IllegalStateException](await(swrCache.staleWhileRevalidate[Payload](key, 1.minute, 1.hour)(failing)))
      runs.get mustBe 2
    }
  }
}
