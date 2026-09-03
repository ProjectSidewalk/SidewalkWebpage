package models.utils

import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import slick.dbio.DBIO
import util.RolledBackDb

/**
 * Pins ConfigTable's cross-schema fan-out against a city schema that has not applied evolution 373 (#4103) and so
 * still reads its label types from the `label_type` lookup table.
 *
 * Getting the shape wrong is silent: the query errors, and the service layer's `.recover` drops the whole city from
 * /v3/api/aggregateStats and the Owner scorecard. The lookup-table arms of `ConfigTable.LabelTypeSql` have no other
 * coverage — the dev DB is always on the enum — so this spec goes away with the probe itself (#5118).
 */
class ConfigTableLabelTypeShapeSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val configTable = app.injector.instanceOf[ConfigTable]

  private def currentSchema: DBIO[String] = sql"SELECT current_schema()".as[String].head

  "the cross-schema queries against a schema on the label_type lookup table" should {
    // LIKE copies the enum-typed label_type column, which the scratch schema can't resolve as its own type, hence the
    // manual swap back to the pre-373 label_type_id columns plus a lookup table to join.
    "still succeed, reading label types through the lookup table" in {
      val scratch      = "ci_lookup_shape_scratch"
      val clonedTables = Seq("street_edge", "audit_task", "user_stat", "label", "config", "label_validation", "tag",
        "mission", "audit_task_interaction_small", "voided_label_validation")
      val (agg, ids, scorecard) = runRolledBack(for {
        schema <- currentSchema
        _      <- sqlu"CREATE SCHEMA #$scratch"
        _      <- DBIO.sequence(clonedTables.map { t => sqlu"""CREATE TABLE #$scratch.#$t (LIKE "#$schema".#$t)""" })
        _      <- sqlu"""CREATE TABLE #$scratch.label_type (label_type_id INT PRIMARY KEY, label_type TEXT NOT NULL)"""
        _      <- sqlu"""ALTER TABLE #$scratch.label DROP COLUMN label_type, ADD COLUMN label_type_id INT"""
        _      <- sqlu"""ALTER TABLE #$scratch.tag DROP COLUMN label_type, ADD COLUMN label_type_id INT"""
        agg    <- configTable.getCityAggregateDataBySchema(scratch)
        ids    <- configTable.getContributorUserIdsBySchema(scratch)
        scorecard <- configTable.getCityScorecardBySchema(scratch)
      } yield (agg, ids, scorecard))

      agg.totalValidations mustBe 0
      ids mustBe empty
      scorecard.totalValidations mustBe 0
      scorecard.activeContributors mustBe 0
    }
  }
}
