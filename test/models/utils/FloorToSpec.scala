package models.utils

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/**
 * Pure (no DB, no app boot) unit test for `CommonUtils.floorTo`, the Scala half of `util.math.floorTo`.
 *
 * A displayed audited distance is truncated rather than rounded so it never reads as a badge threshold the user
 * hasn't crossed (#4404), and the server-rendered pages and Explore's sidebar show the same total — so the two
 * implementations have to land on the same value. The mirror of these cases lives in `test/js/mathRounding.test.js`.
 */
class FloorToSpec extends AnyFunSuite with Matchers {

  test("truncates rather than rounding, so a total never overstates progress") {
    CommonUtils.floorTo(16.45, 1) shouldBe 16.4
    CommonUtils.floorTo(16.99, 1) shouldBe 16.9
    CommonUtils.floorTo(16.449, 2) shouldBe 16.44
  }

  test("leaves values that need no truncation alone") {
    CommonUtils.floorTo(16.5, 1) shouldBe 16.5
    CommonUtils.floorTo(17.7, 1) shouldBe 17.7
    CommonUtils.floorTo(0, 1) shouldBe 0
    CommonUtils.floorTo(12, 0) shouldBe 12
  }

  test("is not fooled by values binary floating point cannot hold exactly") {
    // 2.9 * 10 is 28.999999999999996; scaling and flooring a raw Double would report 2.8.
    CommonUtils.floorTo(2.9, 1) shouldBe 2.9
    CommonUtils.floorTo(0.29, 2) shouldBe 0.29
    CommonUtils.floorTo(8.7, 1) shouldBe 8.7
  }

  // The same total is floored here and by util.math.floorTo in the browser, so the two must land on the same value
  // for every input, not just the ones far from a boundary. Mirrored in test/js/floorTo.test.js.
  test("truncates a value just shy of a boundary rather than absorbing it") {
    CommonUtils.floorTo(1.999999999, 1) shouldBe 1.9
    CommonUtils.floorTo(1.9999999, 1) shouldBe 1.9
  }
}
