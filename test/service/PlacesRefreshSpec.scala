package service

import models.place.PlaceTable
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.stream.Materializer
import org.scalatest.OptionValues
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.cache.AsyncCacheApi
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsValue, Json}
import play.api.libs.ws.WSClient
import play.api.mvc.Results
import play.api.routing.sird._
import play.api.{Application, Configuration}
import play.core.server.Server

import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}

/**
 * The places refresh end to end against a stand-in Overpass (#5311): what it asks, what it refuses, and what it keeps.
 * A refresh commits, so the cases that could merge are gated on a schema with no OSM places (CI's), and the ones
 * that must not merge — a remark, an empty answer — assert on a committed row they seed and delete themselves.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI); the
 * scheduling actors are disabled.
 */
class PlacesRefreshSpec extends PlaySpec with GuiceOneAppPerSuite with OptionValues {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val ec: ExecutionContext = app.injector.instanceOf[ExecutionContext]
  implicit lazy val mat: Materializer    = app.materializer

  private lazy val dbConfig   = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private lazy val placeTable = app.injector.instanceOf[PlaceTable]

  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)
  private def await[T](f: Future[T]): T  = Await.result(f, 60.seconds)

  /** An OSM id no real fetch will ever answer with, so a seeded row is unmistakably this spec's. */
  private val SpecOsmId = 9_000_000_001L

  /**
   * Runs `body` against a service whose Overpass is a local server answering every query with `answer`, counting
   * the queries it saw. Retries are near-instant so the failing cases finish in milliseconds rather than minutes.
   */
  private def withOverpass[T](answer: JsValue)(body: (PlacesService, AtomicInteger) => T): T = {
    val queries = new AtomicInteger(0)
    Server.withRouterFromComponents() { components =>
      { case POST(p"/api/interpreter") =>
        components.defaultActionBuilder { _ =>
          queries.incrementAndGet()
          Results.Ok(answer)
        }
      }
    } { port =>
      val service = new PlacesServiceImpl(
        app.injector.instanceOf[DatabaseConfigProvider],
        app.injector.instanceOf[WSClient],
        app.injector.instanceOf[AsyncCacheApi],
        app.injector.instanceOf[SwrCache],
        app.injector.instanceOf[ActorSystem],
        app.injector.instanceOf[ApiService],
        placeTable,
        Configuration(
          "places.overpass.url"         -> s"http://localhost:${port.value}/api/interpreter",
          "places.overpass.retry-delay" -> "10ms"
        )
      )
      body(service, queries)
    }
  }

  /** A committed OSM place, fetched `daysAgo` days ago, deleted after `body` whatever happens. */
  private def withSeededOsmPlace[T](daysAgo: Int)(body: Int => T): T = {
    val placeId = run(sql"""INSERT INTO place (category, name, source, osm_type, osm_id, tags, geom, fetched_at)
                            VALUES ('school', 'Spec School', 'osm', 'node', $SpecOsmId, '{}',
                                    ST_SetSRID(ST_MakePoint(0, 0), 4326), now() - make_interval(days => $daysAgo))
                            RETURNING place_id""".as[Int].head)
    try body(placeId)
    finally {
      val _ = run(sqlu"DELETE FROM place WHERE place_id = $placeId")
    }
  }

  private def osmPlaceExists(placeId: Int): Boolean =
    run(sql"SELECT COUNT(*) FROM place WHERE place_id = $placeId".as[Int].head) == 1

  private def node(id: Long, lat: Double, lon: Double, tags: (String, String)*): JsValue =
    Json.obj("type" -> "node", "id" -> id, "lat" -> lat, "lon" -> lon, "tags" -> Json.toJson(tags.toMap))

  /** Somewhere the merge keeps: inside a live region, where the padded extent the query asks for must reach. */
  private lazy val liveRegionCentroid: Option[(Double, Double)] =
    run(sql"""SELECT ST_Y(ST_Centroid(geom)), ST_X(ST_Centroid(geom)) FROM region
              WHERE NOT deleted ORDER BY region_id LIMIT 1""".as[(Double, Double)].headOption)

  /** A fetch only happens for a city with regions; without one the tick is a logged skip, not the case under test. */
  private def assumeRegion(): Unit = {
    val _ = assume(liveRegionCentroid.isDefined, "no live region in the connected schema, so nothing would be fetched")
  }

  "PlacesService.refresh" should {
    "ask Overpass nothing on the nightly tick while the table is fresh" in withSeededOsmPlace(daysAgo = 1) { _ =>
      withOverpass(Json.obj("elements" -> Json.arr())) { (service, queries) =>
        val result = await(service.refresh(force = false))
        result.skipped mustBe true
        result.fetched mustBe 0
        result.fetchedAt mustBe defined
        queries.get mustBe 0
      }
    }

    "fail on a 200 that carries a remark, after retrying, and keep every row" in withSeededOsmPlace(daysAgo = 30) {
      placeId =>
        assumeRegion()
        val partial = Json.obj(
          "elements" -> Json.arr(node(SpecOsmId + 1, 0.0, 0.0, "amenity" -> "school")),
          "remark"   -> "runtime error: Query timed out in \"query\" at line 3 after 180 seconds."
        )
        withOverpass(partial) { (service, queries) =>
          val failure = intercept[RuntimeException](await(service.refresh(force = true)))
          failure.getMessage must include("remark")
          queries.get mustBe PlacesService.MaxAttempts
          osmPlaceExists(placeId) mustBe true
        }
    }

    "refuse an empty answer for a city that has places, and keep them" in withSeededOsmPlace(daysAgo = 30) { placeId =>
      assumeRegion()
      withOverpass(Json.obj("elements" -> Json.arr())) { (service, queries) =>
        val failure = intercept[RuntimeException](await(service.refresh(force = true)))
        failure.getMessage must include("keeping them")
        // Not a transport failure: the answer arrived whole, so there is nothing to retry.
        queries.get mustBe 1
        osmPlaceExists(placeId) mustBe true
      }
    }

    "run again after a failed refresh rather than staying marked as running" in withSeededOsmPlace(daysAgo = 30) { _ =>
      assumeRegion()
      withOverpass(Json.obj("elements" -> Json.arr())) { (service, _) =>
        intercept[RuntimeException](await(service.refresh(force = true)))
        service.isRunning mustBe false
      }
    }

    "merge a good answer over the regions' extent and drop the cached full-city list" in {
      val existing = run(placeTable.osmPlaceCount)
      assume(existing == 0, s"the connected schema holds $existing OSM places, which a committed merge would replace")
      assumeRegion()
      val (lat, lon) = liveRegionCentroid.get

      val answer = Json.obj("elements" -> Json.arr(node(SpecOsmId, lat, lon, "amenity" -> "school", "name" -> "Spec")))
      withOverpass(answer) { (service, queries) =>
        try {
          await(service.getFullCityPlaces(batchSize = 100)) mustBe empty
          val result = await(service.refresh(force = true))
          result.skipped mustBe false
          result.fetched mustBe 1
          result.inserted mustBe 1
          result.total mustBe 1
          queries.get mustBe 1
          // The cached whole-city list was last week's; the refresh cleared it, so the tool's next download is fresh.
          await(service.getFullCityPlaces(batchSize = 100)).map(_.osmId) mustBe Seq(Some(SpecOsmId))
        } finally {
          val _ = run(sqlu"DELETE FROM place WHERE source = 'osm' AND osm_id = $SpecOsmId")
          val _ = await(app.injector.instanceOf[AsyncCacheApi].remove(PlacesService.FullCityCacheKey))
        }
      }
    }
  }
}
