package models.utils

import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, SidewalkSpec}

/** Runs the funnel queries against the connected database, since the rest of the funnel specs never reach SQL. */
class FunnelStatTableSpec extends SidewalkSpec with RolledBackDb with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .build()

  private lazy val table: FunnelStatTable = app.injector.instanceOf[FunnelStatTable]

  "The funnel queries" should {
    "run for every window and never grow from one step to the next" in {
      for {
        window <- Seq(Some(30), None)
        funnel <- Seq(table.computeMappingFunnelBySchema, table.computeContributionFunnelBySchema)
      } {
        val segments = run(currentSchema.flatMap(schema => funnel(schema, window)))
        segments.foreach { s => withClue(s"${s.segment}, window $window: ") { s.steps mustBe s.steps.sorted.reverse } }
      }
    }
  }
}
