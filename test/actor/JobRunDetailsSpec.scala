package actor

import org.scalatestplus.play.PlaySpec
import play.api.libs.json.{JsNull, Json}
import service.ClusteringResults

/**
 * The wire shape of the run details each multi-trigger job records (#5044).
 *
 * Every job's `details` object has one definition that the nightly actor and the admin hand-trigger both pass to
 * `JobRunService.record`, which is what keeps the two triggers recording the same job the same way. The cost of that
 * is that [[controllers.AdminJobTriggerSpec]] compares a recorded row against the very builder that wrote it, so a
 * renamed key passes there. These key names are read back out of `background_job_run.details` by key — as
 * `ImageryFreshnessReportService` does — so they are pinned here as literals, where a rename has to be deliberate.
 *
 * The two jobs whose details live on an imagery result are pinned by `ImageryPollOutcomeSpec` instead.
 *
 * Pure — no database, no application.
 */
class JobRunDetailsSpec extends PlaySpec {

  "the run details of a job with both a nightly and a hand trigger" should {
    "record user stats under the key its readers use" in {
      UserStatActor.runDetails(11) mustBe Json.obj("users_updated" -> 11)
    }

    "record funnel stats under the key its readers use" in {
      FunnelStatActor.runDetails(12) mustBe Json.obj("rows_written" -> 12)
    }

    "record the OSM way refresh under the key its readers use" in {
      OsmWayRefreshActor.runDetails(13) mustBe Json.obj("ways_refreshed" -> 13)
    }

    "record clustering under the keys its readers use" in {
      ClusteringResults(labelCount = 14, clusterCount = 15).runDetails mustBe
        Json.obj("labels_clustered" -> 14, "clusters_created" -> 15)
    }

    "record the street-priority rebuild's count, or a null where no rebuild ran" in {
      // The hand-trigger runs the recalculation alone. Null rather than 0 so a reader can tell the rebuild that
      // seeded no regions from the trigger that never rebuilt, and rather than a missing key so both triggers write
      // one shape.
      RecalculateStreetPriorityActor.runDetails(Some(16)) mustBe Json.obj("regions_seeded" -> 16)
      RecalculateStreetPriorityActor.runDetails(None) mustBe Json.obj("regions_seeded" -> JsNull)
    }
  }
}
