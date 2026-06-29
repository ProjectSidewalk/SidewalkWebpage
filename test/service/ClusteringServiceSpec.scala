package service

import formats.json.ClusterFormats.{ClusterSubmission, ClusteredLabelSubmission}
import models.cluster._
import models.region.RegionTableDef
import models.utils.{ClusteringThreshold, MyPostgresProfile}
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import slick.dbio.DBIO

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed regression test for the mid-clustering atomic swap (#2507).
 *
 * Nightly clustering used to wipe every dirty region's clusters up front and then repopulate them region-by-region over
 * a long run, so API readers saw a region as empty for the whole gap. The fix moves each region's delete into
 * submitClusteringResults' transaction, so re-submitting a region atomically replaces its clusters rather than
 * emptying-then-refilling. This spec proves that replace-not-duplicate property: submitting twice for the same region
 * leaves exactly one clustering_session and does not double the cluster count.
 *
 * It mutates real cluster rows for one region, so it snapshots that region's clustering_session/cluster/cluster_label
 * rows up front and restores them (preserving ids via forceInsert) in a finally, leaving the DB untouched even if an
 * assertion fails. Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in
 * dev/CI); cancels gracefully if the connected DB has no clusterable labels. Scheduling actors are disabled so the
 * background clustering actor can't race the test.
 */
class ClusteringServiceSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val apiService             = app.injector.instanceOf[ApiService]
  private val clusteringSessionTable = app.injector.instanceOf[ClusteringSessionTable]
  // Keep the DatabaseConfig as a stable val and call .db.run inline; binding .db to its own val would infer a
  // path-dependent existential type that needs -language:existentials.
  private val dbConfig                   = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)
  private def await[T](f: scala.concurrent.Future[T]): T = Await.result(f, 60.seconds)

  private val sessions      = TableQuery[ClusteringSessionTableDef]
  private val clusters      = TableQuery[ClusterTableDef]
  private val clusterLabels = TableQuery[ClusterLabelTableDef]
  private val regions       = TableQuery[RegionTableDef]

  /** Clusters belonging to the given region (cluster has no region_id; join through its clustering_session). */
  private def clusterCountForRegion(regionId: Int): Int = {
    val sessionIds: Seq[Int] = run(sessions.filter(_.regionId === regionId).map(_.clusteringSessionId).result)
    run(clusters.filter(_.clusteringSessionId.inSet(sessionIds)).length.result)
  }

  private def sessionIdsForRegion(regionId: Int): Seq[Int] =
    run(sessions.filter(_.regionId === regionId).map(_.clusteringSessionId).result)

  "ApiService.submitClusteringResults (#2507 atomic swap)" should {
    "replace a region's clusters on re-submit rather than emptying or duplicating them" in {
      // Find a real region that has API-eligible labels so we can build a submission with valid label_id/lat/lng FKs.
      val regionIds: Seq[Int] = run(regions.filter(_.deleted === false).map(_.regionId).result)
      val candidate: Option[(Int, Seq[LabelToCluster])] = regionIds.iterator
        .map(id => id -> run(clusteringSessionTable.getLabelsToClusterInRegion(id)))
        .find(_._2.nonEmpty)

      candidate match {
        case None => cancel("No region in the connected DB has clusterable labels; nothing to exercise.")
        case Some((regionId, labels)) =>
          val label           = labels.head
          val clusterSub      = ClusterSubmission(label.labelType, 1, label.lat, label.lng, label.severity)
          val clusterLabelSub = ClusteredLabelSubmission(label.labelId, label.labelType, 1)
          val noThresholds    = Seq.empty[ClusteringThreshold]

          // Snapshot the region's existing cluster data so we can restore it regardless of how the test ends. Read the
          // clustering_session rows as raw text via plain SQL rather than the Slick projection: the thresholds JSON
          // mapper can't deserialize existing rows (its reader expects "label_type" but the writer emits
          // "label_type_id"), and that latent bug is unrelated to #2507. cluster/cluster_label map cleanly.
          val snapSessions: Seq[(Int, Int, String, String)] = run(
            sql"""SELECT clustering_session_id, region_id, thresholds::text, timestamp::text
                  FROM clustering_session WHERE region_id = $regionId""".as[(Int, Int, String, String)]
          )
          val snapSessionIds    = snapSessions.map(_._1)
          val snapClusters      = run(clusters.filter(_.clusteringSessionId.inSet(snapSessionIds)).result)
          val snapClusterIds    = snapClusters.map(_.clusterId)
          val snapClusterLabels = run(clusterLabels.filter(_.clusterId.inSet(snapClusterIds)).result)

          try {
            // First submit: the region now holds exactly our one synthetic cluster under a single session.
            val sessionA =
              await(apiService.submitClusteringResults(regionId, Seq(clusterSub), Seq(clusterLabelSub), noThresholds))
            sessionIdsForRegion(regionId) mustBe Seq(sessionA)
            clusterCountForRegion(regionId) mustBe 1

            // Second submit: the in-transaction delete must drop session A before inserting session B, so the region
            // still has exactly one session (the new one) and the cluster count has not doubled.
            val sessionB =
              await(apiService.submitClusteringResults(regionId, Seq(clusterSub), Seq(clusterLabelSub), noThresholds))
            sessionB must not equal sessionA
            sessionIdsForRegion(regionId) mustBe Seq(sessionB)
            clusterCountForRegion(regionId) mustBe 1
          } finally {
            // Restore the region to its pre-test state, preserving original ids (forceInsert) and FK order. Sessions go
            // back via plain SQL (re-casting the snapshotted text), mirroring how they were read out.
            val restoreSessions = DBIO.sequence(snapSessions.map { case (id, rid, thresholds, timestamp) =>
              sqlu"""INSERT INTO clustering_session (clustering_session_id, region_id, thresholds, timestamp)
                     VALUES ($id, $rid, ${thresholds}::jsonb, ${timestamp}::timestamptz)"""
            })
            run(
              DBIO
                .seq(
                  sessions.filter(_.regionId === regionId).delete, // cascades to our test clusters/cluster_labels
                  restoreSessions,
                  clusters.forceInsertAll(snapClusters),
                  clusterLabels.forceInsertAll(snapClusterLabels)
                )
                .transactionally
            )
          }
      }
    }
  }
}
