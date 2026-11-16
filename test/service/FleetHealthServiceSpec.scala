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
    row.error shouldBe Some("not a health response")
  }

  test("a healthy answer from a different city is an error row: the URL points at the wrong instance") {
    val row = FleetHealthService.parse("chicago-il", "Chicago", "https://x", 200, ok)
    row.health.map(_.status) shouldBe Some("ok")
    row.error shouldBe Some("answered as seattle-wa")
  }

  test("the latest build is the most recently started instance's, ignoring rows that answered wrongly") {
    def row(city: String, sha: String, started: String, error: Option[String] = None) = {
      val body = ok.replace("seattle-wa", city).replace("abc123", sha).replace("2026-11-09T01:02:03Z", started)
      FleetHealthService.parse(city, city, "https://x", 200, body).copy(error = error)
    }
    val rows = Seq(
      row("a", "old111", "2026-11-01T00:00:00Z"),
      row("b", "new222", "2026-11-09T12:00:00Z"),
      row("c", "odd333", "2026-11-10T00:00:00Z", error = Some("answered as z"))
    )
    FleetHealthService.latestBuild(rows) shouldBe Some("new222")
    FleetHealthService.latestBuild(Seq.empty) shouldBe None
  }
}
