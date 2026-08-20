package actor

import org.scalatestplus.play.PlaySpec

/**
 * Invariants of the nightly job roster (#4928).
 *
 * [[ScheduledJobs.All]] is what the Health panel iterates, and it is the only reason the panel can report a job that
 * has *never* run — a rows-driven listing would render a scheduler that never started as an empty, healthy-looking
 * table. That makes the roster load-bearing in a way nothing else checks: a job missing from it is simply invisible,
 * and invisibility is indistinguishable from health, which is the exact failure this whole feature exists to close.
 *
 * Pure — no database, no application.
 */
class ScheduledJobsSpec extends PlaySpec {

  /** Every `ScheduledJob` value defined on the object, found by reflection rather than by being listed again here. */
  private val declaredJobs: Seq[ScheduledJob] = {
    ScheduledJobs.getClass.getDeclaredMethods.toSeq
      .filter(method => method.getParameterCount == 0 && method.getReturnType == classOf[ScheduledJob])
      .map(_.invoke(ScheduledJobs).asInstanceOf[ScheduledJob])
  }

  "the nightly job roster" should {
    "list every job it declares" in {
      // Reflection rather than a hand-written list, so adding a `val Foo: ScheduledJob` and forgetting `All` fails
      // here instead of silently dropping that job off the Health panel.
      declaredJobs must not be empty
      ScheduledJobs.All must contain theSameElementsAs declaredJobs
    }

    "give every job a distinct, non-blank name" in {
      // Runs are keyed by name, so two jobs sharing one would interleave their histories into a single panel row and
      // let a healthy job's success stand in for a broken one's.
      val names = ScheduledJobs.All.map(_.name)
      names.foreach(_.trim must not be empty)
      names.distinct must have size names.size.toLong
    }

    "give every job a distinct label, so two panel rows can't read alike" in {
      val labels = ScheduledJobs.All.map(_.label)
      labels.foreach(_.trim must not be empty)
      labels.distinct must have size labels.size.toLong
    }

    "hold a valid time for every job, rendered as HH:mm" in {
      ScheduledJobs.All.foreach { job =>
        job.hour must (be >= 0 and be <= 23)
        job.minute must (be >= 0 and be <= 59)
        job.scheduledAt must fullyMatch regex """\d{2}:\d{2}"""
      }
      ScheduledJobs.CheckImageExpiry.scheduledAt mustBe "00:15"
      ScheduledJobs.Clustering.scheduledAt mustBe "04:00"
    }

    "stay in the order the jobs actually run, which is how the panel and the docs read it" in {
      val minutes = ScheduledJobs.All.map(job => job.hour * 60 + job.minute)
      minutes mustBe minutes.sorted
    }

    "give the imagery-freshness sync the time of the job it runs inside" in {
      // It has no scheduler of its own — it is the first step of the street-priority sequence — so a time of its own
      // would be a copy that drifts the first time that sequence moves.
      ScheduledJobs.ImageryFreshnessSync.hour mustBe ScheduledJobs.RecalculateStreetPriority.hour
      ScheduledJobs.ImageryFreshnessSync.minute mustBe ScheduledJobs.RecalculateStreetPriority.minute
      ScheduledJobs.ImageryFreshnessSync.name must not be ScheduledJobs.RecalculateStreetPriority.name
    }

    "cover every job name a hand-trigger endpoint records under" in {
      // The /adminapi routes record Manual runs under the nightly job's name (#4928). A name that isn't on the roster
      // writes rows no panel row ever reads, so the run is recorded and still invisible.
      val handTriggered = Seq(
        CheckImageExpiryActor.Name,          // /adminapi/checkImagery
        UserStatActor.Name,                  // /adminapi/updateUserStats
        FunnelStatActor.Name,                // /adminapi/updateFunnelStats
        RecalculateStreetPriorityActor.Name, // /adminapi/recalculateStreetPriority
        OsmWayRefreshActor.Name,             // /adminapi/refreshOsmWayData
        ClusteringActor.Name                 // /runClustering
      )
      ScheduledJobs.All.map(_.name) must contain allElementsOf handTriggered
    }

    "cover every scheduling actor's own name" in {
      val scheduled = Seq(
        CheckImageExpiryActor.Name, GetAiValidationsActor.Name, CheckImageryAgeActor.Name, UserStatActor.Name,
        RecalculateStreetPriorityActor.Name, RecalculateStreetPriorityActor.FreshnessSyncJobName,
        OsmWayRefreshActor.Name, AuthTokenCleanerActor.Name, FunnelStatActor.Name, ClusteringActor.Name
      )
      ScheduledJobs.All.map(_.name) must contain theSameElementsAs scheduled
    }
  }
}
