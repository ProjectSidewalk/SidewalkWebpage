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

  /** A (region, user) pair with the most resumable labels, so the assertions have rows to work on. */
  private def busiestRegionUser: Option[(Int, String)] =
    run(
      sql"""SELECT mission.region_id, mission.user_id
            FROM label
            INNER JOIN mission ON label.mission_id = mission.mission_id
            INNER JOIN label_point ON label.label_id = label_point.label_id
            WHERE label.deleted = FALSE AND label.tutorial = FALSE
              AND label_point.lat IS NOT NULL AND label_point.lng IS NOT NULL
              AND mission.region_id IS NOT NULL
            GROUP BY mission.region_id, mission.user_id
            ORDER BY count(*) DESC
            LIMIT 1""".as[(Int, String)].headOption
    )

  "getLabelsFromUserInRegion" should {
    "be a query Postgres accepts" in {
      run(labelTable.getLabelsFromUserInRegion(-1, "no-such-user")) mustBe empty
    }

    "carry each label's own audit task's outdated_imagery flag" in {
      busiestRegionUser.foreach { case (regionId, userId) =>
        val rows = run(labelTable.getLabelsFromUserInRegion(regionId, userId))
        rows must not be empty
        val flaggedTasks: Set[Int] = run(
          sql"""SELECT audit_task_id FROM audit_task WHERE outdated_imagery AND user_id = $userId""".as[Int]
        ).toSet
        rows.foreach { row =>
          withClue(s"label ${row.labelData.labelId} (audit task ${row.labelData.auditTaskId}): ") {
            row.fromOutdatedImagery mustBe flaggedTasks.contains(row.labelData.auditTaskId)
          }
        }
      }
    }

    "return every non-deleted, non-tutorial, positioned label the user placed in the region" in {
      busiestRegionUser.foreach { case (regionId, userId) =>
        val expected = run(
          sql"""SELECT count(*)
                FROM label
                INNER JOIN mission ON label.mission_id = mission.mission_id
                INNER JOIN label_point ON label.label_id = label_point.label_id
                INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
                INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
                INNER JOIN user_stat ON audit_task.user_id = user_stat.user_id
                WHERE mission.region_id = $regionId AND mission.user_id = $userId
                  AND label.deleted = FALSE AND label.tutorial = FALSE AND user_stat.excluded = FALSE
                  AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
                  AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
                  AND label_point.lat IS NOT NULL AND label_point.lng IS NOT NULL""".as[Int].head
        )
        run(labelTable.getLabelsFromUserInRegion(regionId, userId)).size mustBe expected
      }
    }
  }
}
