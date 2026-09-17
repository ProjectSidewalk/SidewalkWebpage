package service

import models.place.PlaceCategory
import models.utils.LatLngBBox
import org.scalatestplus.play.PlaySpec
import play.api.libs.json.{JsObject, Json}

/**
 * Unit tests for the places refresh's pure halves (#5311): the Overpass query it sends and the parsing of what comes
 * back. No application, DB, or network required; both live on the companion object.
 */
class PlacesServiceSpec extends PlaySpec {

  private val teaneck = LatLngBBox(minLat = 40.86, minLng = -74.03, maxLat = 40.92, maxLng = -73.97)

  /** An Overpass element: a node with `lat`/`lon`, or a way/relation with a `center`. */
  private def element(osmType: String, id: Long, tags: JsObject, lat: Double = 40.9, lon: Double = -74.0): JsObject = {
    val position =
      if (osmType == "node") Json.obj("lat" -> lat, "lon" -> lon)
      else Json.obj("center"                -> Json.obj("lat" -> lat, "lon" -> lon))
    Json.obj("type" -> osmType, "id" -> id, "tags" -> tags) ++ position
  }

  private def response(elements: JsObject*) = Json.obj("elements" -> elements)

  "overpassQuery" should {
    "ask for every catalog rule, as a union over the bbox, with tags and centers" in {
      val query = PlacesService.overpassQuery(teaneck)
      query must startWith(s"[out:json][timeout:${PlacesService.OverpassTimeoutSeconds}];")
      query must include("(40.86,-74.03,40.92,-73.97)")
      query must endWith("out tags center;")
      PlaceCategory.overpassSelectors.foreach(selector => query must include(s"nwr$selector"))
      // One selector per rule, so a rule that stops being sent would be visible as a missing line.
      query.linesIterator.count(_.trim.startsWith("nwr")) mustBe PlaceCategory.overpassSelectors.size
    }

    "spell a single-value rule as an equality and a multi-value rule as an anchored regex" in {
      PlaceCategory.Library.rules.head.overpassSelector mustBe "[amenity=library]"
      PlaceCategory.Grocery.rules.head.overpassSelector mustBe """[shop~"^(greengrocer|supermarket)$"]"""
    }
  }

  "parseOverpass" should {
    "take a node's own position and a way's or relation's center" in {
      val places = PlacesService.parseOverpass(
        response(
          element("node", 1L, Json.obj("amenity" -> "library", "name" -> "Teaneck Library"), lat = 40.88, lon = -74.01),
          element(
            "way",
            2L,
            Json.obj("amenity" -> "school", "name" -> "Teaneck High School"),
            lat = 40.89,
            lon = -74.02
          ),
          element("relation", 3L, Json.obj("leisure" -> "park", "name" -> "Votee Park"), lat = 40.87, lon = -74.0)
        )
      )
      places.map(p => (p.osmType, p.osmId, p.category, p.name)) mustBe Seq(
        ("node", 1L, "library", Some("Teaneck Library")),
        ("way", 2L, "school", Some("Teaneck High School")),
        ("relation", 3L, "park", Some("Votee Park"))
      )
      // JTS points are (x, y) = (lon, lat).
      places.head.geom.getX mustBe -74.01
      places.head.geom.getY mustBe 40.88
      places.head.geom.getSRID mustBe 4326
    }

    "keep the whole tag map, trim the name, and leave an unnamed or blank-named place nameless" in {
      val places = PlacesService.parseOverpass(
        response(
          element(
            "node",
            1L,
            Json.obj("highway" -> "bus_stop", "name" -> "  Cedar Ln & Teaneck Rd ", "shelter" -> "yes")
          ),
          element("node", 2L, Json.obj("highway" -> "bus_stop", "name" -> "   ")),
          element("node", 3L, Json.obj("highway" -> "bus_stop"))
        )
      )
      places.map(_.name) mustBe Seq(Some("Cedar Ln & Teaneck Rd"), None, None)
      (places.head.tags \ "shelter").as[String] mustBe "yes"
      (places.head.tags \ "name").as[String] mustBe "  Cedar Ln & Teaneck Rd "
    }

    "file an object under the first matching category in catalog order" in {
      // A school that also sells groceries is a school: School precedes Grocery in the catalog.
      val places = PlacesService.parseOverpass(
        response(element("node", 1L, Json.obj("amenity" -> "school", "shop" -> "supermarket")))
      )
      places.map(_.category) mustBe Seq("school")
      PlaceCategory.ids.indexOf("school") must be < PlaceCategory.ids.indexOf("grocery")
    }

    "match every tag the catalog lists, and only those" in {
      PlaceCategory.resolve(Map("amenity" -> "kindergarten")).map(_.id) mustBe Some("school")
      PlaceCategory.resolve(Map("amenity" -> "pharmacy")).map(_.id) mustBe Some("health")
      PlaceCategory.resolve(Map("leisure" -> "playground")).map(_.id) mustBe Some("park")
      PlaceCategory.resolve(Map("railway" -> "tram_stop")).map(_.id) mustBe Some("transit")
      PlaceCategory.resolve(Map("amenity" -> "social_facility")).map(_.id) mustBe Some("community")
      PlaceCategory.resolve(Map("shop" -> "convenience")) mustBe None
      PlaceCategory.resolve(Map("amenity" -> "cafe")) mustBe None
      PlaceCategory.resolve(Map.empty) mustBe None
    }

    "skip an element with no position, no tags, or tags outside the catalog" in {
      val noPosition = Json.obj("type" -> "relation", "id" -> 9L, "tags" -> Json.obj("amenity" -> "school"))
      val noTags     = Json.obj("type" -> "node", "id" -> 10L, "lat" -> 40.9, "lon" -> -74.0)
      val places     = PlacesService.parseOverpass(
        response(noPosition, noTags, element("node", 11L, Json.obj("amenity" -> "cafe")))
      )
      places mustBe empty
    }

    "read an empty or malformed response as no places" in {
      PlacesService.parseOverpass(Json.obj()) mustBe empty
      PlacesService.parseOverpass(Json.obj("elements" -> "nope")) mustBe empty
    }
  }

  "the catalog" should {
    "publish the same ids it allowlists, with no duplicates" in {
      PlaceCategory.ids.toSet mustBe PlaceCategory.idSet
      PlaceCategory.ids.distinct mustBe PlaceCategory.ids
      PlaceCategory.ids.foreach(id => PlaceCategory.byId(id).map(_.id) mustBe Some(id))
    }
  }
}
