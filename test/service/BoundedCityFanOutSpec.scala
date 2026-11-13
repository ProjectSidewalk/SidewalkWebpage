package service

import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.stream.Materializer
import org.postgresql.util.{PSQLException, PSQLState}
import org.scalatest.BeforeAndAfterAll
import util.SidewalkSpec

import java.sql.{SQLException, SQLTransientConnectionException}
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.*
import scala.concurrent.{Await, Future}

/**
 * The rules [[BoundedCityFanOut]] holds every cross-city total to (#5977): never more than `parallelism` cities in
 * flight, transient failures retried up to `maxAttempts`, a failure that outlasts them fails the whole run, a statement
 * timeout fails it at once, and a schema-shape error sets that one city aside instead.
 *
 * Pure: the "queries" are Futures the tests build, so each failure mode is reachable on purpose and no database runs.
 */
class BoundedCityFanOutSpec extends SidewalkSpec with BeforeAndAfterAll {

  private val system: ActorSystem       = ActorSystem("BoundedCityFanOutSpec")
  private given Materializer            = Materializer(system)
  override def afterAll(): Unit         = { val _ = Await.result(system.terminate(), 30.seconds) }
  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)

  private val cities: Seq[String] = (1 to 20).map(i => s"city-$i")
  private val noDelay             = 1.millis

  /** Counts each city's attempts, so a test can say exactly which cities were queried and how often. */
  private class Attempts {
    private val counts              = ConcurrentHashMap[String, AtomicInteger]()
    def record(cityId: String): Int = counts.computeIfAbsent(cityId, _ => AtomicInteger()).incrementAndGet()
    def of(cityId: String): Int     = Option(counts.get(cityId)).fold(0)(_.get)
    def queried: Set[String]        = counts.keySet.toArray(Array.empty[String]).toSet
  }

  private def transientError: Throwable = SQLTransientConnectionException("Connection is not available, timed out")
  private def shapeError: Throwable     = PSQLException("column \"x\" does not exist", PSQLState.UNDEFINED_COLUMN)
  private def timeoutError: Throwable   = SQLException("canceling statement due to statement timeout", "57014")

  private def run[A](cityIds: Seq[String], parallelism: Int = 4, maxAttempts: Int = 3)(
      query: String => Future[A]
  ): Future[FanOutResult[A]] = BoundedCityFanOut.run(cityIds, parallelism, maxAttempts, noDelay)(query)

  "run" should {
    "return every city's result in the given order, using its parallelism but never exceeding it" in {
      val inFlight    = AtomicInteger(0)
      val maxInFlight = AtomicInteger(0)
      val result      = await(run(cities, parallelism = 3) { cityId =>
        val now = inFlight.incrementAndGet()
        maxInFlight.accumulateAndGet(now, math.max)
        // Later cities finish first, so in-order output can't come from completion order.
        Future { Thread.sleep(5L + (20 - cityId.stripPrefix("city-").toInt)); inFlight.decrementAndGet(); cityId }
      })

      result.results mustBe cities.map(c => c -> c)
      result.notReady mustBe empty
      maxInFlight.get must be <= 3
      maxInFlight.get must be > 1
    }

    "not let one slow city hold back the slots behind it" in {
      // Unordered with parallelism 2: while city-1 is slow, the other slot keeps cycling through everyone else.
      val done   = AtomicInteger(0)
      val result = await(run(cities, parallelism = 2) { cityId =>
        if (cityId == "city-1") Future { Thread.sleep(300); done.get } else Future { done.incrementAndGet(); 0 }
      })
      // By the time city-1 answered, all 19 others had finished in the second slot.
      result.results.head mustBe ("city-1" -> 19)
    }

    "retry transient failures and keep the city when a later attempt succeeds" in {
      val attempts = Attempts()
      val result   = await(run(cities) { cityId =>
        if (cityId == "city-7" && attempts.record(cityId) < 3) Future.failed(transientError)
        else Future.successful(cityId.length)
      })

      result.results.map(_._1) mustBe cities
      attempts.of("city-7") mustBe 3 // Two failed attempts, then the one that succeeded.
    }

    "fail the whole run when a city fails every attempt, and start no further cities" in {
      val attempts = Attempts()
      val failing  = run(cities, parallelism = 3) { cityId =>
        attempts.record(cityId)
        if (cityId == "city-2") Future.failed(transientError)
        else Future { Thread.sleep(50); cityId } // Slow enough that city-2's three attempts finish first.
      }

      intercept[SQLTransientConnectionException](await(failing))
      attempts.of("city-2") mustBe 3
      // A handful of cities started while city-2 was retrying; most of the twenty never did.
      attempts.queried.size must be < cities.size / 2
    }

    "fail at once on a statement timeout, without running the query again" in {
      val attempts = Attempts()
      val failing  = run(Seq("heavy")) { cityId => attempts.record(cityId); Future.failed(timeoutError) }

      intercept[SQLException](await(failing)).getSQLState mustBe "57014"
      attempts.of("heavy") mustBe 1
    }

    "treat a synchronous throw like a failed query" in {
      val attempts = Attempts()
      val failing  = run(Seq("only")) { cityId =>
        attempts.record(cityId)
        throw IllegalStateException("thrown before a Future existed")
      }

      intercept[IllegalStateException](await(failing))
      attempts.of("only") mustBe 3
    }

    "set aside a city whose schema can't answer, without retrying it, and keep the rest" in {
      val attempts = Attempts()
      val result   = await(run(cities) { cityId =>
        attempts.record(cityId)
        if (cityId == "city-3") Future.failed(shapeError) else Future.successful(cityId)
      })

      result.results.map(_._1) mustBe cities.filterNot(_ == "city-3")
      result.notReady.map(_._1) mustBe Seq("city-3")
      attempts.of("city-3") mustBe 1
    }

    "return an empty result for no cities" in {
      await(run(Seq.empty)(_ => fail("queried"))) mustBe FanOutResult(Seq.empty, Seq.empty)
    }
  }

  "backoffDelay" should {
    "double per retry, jittered to within half either side" in {
      (1 to 50).foreach { _ =>
        val first  = BoundedCityFanOut.backoffDelay(1.second, 1)
        val second = BoundedCityFanOut.backoffDelay(1.second, 2)
        first must (be >= 500.millis and be < 1500.millis)
        second must (be >= 1.second and be < 3.seconds)
      }
    }
  }

  "isSchemaShapeError" should {
    "recognize every class-42 SQLSTATE and an invalid schema, directly or wrapped" in {
      Seq("42P01", "42703", "42704", "42883", "42804", "42501", "3F000").foreach { state =>
        BoundedCityFanOut.isSchemaShapeError(SQLException("shape", state)) mustBe true
        BoundedCityFanOut.isSchemaShapeError(RuntimeException("wrapped", SQLException("shape", state))) mustBe true
      }
    }

    "reject connection, capacity, timeout and non-SQL failures, which must fail a total instead" in {
      BoundedCityFanOut.isSchemaShapeError(transientError) mustBe false
      BoundedCityFanOut.isSchemaShapeError(SQLException("too many clients already", "53300")) mustBe false
      BoundedCityFanOut.isSchemaShapeError(PSQLException("refused", PSQLState.CONNECTION_UNABLE_TO_CONNECT)) mustBe
        false
      BoundedCityFanOut.isSchemaShapeError(timeoutError) mustBe false
      BoundedCityFanOut.isSchemaShapeError(IllegalStateException("not SQL")) mustBe false
    }

    "read a pool timeout as transient even when it carries a class-42 state from a failed connection" in {
      val poolTimeout = SQLTransientConnectionException("pool timed out", "42501", SQLException("denied", "42501"))
      BoundedCityFanOut.isSchemaShapeError(poolTimeout) mustBe false
      BoundedCityFanOut.isRetryable(poolTimeout) mustBe true
    }
  }
}
