package models.label

import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

/**
 * Pins the `/label/resumeMission` query, which Explore loads on every page load and reads for two things: the
 * mission-complete "your labels" count, and the minimap's separation of this pass's labels from earlier ones (#4945).
 *
 * The freshness flag rides along from the label's own audit task, so a label must come back flagged exactly when
 * `audit_task.outdated_imagery` is set for the task that placed it -- read from the raw table here so a wrong join
 * (a different task of the same user, say) would fail rather than agree by construction. The count is checked
 * against a raw SQL rewrite of the same filters, since narrowing the query would silently change the modal's stat.
 */
class ResumeLabelsQuerySpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val labelTable = app.injector.instanceOf[LabelTable]

  // The query's filters as raw SQL, shared by the fixture pickers and the count check so a picked (region, user) pair
  // is one the query really returns rows for (an excluded user, say, would otherwise be picked and come back empty).
  private val resumableLabelsFromWhere =
    """FROM label
       INNER JOIN mission ON label.mission_id = mission.mission_id
       INNER JOIN label_point ON label.label_id = label_point.label_id
       INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
       INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
       INNER JOIN user_stat ON audit_task.user_id = user_stat.user_id
       WHERE label.deleted = FALSE AND label.tutorial = FALSE AND user_stat.excluded = FALSE
         AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
         AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
         AND label_point.lat IS NOT NULL AND label_point.lng IS NOT NULL"""

  /**
   * The (region, user) pair ranked first by `orderBy` among those with resumable labels. Cancels rather than passing
   * vacuously when the database has none, so a thin fixture shows up in the report.
   */
  private def pickRegionUser(orderBy: String, having: String, missing: String): (Int, String) =
    run(
      sql"""SELECT mission.region_id, mission.user_id
            #$resumableLabelsFromWhere AND mission.region_id IS NOT NULL
            GROUP BY mission.region_id, mission.user_id
            HAVING #$having
            ORDER BY #$orderBy
            LIMIT 1""".as[(Int, String)].headOption
    ).getOrElse(cancel(missing))

  "getLabelsFromUserInRegion" should {
    "be a query Postgres accepts" in {
      run(labelTable.getLabelsFromUserInRegion(-1, "no-such-user")) mustBe empty
    }

    "carry each label's own audit task's outdated_imagery flag" in {
      // A pair with both flagged and unflagged labels, so both values of the flag are exercised: with only one, a
      // query returning a constant would pass.
      val (regionId, userId) = pickRegionUser(
        orderBy = "count(*) DESC",
        having = "bool_or(audit_task.outdated_imagery) AND NOT bool_and(audit_task.outdated_imagery)",
        missing = "no user in this database has both outdated-imagery and current labels in one region"
      )
      val rows = run(labelTable.getLabelsFromUserInRegion(regionId, userId))
      rows.map(_.fromOutdatedImagery).toSet mustBe Set(true, false)
      val flaggedTasks: Set[Int] = run(
        sql"""SELECT audit_task_id FROM audit_task WHERE outdated_imagery AND user_id = $userId""".as[Int]
      ).toSet
      rows.foreach { row =>
        withClue(s"label ${row.labelData.labelId} (audit task ${row.labelData.auditTaskId}): ") {
          row.fromOutdatedImagery mustBe flaggedTasks.contains(row.labelData.auditTaskId)
        }
      }
    }

    "return every non-deleted, non-tutorial, positioned label the user placed in the region" in {
      val (regionId, userId) = pickRegionUser(
        orderBy = "count(*) DESC",
        having = "count(*) > 0",
        missing = "no user has a resumable label in any region of this database"
      )
      val expected = run(
        sql"""SELECT count(*)
              #$resumableLabelsFromWhere
                AND mission.region_id = $regionId AND mission.user_id = $userId""".as[Int].head
      )
      expected must be > 0
      run(labelTable.getLabelsFromUserInRegion(regionId, userId)).size mustBe expected
    }
  }
}
