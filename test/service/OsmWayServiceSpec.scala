package service

import org.scalatestplus.play.PlaySpec
import play.api.libs.json.{JsObject, JsValue, Json}

import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}

/**
 * Unit tests for OsmWayService's pure response parsing, chunk splitting, and nearest-road selection (#4654). No
 * application, DB, or network required — the functions under test live on the companion object and take parsed JSON
 * or a fake fetch.
 */
class OsmWayServiceSpec extends PlaySpec {
  implicit private val ec: ExecutionContext = ExecutionContext.global

  /** Builds an OSM API multi-fetch response element for a live way. */
  private def wayWithTags(id: Long, tags: JsObject): JsObject = {
    Json.obj("type" -> "way", "id" -> id, "version" -> 3, "tags" -> tags)
  }

  /** Builds an Overpass `out geom;` response element for a way along the given (lat, lon) points. */
  private def wayWithGeom(id: Long, highway: String, points: Seq[(Double, Double)], maxspeed: Option[String] = None) = {
    Json.obj(
      "type" -> "way",
      "id"   -> id,
      "tags" -> (Json.obj("highway" -> highway) ++ maxspeed
        .map(ms => Json.obj("maxspeed" -> ms))
        .getOrElse(
          Json.obj()
        )),
      "geometry" -> points.map { case (lat, lon) => Json.obj("lat" -> lat, "lon" -> lon) }
    )
  }

  "parseWaysResponse" should {
    "map live way ids to their full tag maps" in {
      val json: JsValue = Json.obj(
        "elements" -> Json.arr(
          wayWithTags(1L, Json.obj("maxspeed" -> "25 mph", "name" -> "Main St", "sidewalk" -> "both")),
          wayWithTags(2L, Json.obj("highway" -> "residential"))
        )
      )
      val parsed = OsmWayService.parseWaysResponse(json)
      parsed.keySet mustBe Set(1L, 2L)
      (parsed(1L) \ "maxspeed").as[String] mustBe "25 mph"
      (parsed(1L) \ "name").as[String] mustBe "Main St"
      (parsed(1L) \ "sidewalk").as[String] mustBe "both"
      (parsed(2L) \ "maxspeed").asOpt[String] mustBe None
    }

    "leave out a deleted way, which the API returns with visible false and no tags" in {
      val json: JsValue = Json.obj(
        "elements" -> Json.arr(
          wayWithTags(1L, Json.obj("highway" -> "primary")),
          Json.obj("type" -> "way", "id" -> 116721547L, "version" -> 19, "visible" -> false)
        )
      )
      OsmWayService.parseWaysResponse(json).keySet mustBe Set(1L)
    }

    "return an empty tag map for a live way with no tags field" in {
      val json: JsValue = Json.obj("elements" -> Json.arr(Json.obj("type" -> "way", "id" -> 5L, "version" -> 1)))
      OsmWayService.parseWaysResponse(json) mustBe Map(5L -> Json.obj())
    }

    "ignore non-way elements and tolerate an empty or missing elements array" in {
      val json: JsValue = Json.obj("elements" -> Json.arr(Json.obj("type" -> "node", "id" -> 9L)))
      OsmWayService.parseWaysResponse(json) mustBe Map.empty
      OsmWayService.parseWaysResponse(Json.obj("elements" -> Json.arr())) mustBe Map.empty
      OsmWayService.parseWaysResponse(Json.obj()) mustBe Map.empty
    }
  }

  "fetchSplittingOnNotFound" should {
    val tags = Json.obj("highway" -> "residential")

    /**
     * A fake multi-fetch that 404s (None) any request naming a never-existing id, answering the rest with `tags`, and
     * records every request it gets.
     */
    class FakeApi(neverExisted: Set[Long]) {
      var requests: List[Seq[Long]]                                  = Nil
      def fetch(ids: Seq[Long]): Future[Option[Map[Long, JsObject]]] = {
        requests = requests :+ ids
        Future.successful(if (ids.exists(neverExisted)) None else Some(ids.map(_ -> tags).toMap))
      }
    }

    def fetchAll(ids: Seq[Long], api: FakeApi): Map[Long, JsObject] =
      Await.result(OsmWayService.fetchSplittingOnNotFound(ids)(api.fetch), 5.seconds)

    "fetch a chunk with no bad id in one request" in {
      val api = new FakeApi(Set.empty)
      fetchAll(1L to 8L, api).keySet mustBe (1L to 8L).toSet
      api.requests mustBe List(1L to 8L)
    }

    "narrow a 404 down to the one bad id, keeping every other id, in a bisection rather than one request per id" in {
      val api = new FakeApi(Set(6L))
      fetchAll(1L to 8L, api).keySet mustBe Set(1L, 2L, 3L, 4L, 5L, 7L, 8L)
      // 1-8 → 1-4 (ok), 5-8 → 5-6 → 5 (ok), 6 (404); then 7-8 (ok).
      api.requests mustBe List(1L to 8L, 1L to 4L, 5L to 8L, 5L to 6L, Seq(5L), Seq(6L), 7L to 8L)
    }

    "return nothing for a chunk that is all bad ids" in {
      val api = new FakeApi(Set(1L, 2L))
      fetchAll(Seq(1L, 2L), api) mustBe Map.empty
      api.requests mustBe List(Seq(1L, 2L), Seq(1L), Seq(2L))
    }

    "propagate a failed request rather than treating it as a 404" in {
      val boom                                                      = new RuntimeException("503")
      val failing: Seq[Long] => Future[Option[Map[Long, JsObject]]] = _ => Future.failed(boom)
      the[RuntimeException] thrownBy
        Await.result(OsmWayService.fetchSplittingOnNotFound(Seq(1L, 2L))(failing), 5.seconds) mustBe boom
    }
  }

