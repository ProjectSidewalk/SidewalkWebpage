package service

import org.apache.pekko.pattern.after
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Sink, Source}

import java.sql.{SQLException, SQLTransientException}
import java.util.concurrent.ThreadLocalRandom
import scala.annotation.tailrec
import scala.concurrent.duration.{FiniteDuration, NANOSECONDS}
import scala.concurrent.{ExecutionContext, Future}

/**
 * One cross-city fan-out's outcome: every city that answered, plus the ones whose schema can't answer this query yet.
 *
 * @param results  Each answering city's value, in the order the cities were given.
 * @param notReady Cities whose schema lacks something the query reads (see [[BoundedCityFanOut.isSchemaShapeError]]),
 *                 with the error that showed it, in the order the cities were given. They are left out of `results`
 *                 on purpose, not by accident.
 * @tparam A       The per-city value.
 */
case class FanOutResult[A](results: Seq[(String, A)], notReady: Seq[(String, Throwable)])

/**
 * Runs one query per city with a cap on how many are in flight, so a cross-city total is either complete or a failure
 * (#5977).
 *
 * The cap exists because about 60 JVMs share one Postgres. A refresh that fires every city's queries at once asks for
 * ~120 connections from a pool that idles at 2, and a total that quietly skips a lost query is short by a whole city.
 * A city's failed query is retried, with growing jittered delays so ~60 JVMs whose refreshes coincide don't retry in
 * lockstep, up to `maxAttempts` in all. A failure that outlasts its retries fails the whole fan-out, and no further
 * cities are started (the ones already in flight still finish, but their results are discarded).
 *
 * Two kinds of failure are not retried:
 *   - A schema-shape error ([[isSchemaShapeError]]) is not fatal either: a schema that is behind on evolutions, or was
 *     never granted to this role, fails the same way every time, so the city is reported in
 *     [[FanOutResult.notReady]] and the caller decides what that costs.
 *   - A statement timeout ([[NotRetriedSqlStates]]) is fatal at once: a query that ran out of time would only run out
 *     of time again, at the same cost.
 *
 * {{{
 * BoundedCityFanOut.run(Seq("seattle-wa", "chicago-il"), parallelism = 6, maxAttempts = 3, retryDelay = 1.second) {
 *   cityId => db.run(configTable.getContributorUserIdsBySchema(getCitySchema(cityId)))
 * }
 * // => FanOutResult(results = Seq("seattle-wa" -> ids1, "chicago-il" -> ids2), notReady = Seq())
 * }}}
 */
object BoundedCityFanOut {

  /**
   * The SQLSTATE class for "the schema can't run this statement": `42` (syntax error or access rule violation).
   *
   * It covers every way a schema behind on evolutions fails a query that a migrated one answers: 42P01 undefined
   * table, 42703 undefined column, 42704 undefined object (a label-type enum), 42883 undefined function, 42804
   * datatype mismatch after a type change, and 42501 insufficient privilege for a schema or table never granted to this
   * role. A query that is itself wrong fails with the same class on every schema, including the caller's own, which
   * is how the caller tells the two apart.
   */
  val SchemaShapeSqlStateClass: String = "42"

  /** `invalid_schema_name`: the schema itself is gone, the other way a schema can't answer. */
  val InvalidSchemaSqlState: String = "3F000"

  /** SQLSTATEs that fail the fan-out without a retry: 57014 `query_canceled`, what a statement timeout raises. */
  val NotRetriedSqlStates: Set[String] = Set("57014")

  /**
   * Whether `e` says the schema can't answer this query, rather than that the database had a bad moment.
   *
   * Walks the cause chain because Slick and the pool can wrap the driver's `PSQLException`. Stops at a
   * `SQLTransientException` (a pool timeout is one) and calls it transient whatever SQLSTATE it carries, because the
   * pool can copy the state of the last failed connection attempt onto its timeout.
   *
   * @param e The failure a city's query produced.
   * @return  True if the schema can't answer this query until it is migrated or granted.
   */
  def isSchemaShapeError(e: Throwable): Boolean = sqlState(e).exists { state =>
    state.startsWith(SchemaShapeSqlStateClass) || state == InvalidSchemaSqlState
  }

