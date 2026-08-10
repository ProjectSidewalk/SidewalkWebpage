package service

import org.scalatestplus.play.PlaySpec
import play.api.libs.json.{JsObject, JsValue, Json}

/**
 * Unit tests for OsmWayService's pure Overpass-response parsing and nearest-road selection (#4654). No application,
 * DB, or network required — the functions under test live on the companion object and take parsed JSON.
 */
class OsmWayServiceSpec extends PlaySpec {

  /** Builds an Overpass `out tags;` batch response element for a way. */
  private def wayWithTags(id: Long, tags: JsObject): JsObject = {
    Json.obj("type" -> "way", "id" -> id, "tags" -> tags)
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

  "parseBatchResponse" should {
    "map way ids to their full tag maps" in {
      val json: JsValue = Json.obj(
        "elements" -> Json.arr(
          wayWithTags(1L, Json.obj("maxspeed" -> "25 mph", "name" -> "Main St", "sidewalk" -> "both")),
          wayWithTags(2L, Json.obj("highway" -> "residential"))
        )
      )
      val parsed = OsmWayService.parseBatchResponse(json)
      parsed.keySet mustBe Set(1L, 2L)
      (parsed(1L) \ "maxspeed").as[String] mustBe "25 mph"
      (parsed(1L) \ "name").as[String] mustBe "Main St"
      (parsed(1L) \ "sidewalk").as[String] mustBe "both"
      (parsed(2L) \ "maxspeed").asOpt[String] mustBe None
    }

    "return an empty tag map for a way with no tags field" in {
      val json: JsValue = Json.obj("elements" -> Json.arr(Json.obj("type" -> "way", "id" -> 5L)))
      OsmWayService.parseBatchResponse(json) mustBe Map(5L -> Json.obj())
    }

    "ignore non-way elements and tolerate an empty or missing elements array" in {
      val json: JsValue = Json.obj("elements" -> Json.arr(Json.obj("type" -> "node", "id" -> 9L)))
      OsmWayService.parseBatchResponse(json) mustBe Map.empty
      OsmWayService.parseBatchResponse(Json.obj("elements" -> Json.arr())) mustBe Map.empty
      OsmWayService.parseBatchResponse(Json.obj()) mustBe Map.empty
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
