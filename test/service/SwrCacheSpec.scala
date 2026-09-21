package service

import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder

import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration._
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
class SwrCacheSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

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
      val runs                     = new AtomicInteger(0)
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
      val runs                     = new AtomicInteger(0)
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
          Future.failed(new IllegalStateException("db down"))
        )
      an[IllegalStateException] must be thrownBy await(boom)
    }
  }
}
