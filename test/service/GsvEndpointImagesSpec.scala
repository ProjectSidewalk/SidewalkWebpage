package service

import models.pano.{PanoDataTable, PanoHistoryTable, PanoImageryChangeTable}
import models.street.StreetEdgeTable
import models.utils.CommonUtils
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api.*
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.cache.AsyncCacheApi
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.ws.WSClient
import play.api.{Application, Configuration, Environment}
import service.PanoDataService.GsvMetadataAnswer
import slick.jdbc.GetResult
import util.SidewalkSpec

import scala.collection.mutable
import scala.concurrent.duration.*
import scala.concurrent.{Await, ExecutionContext, Future}

/**
 * The AI scene-analysis endpoint images only ever show a pano verified near the street (#5464).
 *
 * Google's `radius` is a hint, not a bound (#5114): a location-based Static request can return a picture from
 * another state, with nothing in the image to tell. So each endpoint is looked up through metadata, checked against
 * the radius, and requested by pano id. The metadata call is stubbed here, so no request reaches Google; the street
 * geometry and directions come from the real database.
 */
class GsvEndpointImagesSpec extends SidewalkSpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private def await[T](f: Future[T]): T = Await.result(f, 60.seconds)

  /** A street with a direction at both ends, and those two endpoints as (lat, lng). */
  private case class TestStreet(id: Int, start: (Double, Double), end: (Double, Double))

  private lazy val street: TestStreet = {
    val dbConfig                = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
    given GetResult[TestStreet] = { r =>
      TestStreet(r.nextInt(), (r.nextDouble(), r.nextDouble()), (r.nextDouble(), r.nextDouble()))
    }
    // Open, as getStreet reads only those, and long enough that both endpoint directions are defined.
    val query = sql"""
      SELECT street_edge_id, ST_Y(ST_StartPoint(geom)), ST_X(ST_StartPoint(geom)),
             ST_Y(ST_EndPoint(geom)), ST_X(ST_EndPoint(geom))
      FROM street_edge
      WHERE status = 'open' AND ST_Length(geom::geography) > 20
      ORDER BY street_edge_id
      LIMIT 1""".as[TestStreet]
    await(dbConfig.db.run(query)).headOption.getOrElse(cancel("The test database has no streets."))
  }

  /** A pano `meters` due north of a point. */
  private def panoNear(id: String, point: (Double, Double), meters: Double): GsvMetadataAnswer = {
    val (lat, lng) = CommonUtils.calculateDestination(point._1, point._2, meters / 1000.0, 0.0)
    GsvMetadataAnswer.Pano(id, Some((lat, lng)), Some("2024-06"))
  }

  /** The #5114 Syracuse photosphere, as Google once returned it for a 25 m search in Seattle. */
  private val syracuse = GsvMetadataAnswer.Pano("syracuse", Some((43.0917906, -76.1720131)), Some("2014-05"))

  /**
   * The real service with only the metadata call replaced: `answers` scripts the reply per queried endpoint, and
   * `asked` records every (lat, lng, radius) the service sent.
   */
  private class StubbedPanoDataService(answers: ((Double, Double)) => GsvMetadataAnswer)
      extends PanoDataServiceImpl(
        app.injector.instanceOf[DatabaseConfigProvider],
        app.injector.instanceOf[Configuration],
        app.injector.instanceOf[Environment],
        app.injector.instanceOf[AsyncCacheApi],
        app.injector.instanceOf[WSClient],
        app.injector.instanceOf[PanoDataTable],
        app.injector.instanceOf[PanoHistoryTable],
        app.injector.instanceOf[PanoImageryChangeTable],
        app.injector.instanceOf[StreetEdgeTable],
        app.injector.instanceOf[ImageSigningService]
      )(using app.injector.instanceOf[ExecutionContext], app.injector.instanceOf[Materializer]) {
    val asked: mutable.Buffer[(Double, Double, Int)] = mutable.Buffer.empty

    override def queryGsvMetadata(lat: Double, lng: Double, radiusM: Int): Future[GsvMetadataAnswer] = synchronized {
      asked += ((lat, lng, radiusM))
      Future.successful(answers((lat, lng)))
    }
  }

  private def answerFor(atStart: GsvMetadataAnswer, atEnd: GsvMetadataAnswer)(p: (Double, Double)) =
    if (p == street.start) atStart else if (p == street.end) atEnd else fail(s"Queried an unexpected point $p")

  "getGsvImageUrlsForStreet" should {
    "keep the endpoint whose pano is near, drop the one Google answered from another state, and use pano ids" in {
      val service = StubbedPanoDataService(answerFor(panoNear("near", street.start, 10), syracuse))
      val urls    = await(service.getGsvImageUrlsForStreet(street.id))

      urls must have size 1
      urls.head must include("pano=near&")
      urls.head must include("&signature=")
      urls.head must not include "location="
      urls.head must not include "radius="
      service.asked.map(a => (a._1, a._2)).toSet mustBe Set(street.start, street.end)
      service.asked.map(_._3).toSet mustBe Set(25)
    }

    "return nothing, so Gemini is never called, when both endpoints answer from far away" in {
      val service = StubbedPanoDataService(answerFor(syracuse, panoNear("alley", street.end, 77)))
      await(service.getGsvImageUrlsForStreet(street.id)) mustBe empty
    }

    "drop an endpoint with no imagery and one whose answer was inconclusive" in {
      val service =
        StubbedPanoDataService(answerFor(GsvMetadataAnswer.NoImagery, GsvMetadataAnswer.Inconclusive("timeout")))
      await(service.getGsvImageUrlsForStreet(street.id)) mustBe empty
    }

    "drop a pano that Google could not place, even right at the endpoint" in {
      val unplaced = GsvMetadataAnswer.Pano("unplaced", None, Some("2024-06"))
      val service  = StubbedPanoDataService(answerFor(unplaced, unplaced))
      await(service.getGsvImageUrlsForStreet(street.id)) mustBe empty
    }

    "return both images in start, end order when both panos are near" in {
      val service = StubbedPanoDataService(answerFor(panoNear("a", street.start, 3), panoNear("b", street.end, 20)))
      val urls    = await(service.getGsvImageUrlsForStreet(street.id))
      urls must have size 2
      urls(0) must include("pano=a&")
      urls(1) must include("pano=b&")
    }

    "keep a pano at the edge of the radius" in {
      // calculateDestination and haversine agree to well under a millimeter at this range; 24.999 m keeps float noise
      // from deciding a test about the inclusive edge, which PanoDataServiceSpec pins exactly.
      val service = StubbedPanoDataService(answerFor(panoNear("edge", street.start, 24.999), syracuse))
      await(service.getGsvImageUrlsForStreet(street.id)).map(_.contains("pano=edge&")) mustBe Seq(true)
    }

    "return nothing for a street that doesn't exist, without querying Google" in {
      val service = StubbedPanoDataService(_ => fail("No metadata call should be made for a missing street"))
      await(service.getGsvImageUrlsForStreet(-1)) mustBe empty
      service.asked mustBe empty
    }
  }
}
