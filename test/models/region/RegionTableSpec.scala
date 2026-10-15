package models.region

import org.scalatest.OptionValues
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, SidewalkSpec, StreetFixtures}

/**
 * `RegionTable` queries against the connected Postgres+PostGIS database, every case inside a rolled-back transaction.
 */
class RegionTableSpec
    extends SidewalkSpec
    with GuiceOneAppPerSuite
    with RolledBackDb
    with StreetFixtures
    with OptionValues {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val table: RegionTable = app.injector.instanceOf[RegionTable]

  "regionsExtent" should {
    "cover every live region" in {
      // StreetFixtures' region is the unit square at the equator, well outside any city the schema holds.
      val extent = runRolledBack(for {
        _      <- insertRegion()
        extent <- table.regionsExtent
      } yield extent)
      extent.value.minLat must be <= 0.0
      extent.value.minLng must be <= 0.0
      extent.value.maxLat must be >= 1.0
      extent.value.maxLng must be >= 1.0
    }
  }
}
