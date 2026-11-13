package service

import org.apache.pekko.pattern.after
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Sink, Source}

import java.sql.SQLException
import scala.annotation.tailrec
import scala.concurrent.duration.FiniteDuration
import scala.concurrent.{ExecutionContext, Future}

/**
 * One cross-city fan-out's outcome: every city that answered, plus the ones whose schema can't answer this query yet.
 *
 * @param results  Each answering city's value, in the order the cities were given.
 * @param notReady Cities whose schema lacks something the query reads (see [[BoundedCityFanOut.isSchemaShapeError]]),
 *                 with the error that showed it. They are left out of `results` on purpose, not by accident.
 * @tparam A       The per-city value.
 */
case class FanOutResult[A](results: Seq[(String, A)], notReady: Seq[(String, Throwable)])

/**
 * Runs one query per city with a cap on how many are in flight, so a cross-city total is either complete or a failure
 * (#5977).
 *
 * The cap exists because about 60 JVMs share one Postgres. A refresh that fires every city's queries at once asks for
 * ~120 connections from a pool that idles at 2, and a total that quietly skips a lost query is short by a whole city.
 * Each city's query is retried once after `retryDelay`; a failure that survives the retry fails the whole
 * fan-out, and no further cities are started. The one failure that is *not* fatal is a schema-shape error: a schema
 * that is behind on evolutions (or was never granted to this role) will fail the same way every time, so retrying
 * cannot help and failing would block the total for every other city. Those cities are reported in
 * [[FanOutResult.notReady]], so the caller can count only the cities it actually summed.
 *
 * {{{
 * BoundedCityFanOut.run(Seq("seattle-wa", "chicago-il"), parallelism = 6, retryDelay = 1.second) { cityId =>
 *   db.run(configTable.getContributorUserIdsBySchema(getCitySchema(cityId)))
 * }
 * // => FanOutResult(results = Seq("seattle-wa" -> ids1, "chicago-il" -> ids2), notReady = Seq())
 * }}}
 */
object BoundedCityFanOut {

  /**
   * SQLSTATEs meaning the schema is missing something the query reads, rather than that the database had a bad moment.
   *
   *   - 3F000 `invalid_schema_name`, 42P01 `undefined_table`, 42703 `undefined_column`, 42704 `undefined_object` (a
   *     type such as a label-type enum): the schema predates an evolution the query depends on.
   *   - 42501 `insufficient_privilege`: this city's role was never granted that schema or table.
   *
   * Connection errors (class 08), `too_many_connections` (53300), pool timeouts and cancellations are absent on
   * purpose: those are the transient failures that must fail the total instead of shrinking it.
   */
  val SchemaShapeSqlStates: Set[String] = Set("3F000", "42P01", "42703", "42704", "42501")

  /**
   * Whether `e`, or anything in its cause chain, is a SQL error from [[SchemaShapeSqlStates]].
   *
   * Walks the chain because Slick and the pool can wrap the driver's `PSQLException`.
   *
   * @param e The failure a city's query produced.
   * @return  True if the schema can't answer this query until it is migrated or granted.
   */
  def isSchemaShapeError(e: Throwable): Boolean = {
    @tailrec
    def loop(t: Throwable, depth: Int): Boolean = t match {
      case null                                                                => false
      case sql: SQLException if SchemaShapeSqlStates.contains(sql.getSQLState) => true
      case _ if depth >= 10                                                    => false // Guards a cyclic chain.
      case _                                                                   => loop(t.getCause, depth + 1)
    }
    loop(e, 0)
  }

  /**
   * Queries every city with at most `parallelism` cities in flight, retrying each transient failure once.
   *
   * @param cityIds     The cities to query, in the order their results should come back.
   * @param parallelism How many cities may be querying at once.
   * @param retryDelay  How long to wait before a city's single retry.
   * @param query       One city's query. A synchronous throw is treated like a failed Future.
   * @return            Every city's result plus the not-ready cities, or the first failure that survived its retry.
   */
  def run[A](cityIds: Seq[String], parallelism: Int, retryDelay: FiniteDuration)(query: String => Future[A])(using
      ec: ExecutionContext,
      mat: Materializer
  ): Future[FanOutResult[A]] = {
    require(parallelism > 0, s"parallelism must be positive, got $parallelism")

    // Left marks a city whose schema can't answer, so it travels through the stream as data instead of failing it.
    def queryCity(cityId: String): Future[Either[Throwable, A]] = {
      def attempt(): Future[A] = Future.delegate(query(cityId))
      attempt()
        .recoverWith {
          case e if !isSchemaShapeError(e) => after(retryDelay, mat.system.scheduler)(attempt())
        }
        .map(Right(_))
        .recover { case e if isSchemaShapeError(e) => Left(e) }
    }

    // mapAsync keeps input order and fails the stream on the first failed Future, which cancels the source: cities
    // not yet started are never queried once the total is already known to be lost.
    Source(cityIds.toVector)
      .mapAsync(parallelism)(cityId => queryCity(cityId).map(cityId -> _))
      .runWith(Sink.seq)
      .map { outcomes =>
        FanOutResult(
          results = outcomes.collect { case (cityId, Right(value)) => cityId -> value },
          notReady = outcomes.collect { case (cityId, Left(error)) => cityId -> error }
        )
      }
  }
}
