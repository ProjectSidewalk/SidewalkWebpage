package controllers

import models.utils.{ConfigTable, FunnelStatTable, VersionTable}
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.cache.AsyncCacheApi
import play.api.db.slick.DatabaseConfigProvider
import play.api.i18n.MessagesApi
import play.api.inject.bind
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.ws.WSClient
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import play.api.{Application, Configuration}
import service.*
import util.SidewalkSpec

import java.sql.SQLTransientConnectionException
import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

/**
 * A [[ConfigServiceImpl]] whose schema list always fails, which is what a database refusing connections looks like to
 * every cross-city total.
 */
class SchemaListFailingConfigService @Inject() (
    dbcp: DatabaseConfigProvider,
    configuration: Configuration,
    messages: MessagesApi,
    cache: AsyncCacheApi,
    wsClient: WSClient,
    table: ConfigTable,
    funnels: FunnelStatTable,
    versions: VersionTable,
    panos: PanoDataService,
    swr: SwrCache,
    manifest: AssetManifestService
)(using executionContext: ExecutionContext, mat: Materializer)
    extends ConfigServiceImpl(dbcp, configuration, messages, cache, wsClient, table, funnels, versions, panos, swr,
      manifest) {
  override protected def readableSchemas(): Future[Set[String]] =
    Future.failed(SQLTransientConnectionException("Connection is not available, timed out"))
}

/**
 * The Leaderboard when no complete cross-city total exists (#5977): it renders, without the bands that would show one,
 * rather than returning a 500 or partial numbers.
 */
class LeaderboardWithoutTotalsSpec extends SidewalkSpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .overrides(bind[ConfigService].to[SchemaListFailingConfigService])
      .build()

  "/leaderboard" should {
    "render without the cross-city bands when the totals can't be computed" in {
      val result = route(app, FakeRequest(GET, "/leaderboard")).get
      status(result) mustBe OK
      val body = contentAsString(result)
      body must include("ud-") // The Leaderboard itself rendered.
      body must not include "lb-global-section"
      body must not include "ud-impact-bridge"
    }
  }
}
