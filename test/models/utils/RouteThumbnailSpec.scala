package models.utils

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/**
 * Pure unit test for the static-map URL behind route thumbnails: the path is drawn first, the start and end pins
 * sit on top of it in walking order, and a route with no geometry gets no thumbnail at all.
 */
class RouteThumbnailSpec extends AnyFunSuite with Matchers {

  private val endpoints = RouteThumbnail.Endpoints(start = (-74.0123456, 40.9), end = (-74.0, 40.95))

  test("draws the path, then the start and end pins on top, in that order") {
    val url = RouteThumbnail.url("_p~iF~ps|U", Some(endpoints), "token")

    val path  = url.indexOf("path-4+3E8BD9-0.9(")
    val start = url.indexOf("pin-s+11C961(-74.012346,40.900000)")
    val end   = url.indexOf("pin-s+ED1C24(-74.000000,40.950000)")
    path should be > -1
    start should be > path
    end should be > start
    url should endWith("access_token=token")
  }

  test("draws the path alone when the endpoints are unknown") {
    val url = RouteThumbnail.url("_p~iF~ps|U", None, "token")
    url should include("path-4+3E8BD9-0.9(")
    url should not include "pin-s"
  }

  test("a route with no geometry has no thumbnail") {
    RouteThumbnail.url("", Some(endpoints), "token") shouldBe ""
  }
}
