package controllers

import models.audit.AuditTaskTable
import models.user.SidewalkUserTableDef
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsArray, JsValue}
import play.api.test.FakeRequest
import play.api.test.Helpers._
import util.{AnonSession, RolledBackDb}

/**
 * Pins the freshness contract of the per-mapper street feed the dashboard and public-profile maps draw from (#4896).
 *
 * The map styles a street from its `audited`/`outdated` pair, so a serializer that stopped emitting `outdated` would
 * silently drop the dashed needs-re-audit rendering with nothing failing -- hence asserting on the JSON keys rather
 * than only on the query behind them. The three-state contract itself is the same one `/contribution/streets/all`
 * carries (StreetAuditStatusSpec), minus the unaudited arm: every street in this feed is one the mapper audited.
 *
 * Requires a Postgres+PostGIS database with at least one completed audit; cancels gracefully otherwise.
 */
class UserStreetsFreshnessSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb with AnonSession {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val auditTaskTable = app.injector.instanceOf[AuditTaskTable]
  private val sidewalkUsers  = TableQuery[SidewalkUserTableDef]

  /** A mapper with at least one completed audit, so their street feed is non-empty. */
  private lazy val mapperUsername: Option[String] = run(
    auditTaskTable.completedTasks
      .join(sidewalkUsers)
      .on(_.userId === _.userId)
      .map(_._2.username)
      .result
      .headOption
  )

  private def features(body: JsValue): Seq[JsValue] = (body \ "features").as[JsArray].value.toSeq

  "The per-mapper street feed" should {
    "carry a mutually exclusive audited/outdated pair on every street" in {
      assume(mapperUsername.isDefined)
      val cookies = freshAnonSession()

      val resp = route(
        app,
        FakeRequest(GET, s"/userapi/public/${mapperUsername.get}/streets").withCookies(cookies: _*)
      ).get

      status(resp) mustBe OK
      val streets = features(contentAsJson(resp))
      streets must not be empty
      streets.foreach { street =>
        val audited  = (street \ "properties" \ "audited").as[Boolean]
        val outdated = (street \ "properties" \ "outdated").as[Boolean]
        (audited && outdated) mustBe false
        (street \ "properties" \ "street_edge_id").asOpt[Int] mustBe defined
      }
    }
  }
}
