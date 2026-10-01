package models.utils

import models.utils.MyPostgresProfile.api.given
import org.locationtech.jts.geom.{Coordinate, GeometryFactory, Polygon}
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import play.api.libs.json.{Json, Writes}

/** Pins the GeoJSON our API returns for each geometry type, since outside consumers parse it. */
class GeoJsonWritesSpec extends AnyFunSuite with Matchers {
  private val factory                                           = GeometryFactory()
  private def check[A: Writes](geom: A, expected: String): Unit = Json.stringify(Json.toJson(geom)) shouldBe expected
  private def ring(coords: (Double, Double)*)                   = coords.map((x, y) => Coordinate(x, y)).toArray
  private def polygon(shell: Array[Coordinate], holes: Array[Coordinate]*): Polygon =
    factory.createPolygon(factory.createLinearRing(shell), holes.map(factory.createLinearRing).toArray)

  test("a point is written as [lng, lat]") {
    check(factory.createPoint(Coordinate(-122.3321, 47.6062)), """{"type":"Point","coordinates":[-122.3321,47.6062]}""")
  }

  test("a line string lists its positions in order") {
    check(
      factory.createLineString(ring((-122.5, 47.25), (-122.25, 47.5), (-122.125, 47.75))),
      """{"type":"LineString","coordinates":[[-122.5,47.25],[-122.25,47.5],[-122.125,47.75]]}"""
    )
  }

  test("a multipolygon writes each polygon's outline first, then its holes") {
    val withHole = polygon(ring((0, 0), (4, 0), (4, 4), (0, 4), (0, 0)), ring((1, 1), (1, 2), (2, 2), (2, 1), (1, 1)))
    val plain    = polygon(ring((10, 10), (11, 10), (11, 11), (10, 10)))
    check(
      factory.createMultiPolygon(Array(withHole, plain)),
      """{"type":"MultiPolygon","coordinates":[""" +
        """[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[1,2],[2,2],[2,1],[1,1]]],""" +
        """[[[10,10],[11,10],[11,11],[10,10]]]]}"""
    )
  }

  test("coordinates are rounded to 8 decimal places, halves away from zero, with no trailing zeros") {
    // 1/512 is exactly 0.001953125 as a double, so it sits right on the rounding boundary.
    check(
      factory.createLineString(ring((-122.123456789, 47.100000001), (1.0 / 512, -1.0 / 512), (-0.0, 1e-9))),
      """{"type":"LineString","coordinates":[[-122.12345679,47.1],[0.00195313,-0.00195313],[0,0]]}"""
    )
  }
}