  "lastVisibleTags" should {

    /** One version of a way in an OSM API history document; `tags = None` with `visible = false` is a deletion. */
    def version(n: Long, tags: Option[JsObject], visible: Boolean = true): JsObject = {
      Json.obj("type" -> "way", "id" -> 116721547L, "version" -> n) ++
        (if (visible) Json.obj() else Json.obj("visible" -> false)) ++
        tags.map(t => Json.obj("tags" -> t)).getOrElse(Json.obj())
    }
    def history(versions: JsObject*): JsValue = Json.obj("elements" -> versions)

    val bridgeV17 = Json.obj("highway" -> "trunk", "bridge" -> "yes", "layer" -> "1", "maxspeed" -> "40 mph")
    val bridgeV18 = bridgeV17 ++ Json.obj("parking:lane:both" -> "no_stopping")

    "take the last visible version's tags of a deleted way" in {
      val aurora = history(version(17, Some(bridgeV17)), version(18, Some(bridgeV18)), version(19, None, false))
      OsmWayService.lastVisibleTags(aurora) mustBe Some(bridgeV18)
    }

    "prefer the last version that was still a road over a later one retagged out of the network" in {
      val retagged = history(
        version(3, Some(bridgeV18)),
        version(4, Some(Json.obj("landuse" -> "construction"))),
        version(5, None, false)
      )
      OsmWayService.lastVisibleTags(retagged) mustBe Some(bridgeV18)
    }

    "fall back to the last tagged version when no version carried highway" in {
      val noRoad = history(version(1, Some(Json.obj("name" -> "Old"))), version(2, Some(Json.obj("name" -> "New"))))
      OsmWayService.lastVisibleTags(noRoad) mustBe Some(Json.obj("name" -> "New"))
    }

    "order by version number, not document order" in {
      val shuffled = history(version(18, Some(bridgeV18)), version(17, Some(bridgeV17)))
      OsmWayService.lastVisibleTags(shuffled) mustBe Some(bridgeV18)
    }

    "skip versions with no tags and return None when nothing is left" in {
      OsmWayService.lastVisibleTags(history(version(1, Some(Json.obj())), version(2, None, false))) mustBe None
      OsmWayService.lastVisibleTags(history(version(1, None))) mustBe None
      OsmWayService.lastVisibleTags(Json.obj("elements" -> Json.arr())) mustBe None
      OsmWayService.lastVisibleTags(Json.obj()) mustBe None
    }
  }

  "maxspeedFrom" should {
    "extract the raw maxspeed value" in {
      OsmWayService.maxspeedFrom(Json.obj("maxspeed" -> "30")) mustBe Some("30")
      OsmWayService.maxspeedFrom(Json.obj("maxspeed" -> "25 mph")) mustBe Some("25 mph")
    }

    "return None when the tag is absent" in {
      OsmWayService.maxspeedFrom(Json.obj("highway" -> "residential")) mustBe None
      OsmWayService.maxspeedFrom(Json.obj()) mustBe None
    }
  }

  "pickNearestRoad" should {
    // Query point; candidate ways run north-south at small longitude offsets from it.
    val lat = 47.6062
    val lng = -122.3321

    "pick the nearest qualifying road" in {
      val json: JsValue = Json.obj(
        "elements" -> Json.arr(
          wayWithGeom(1L, "residential", Seq((lat - 0.001, lng + 0.0002), (lat + 0.001, lng + 0.0002)), Some("25 mph")),
          wayWithGeom(2L, "primary", Seq((lat - 0.001, lng + 0.0001), (lat + 0.001, lng + 0.0001)), Some("35 mph"))
        )
      )
      val result = OsmWayService.pickNearestRoad(json, lat, lng)
      result.map(_._1) mustBe Some(2L)
      result.flatMap(r => OsmWayService.maxspeedFrom(r._2)) mustBe Some("35 mph")
    }

    "exclude non-road highway types like footways" in {
      val json: JsValue = Json.obj(
        "elements" -> Json.arr(
          // The footway is closer, but only drivable road types qualify.
          wayWithGeom(1L, "footway", Seq((lat - 0.001, lng), (lat + 0.001, lng))),
          wayWithGeom(2L, "residential", Seq((lat - 0.001, lng + 0.0005), (lat + 0.001, lng + 0.0005)))
        )
      )
      OsmWayService.pickNearestRoad(json, lat, lng).map(_._1) mustBe Some(2L)
    }

    "build the returned geometry as (lng, lat) coordinates" in {
      val json: JsValue = Json.obj(
        "elements" -> Json.arr(wayWithGeom(1L, "residential", Seq((lat - 0.001, lng), (lat + 0.001, lng))))
      )
      val geom = OsmWayService.pickNearestRoad(json, lat, lng).get._3
      geom.getCoordinateN(0).getX mustBe lng
      geom.getCoordinateN(0).getY mustBe (lat - 0.001)
    }

    "return None when no qualifying road is in the response" in {
      OsmWayService.pickNearestRoad(Json.obj("elements" -> Json.arr()), lat, lng) mustBe None
      val onlyFootway: JsValue = Json.obj(
        "elements" -> Json.arr(wayWithGeom(1L, "footway", Seq((lat - 0.001, lng), (lat + 0.001, lng))))
      )
      OsmWayService.pickNearestRoad(onlyFootway, lat, lng) mustBe None
    }

    "ignore a way with fewer than two geometry points" in {
      val json: JsValue = Json.obj(
        "elements" -> Json.arr(wayWithGeom(1L, "residential", Seq((lat, lng))))
      )
      OsmWayService.pickNearestRoad(json, lat, lng) mustBe None
    }
  }
}