  /**
   * Whether a failed attempt is worth repeating: anything that is neither a shape error nor in [[NotRetriedSqlStates]].
   *
   * @param e The failure a city's query produced.
   * @return  True if another attempt could plausibly succeed.
   */
  def isRetryable(e: Throwable): Boolean =
    !isSchemaShapeError(e) && !sqlState(e).exists(NotRetriedSqlStates.contains)

  /**
   * The SQLSTATE of the first non-transient `SQLException` in `e`'s cause chain.
   *
   * @param e A failure, possibly wrapping a driver exception.
   * @return  Its SQLSTATE, or None when there is none or a transient exception comes first.
   */
  private def sqlState(e: Throwable): Option[String] = {
    @tailrec
    def loop(t: Throwable, depth: Int): Option[String] = t match {
      case null                                         => None
      case _: SQLTransientException                     => None
      case sql: SQLException if sql.getSQLState != null => Some(sql.getSQLState)
      case _ if depth >= 10                             => None // Guards a cyclic chain.
      case _                                            => loop(t.getCause, depth + 1)
    }
    loop(e, 0)
  }

  /**
   * How long to wait before retry number `retry` (1 for the first): `retryDelay` doubled per retry, scaled by a random
   * factor in [0.5, 1.5).
   *
   * @param retryDelay The base delay.
   * @param retry      Which retry this is, from 1.
   * @return           The jittered delay.
   */
  private[service] def backoffDelay(retryDelay: FiniteDuration, retry: Int): FiniteDuration = {
    val baseNanos = retryDelay.toNanos * (1L << (retry - 1).min(10))
    FiniteDuration((baseNanos * (0.5 + ThreadLocalRandom.current().nextDouble())).toLong, NANOSECONDS)
  }

  /**
   * Queries every city with at most `parallelism` cities in flight, retrying transient failures.
   *
   * Cities run unordered, so one slow city holds only its own slot, and the results are put back in the given order
   * afterwards, so a caller summing floating-point values gets the same total from the same data.
   *
   * @param cityIds     The cities to query, in the order their results should come back.
   * @param parallelism How many cities may be querying at once.
   * @param maxAttempts How many times a city's query may run in all, retries included; at least 1.
   * @param retryDelay  Base delay before a retry; see [[backoffDelay]].
   * @param query       One city's query. A synchronous throw is treated like a failed Future.
   * @return            Every city's result plus the not-ready cities, or the first failure that outlasted its retries.
   */
  def run[A](cityIds: Seq[String], parallelism: Int, maxAttempts: Int, retryDelay: FiniteDuration)(
      query: String => Future[A]
  )(using ec: ExecutionContext, mat: Materializer): Future[FanOutResult[A]] = {
    require(parallelism > 0, s"parallelism must be positive, got $parallelism")
    require(maxAttempts > 0, s"maxAttempts must be positive, got $maxAttempts")

    def attempt(cityId: String, attemptNumber: Int): Future[A] =
      Future.delegate(query(cityId)).recoverWith {
        case e if attemptNumber < maxAttempts && isRetryable(e) =>
          after(backoffDelay(retryDelay, attemptNumber), mat.system.scheduler)(attempt(cityId, attemptNumber + 1))
      }

    // Left marks a city whose schema can't answer, so it travels through the stream as data instead of failing it.
    def queryCity(cityId: String): Future[Either[Throwable, A]] =
      attempt(cityId, 1).map(Right(_)).recover { case e if isSchemaShapeError(e) => Left(e) }

    // A failed Future fails the stream and cancels the source, so no further cities are started once the total is
    // known to be lost.
    Source(cityIds.toVector.zipWithIndex)
      .mapAsyncUnordered(parallelism) { case (cityId, index) =>
        queryCity(cityId).map(outcome => (index, cityId, outcome))
      }
      .runWith(Sink.seq)
      .map { unordered =>
        val outcomes = unordered.sortBy { case (index, _, _) => index }
        FanOutResult(
          results = outcomes.collect { case (_, cityId, Right(value)) => cityId -> value },
          notReady = outcomes.collect { case (_, cityId, Left(error)) => cityId -> error }
        )
      }
  }
}
