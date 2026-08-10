package models.utils

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/**
 * Pure (no DB, no app boot) unit test for the polyline encoder behind route thumbnails.
 *
 * Pins the encoding against the reference vector from Google's Encoded Polyline Algorithm docs, and the decimation
 * contract (endpoints always survive; short sequences pass through untouched).
 */
class PolylineEncoderSpec extends AnyFunSuite with Matchers {

  test("matches the reference vector from the algorithm's documentation") {
    // Points are (lat, lng) in the docs; encode takes (lng, lat).
    val coords = Seq((-120.2, 38.5), (-120.95, 40.7), (-126.453, 43.252))
    PolylineEncoder.encode(coords) shouldBe "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
  }

  test("empty input encodes to an empty string") {
    PolylineEncoder.encode(Seq.empty) shouldBe ""
  }

  test("decimation keeps short sequences untouched") {
    val coords = Seq((0.0, 0.0), (1.0, 1.0), (2.0, 2.0))
    PolylineEncoder.decimate(coords, 60) shouldBe coords
  }

  test("decimation bounds the point count and keeps both endpoints") {
    val coords    = (0 until 500).map(i => (i.toDouble, i.toDouble))
    val decimated = PolylineEncoder.decimate(coords, 60)
    decimated.length should be <= 60
    decimated.head shouldBe coords.head
    decimated.last shouldBe coords.last
  }
}
