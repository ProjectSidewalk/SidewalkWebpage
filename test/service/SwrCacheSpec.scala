package service

import org.apache.pekko.actor.ActorSystem
import org.scalatest.concurrent.Eventually
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.cache.AsyncCacheApi
import play.api.inject.guice.GuiceApplicationBuilder
import util.SidewalkSpec

import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.*
import scala.concurrent.{Await, ExecutionContext, Future, Promise}

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

  "a failed compute" should {
    // A short backoff, so the tests can watch it end; the production default is SwrCache.FailureBackoff.
    val backoff                        = 2.seconds
    lazy val backingOffCache: SwrCache =
      new SwrCache(app.injector.instanceOf[AsyncCacheApi], app.injector.instanceOf[ActorSystem])(using
        app.injector.instanceOf[ExecutionContext]
      ) {
        override protected def failureBackoff: FiniteDuration = backoff
      }

    "fail the next cold request at once with the same error, then compute again once the backoff ends" in {
      val key                      = freshKey()
      val runs                     = AtomicInteger(0)
      val failure                  = IllegalStateException("db down")
      def compute: Future[Payload] = { runs.incrementAndGet(); Future.failed(failure) }

      intercept[IllegalStateException](
        await(backingOffCache.staleWhileRevalidate[Payload](key, 1.minute, 1.hour)(compute))
      )
      val repeated =
        intercept[IllegalStateException](
          await(backingOffCache.staleWhileRevalidate[Payload](key, 1.minute, 1.hour)(compute))
        )
      assert(repeated eq failure)
      runs.get mustBe 1

      Thread.sleep(backoff.toMillis + 100)
      val recovered = Payload(7)
      assert(
        await(
          backingOffCache.staleWhileRevalidate[Payload](key, 1.minute, 1.hour)(Future.successful(recovered))
        ) eq recovered
      )
    }

    "keep serving the cached value without starting refreshes during the backoff" in {
      val key    = freshKey()
      val seeded = Payload(8)
      await(backingOffCache.put(key, seeded, 1.hour))
      val runs = AtomicInteger(0)
      // Zero freshness: every serve is stale and asks for a refresh, so only the backoff can hold one back.
      def failing: Future[Payload] = { runs.incrementAndGet(); Future.failed(IllegalStateException("db down")) }

      assert(await(backingOffCache.staleWhileRevalidate[Payload](key, Duration.Zero, 1.hour)(failing)) eq seeded)
      eventually(runs.get mustBe 1)
      // Let the failed refresh finish, so the next serves find its backoff rather than the refresh still in flight
      // (which they would share, proving nothing). Well inside the two-second backoff.
      Thread.sleep(200)
      (1 to 5).foreach { _ =>
        assert(await(backingOffCache.staleWhileRevalidate[Payload](key, Duration.Zero, 1.hour)(failing)) eq seeded)
      }
      runs.get mustBe 1
    }

    "clear the backoff once a compute succeeds" in {
      val key = freshKey()
      intercept[IllegalStateException](
        await(
          backingOffCache.staleWhileRevalidate[Payload](key, 1.minute, 1.hour)(
            Future.failed(IllegalStateException("x"))
          )
        )
      )
      Thread.sleep(backoff.toMillis + 100)
      val first = Payload(9)
      assert(
        await(
          backingOffCache.staleWhileRevalidate[Payload](key, Duration.Zero, 1.hour)(Future.successful(first))
        ) eq first
      )
      // Stale on every serve: a second success must be allowed to start right away, with no backoff left behind.
      val runs = AtomicInteger(0)
      val _    = await(backingOffCache.staleWhileRevalidate[Payload](key, Duration.Zero, 1.hour) {
        runs.incrementAndGet(); Future.successful(Payload(10))
      })
      eventually(runs.get mustBe 1)
    }
  }
}
