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
import scala.concurrent.{Await, Future, Promise}

/**
 * The rules [[BoundedCityFanOut]] holds every cross-city total to (#5977): never more than `parallelism` cities in
 * flight, one retry for a transient failure, a failure that survives it fails the whole run, and a schema-shape error
 * sets that one city aside instead.
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

  "run" should {
    "return every city's result in the given order, with at most `parallelism` in flight" in {
      val inFlight    = AtomicInteger(0)
      val maxInFlight = AtomicInteger(0)
      val result      = await(BoundedCityFanOut.run(cities, parallelism = 3, retryDelay = noDelay) { cityId =>
        val now = inFlight.incrementAndGet()
        maxInFlight.accumulateAndGet(now, math.max)
        // Later cities finish first, so in-order output can't come from completion order.
        Future { Thread.sleep(5L + (20 - cityId.stripPrefix("city-").toInt)); inFlight.decrementAndGet(); cityId }
      })

      result.results mustBe cities.map(c => c -> c)
      result.notReady mustBe empty
      maxInFlight.get must be <= 3
    }

    "retry a transient failure once and keep the city when the retry succeeds" in {
      val attempts = Attempts()
      val result   = await(BoundedCityFanOut.run(cities, parallelism = 4, retryDelay = noDelay) { cityId =>
        if (attempts.record(cityId) == 1 && cityId == "city-7") Future.failed(transientError)
        else Future.successful(cityId.length)
      })

      result.results.map(_._1) mustBe cities
      attempts.of("city-7") mustBe 2
      attempts.of("city-8") mustBe 1
    }

    "fail the whole run when a city fails twice, and start no further cities" in {
      val attempts = Attempts()
      val run      = BoundedCityFanOut.run(cities, parallelism = 1, retryDelay = noDelay) { cityId =>
        attempts.record(cityId)
        if (cityId == "city-5") Future.failed(transientError) else Future.successful(cityId)
      }

      val error = intercept[SQLTransientConnectionException](await(run))
      error.getMessage must include("not available")
      attempts.of("city-5") mustBe 2
      // One city at a time, so nothing after the failure was ever started: a lost total stops costing queries.
      attempts.queried mustBe cities.take(5).toSet
    }

    "treat a synchronous throw like a failed query" in {
      val attempts = Attempts()
      val run      = BoundedCityFanOut.run(Seq("only"), parallelism = 2, retryDelay = noDelay) { cityId =>
        attempts.record(cityId)
        throw IllegalStateException("thrown before a Future existed")
      }

      intercept[IllegalStateException](await(run))
      attempts.of("only") mustBe 2
    }

    "set aside a city whose schema can't answer, without retrying it, and keep the rest" in {
      val attempts = Attempts()
      val result   = await(BoundedCityFanOut.run(cities, parallelism = 4, retryDelay = noDelay) { cityId =>
        attempts.record(cityId)
        if (cityId == "city-3") Future.failed(shapeError) else Future.successful(cityId)
      })

      result.results.map(_._1) mustBe cities.filterNot(_ == "city-3")
      result.notReady.map(_._1) mustBe Seq("city-3")
      attempts.of("city-3") mustBe 1
    }

    "return an empty result for no cities" in {
      val result = await(BoundedCityFanOut.run(Seq.empty, parallelism = 2, retryDelay = noDelay)(_ => fail("queried")))
      result mustBe FanOutResult(Seq.empty, Seq.empty)
    }

    "wait for the retry delay before retrying" in {
      val firstFailedAt = Promise[Long]()
      val retriedAt     = Promise[Long]()
      val _             = await(BoundedCityFanOut.run(Seq("slow"), parallelism = 1, retryDelay = 200.millis) { _ =>
        if (!firstFailedAt.isCompleted) {
          firstFailedAt.success(System.nanoTime())
          Future.failed(transientError)
        } else {
          retriedAt.success(System.nanoTime())
          Future.successful(())
        }
      })
      val waited = (await(retriedAt.future) - await(firstFailedAt.future)).nanos
      waited must be >= 200.millis
    }
  }

  "isSchemaShapeError" should {
    "recognize every schema-shape SQLSTATE, directly or wrapped" in {
      BoundedCityFanOut.SchemaShapeSqlStates.foreach { state =>
        BoundedCityFanOut.isSchemaShapeError(SQLException("shape", state)) mustBe true
        BoundedCityFanOut.isSchemaShapeError(RuntimeException("wrapped", SQLException("shape", state))) mustBe true
      }
    }

    "reject connection, capacity and non-SQL failures, which must fail a total instead" in {
      BoundedCityFanOut.isSchemaShapeError(transientError) mustBe false
      BoundedCityFanOut.isSchemaShapeError(SQLException("too many clients already", "53300")) mustBe false
      BoundedCityFanOut.isSchemaShapeError(PSQLException("refused", PSQLState.CONNECTION_UNABLE_TO_CONNECT)) mustBe
        false
      BoundedCityFanOut.isSchemaShapeError(IllegalStateException("not SQL")) mustBe false
    }
  }
}
