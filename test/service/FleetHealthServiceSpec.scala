package service

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/** The pure half of the fleet probe (#4548): one city's HTTP answer becoming a table row. */
class FleetHealthServiceSpec extends AnyFunSuite with Matchers {
  private val ok =
    """{"status":"ok","git_sha":"abc123","git_describe":"v11.20.0","git_dirty":false,"version":"11.20.0",
      |"version_released_at":"2026-11-01T00:00:00Z","city_id":"seattle-wa","environment":"prod",
      |"app_started_at":"2026-11-09T01:02:03Z"}""".stripMargin

  test("a 200 with a health body is a healthy row") {
    val row = FleetHealthService.parse("seattle-wa", "Seattle", "https://x", 200, ok)
    row.httpStatus shouldBe Some(200)
    row.error shouldBe None
    row.health.map(_.gitSha) shouldBe Some(Some("abc123"))
    row.health.map(_.status) shouldBe Some("ok")
  }

  test("a 503 whose body still parses keeps the build info and the error status it reports") {
    val body = """{"status":"error","git_dirty":false,"city_id":"seattle-wa","environment":"prod",
                 |"app_started_at":"2026-11-09T01:02:03Z"}""".stripMargin
    val row = FleetHealthService.parse("seattle-wa", "Seattle", "https://x", 503, body)
    row.error shouldBe None
    row.health.map(_.status) shouldBe Some("error")
    row.health.flatMap(_.version) shouldBe None
  }

  test("a body that is not a health document is an error row, whatever the status") {
    val row = FleetHealthService.parse("seattle-wa", "Seattle", "https://x", 200, "<html>old build</html>")
    row.health shouldBe None
    row.error shouldBe Some("HTTP 200 with no health body")
  }
}
