package models.utils

import org.scalatestplus.play.PlaySpec

/**
 * Unit tests for the pure `LatLngBBox.fromString` parser (the "minLng,minLat,maxLng,maxLat" v3 bbox convention),
 * used by the LabelMap's viewport-scoped feed (#5002). No DI or DB.
 */
class LatLngBBoxSpec extends PlaySpec {

  "LatLngBBox.fromString" should {
    "parse a well-formed bbox in minLng,minLat,maxLng,maxLat order" in {
      LatLngBBox.fromString("-122.45,47.5,-122.25,47.7") mustBe
        Some(LatLngBBox(minLat = 47.5, minLng = -122.45, maxLat = 47.7, maxLng = -122.25))
    }

    "tolerate whitespace around the values" in {
      LatLngBBox.fromString(" -1.0 , -2.0 , 1.0 , 2.0 ") mustBe
        Some(LatLngBBox(minLat = -2.0, minLng = -1.0, maxLat = 2.0, maxLng = 1.0))
    }

    "normalize inverted corners instead of failing the class invariant" in {
      LatLngBBox.fromString("1.0,2.0,-1.0,-2.0") mustBe
        Some(LatLngBBox(minLat = -2.0, minLng = -1.0, maxLat = 2.0, maxLng = 1.0))
    }

    "reject the wrong number of values" in {
      LatLngBBox.fromString("") mustBe None
      LatLngBBox.fromString("1,2,3") mustBe None
      LatLngBBox.fromString("1,2,3,4,5") mustBe None
      // A trailing comma is a fifth (empty) field, not ignorable whitespace.
      LatLngBBox.fromString("1,2,3,4,") mustBe None
    }

    "reject non-numeric values" in {
      LatLngBBox.fromString("a,b,c,d") mustBe None
      LatLngBBox.fromString("1,2,3,4x") mustBe None
    }

    "reject non-finite values, which would slip past the ordering checks" in {
      LatLngBBox.fromString("1,2,3,NaN") mustBe None
      LatLngBBox.fromString("1,2,Infinity,4") mustBe None
    }
  }
}
