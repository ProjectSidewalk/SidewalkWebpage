package models.utils

import models.user.SidewalkUserTable
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

import java.time.OffsetDateTime

/** Checks that IP addresses save to and load from a real inet column (webpage_activity). */
class IpAddressColumnSpec extends PlaySpec with RolledBackDb with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .build()

  private lazy val table: WebpageActivityTable = app.injector.instanceOf[WebpageActivityTable]

  private def activity(ip: String): WebpageActivity =
    WebpageActivity(0, SidewalkUserTable.aiUserId, IpAddress(ip), "IpAddressColumnSpec", OffsetDateTime.now)

  "The ip_address column" should {
    "save an IP and read it back in Postgres's standard spelling" in {
      val stored = runRolledBack(for {
        id <- table.insert(activity("2607:4000:0200:0015:0000:ffff:80d0:061f"))
        ip <- table.activities.filter(_.webpageActivityId === id).map(_.ipAddress).result.head
      } yield ip)
      stored mustBe IpAddress("2607:4000:200:15:0:ffff:80d0:61f")
    }

    "refuse a value that isn't an IP" in {
      val attempt = runRolledBack(table.insert(activity("1' OR 1=1--")).asTry)
      attempt.failed.get.getMessage must include("invalid input syntax for type inet")
    }
  }
}
