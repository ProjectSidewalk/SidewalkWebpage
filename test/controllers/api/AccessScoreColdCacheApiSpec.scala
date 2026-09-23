package controllers.api

import models.api.ApiError
import models.utils.IpAddress
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.stream.Materializer
import org.scalatest.Assertion
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.cache.AsyncCacheApi
import play.api.inject.bind
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._
import service.{LoggingService, SwrCache}

import java.time.OffsetDateTime
import java.util.concurrent.ConcurrentLinkedQueue
import javax.inject.{Inject, Singleton}
import scala.concurrent.duration.FiniteDuration
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters._
import scala.reflect.ClassTag

/**
 * A [[SwrCache]] whose cold path never resolves in time, so every full-city AccessScore read is a miss the compute
 * did not beat. The compute itself is never started, and the hit path is left alone so the rest of the app's caches
 * behave normally.
 */
@Singleton
class ColdSwrCache @Inject() (cacheApi: AsyncCacheApi, actorSystem: ActorSystem)(implicit ec: ExecutionContext)
    extends SwrCache(cacheApi, actorSystem) {

  override def staleWhileRevalidateWithin[T: ClassTag](
      key: String,
      freshFor: FiniteDuration,
      maxAge: FiniteDuration,
      coldWait: FiniteDuration
  )(compute: => Future[T]): Future[Option[T]] = Future.successful(None)
}

/**
 * The HTTP contract of a full-city AccessScore request whose cache is cold and whose computation has outlasted the
 * request's own deadline (#5418): `503`, `Retry-After`, an RFC 7807 body with the `STILL_COMPUTING` code, on every
 * output format, and a `webpage_activity` row like any other request. The AccessScore tool retries on exactly these,
 * so dropping the header or answering 500 on one endpoint would silently degrade it to blind backoff.
 *
 * The cache is replaced by one that always reports the deadline passed, so no computation runs and the assertions
 * hold regardless of how fast the connected database is. The activity log is captured in memory rather than read
 * back from the table, since the routes are `UserAwareAction` and an anonymous request has no user row to key on.
 */
class AccessScoreColdCacheApiSpec extends PlaySpec with GuiceOneAppPerSuite {

  /** Every activity string the app tried to log, in order. */
  private val logged = new ConcurrentLinkedQueue[String]()

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .overrides(
        bind[SwrCache].to[ColdSwrCache],
        bind[LoggingService].toInstance(new LoggingService {
          private def record(activity: String): Future[Int] = { logged.add(activity); Future.successful(1) }
          def insert(userId: String, ipAddress: IpAddress, activity: String, timestamp: OffsetDateTime): Future[Int] =
            record(activity)
          def insert(userId: String, ipAddress: IpAddress, activity: String): Future[Int]         = record(activity)
          def insert(userId: Option[String], ipAddress: IpAddress, activity: String): Future[Int] = record(activity)
          def insert(userId: Option[String], ipAddress: IpAddress, activity: String, timestamp: OffsetDateTime)
              : Future[Int] = record(activity)
        })
      )
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private val fullCityPaths = Seq(
    "/v3/api/accessScoreStreets",
    "/v3/api/accessScoreIntersections",
    "/v3/api/accessScoreRegions"
  )

  /** The whole still-computing contract for one request, in one place so every route is held to the same one. */
  private def mustBeStillComputing(uri: String): Assertion = {
    val resp = route(app, FakeRequest(GET, uri)).get
    withClue(s"$uri: ") {
      status(resp) mustBe SERVICE_UNAVAILABLE
      header(RETRY_AFTER, resp) mustBe Some(AccessScoreApiController.StillComputingRetryAfterSeconds.toString)
      contentType(resp) mustBe Some(ApiError.ContentType)
      val json = contentAsJson(resp)
      (json \ "code").as[String] mustBe "STILL_COMPUTING"
      (json \ "status").as[Int] mustBe SERVICE_UNAVAILABLE
      (json \ "detail").as[String] must include("Retry-After")
    }
  }

  "a full-city AccessScore request on a cold cache" should {
    "answer 503 with Retry-After and a STILL_COMPUTING problem body on every endpoint" in {
      fullCityPaths.foreach(mustBeStillComputing)
    }

    "answer the same 503 for the non-GeoJSON formats, since the check precedes the format switch" in {
      fullCityPaths.foreach(path => mustBeStillComputing(s"$path?filetype=csv"))
      mustBeStillComputing("/v3/api/accessScoreStreets?filetype=shapefile")
      mustBeStillComputing("/v3/api/accessScoreRegions?filetype=geopackage")
    }

    "log the request like any other, so a reported 503 can be found in webpage_activity" in {
      val before = logged.size()
      fullCityPaths.foreach(mustBeStillComputing)
      val added = logged.asScala.toSeq.drop(before)
      fullCityPaths.foreach { path =>
        withClue(s"no activity row for $path: ") { added.exists(_.contains(path)) mustBe true }
      }
    }

    "leave a filtered request on the live path, which never waits on the cache" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/accessScoreStreets?bbox=0,0,0.001,0.001")).get
      status(resp) mustBe OK
      (contentAsJson(resp) \ "type").as[String] mustBe "FeatureCollection"
    }
  }
}
