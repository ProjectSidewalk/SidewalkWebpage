package models.user

import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

/**
 * DB-backed tests for how Expert Validate's `?teams=` entries resolve to a team (#5342).
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class TeamTableSpec extends PlaySpec with RolledBackDb with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val teamTable = app.injector.instanceOf[TeamTable]

  "findByIdOrName" should {
    "read only plain ASCII digits as an id, and match a name ignoring case and outer spaces" in {
      val name                                              = s"spec-5342-lookup-${System.nanoTime()}"
      val (teamId, byId, bySignedId, byFullwidthId, byName) = runRolledBack(for {
        teamId        <- teamTable.insert(name, "")
        byId          <- teamTable.findByIdOrName(teamId.toString)
        bySignedId    <- teamTable.findByIdOrName(s"+$teamId")
        byFullwidthId <- teamTable.findByIdOrName(teamId.toString.map(c => (c - '0' + '０').toChar))
        byName        <- teamTable.findByIdOrName(s"  ${name.toUpperCase}  ")
      } yield (teamId, byId, bySignedId, byFullwidthId, byName))

      byId.map(_.teamId) mustBe Some(teamId)
      bySignedId mustBe None
      byFullwidthId mustBe None
      byName.map(_.teamId) mustBe Some(teamId)
    }
  }
}
