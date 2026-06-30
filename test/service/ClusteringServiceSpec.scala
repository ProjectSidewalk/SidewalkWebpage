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
 * DB-backed regression tests for the mid-clustering atomic swap (#2507).
 *
 * Nightly clustering used to wipe every dirty region's clusters up front (in getRegionsToClusterAndWipeOldData) and then
 * repopulate them region-by-region over a long run, so API readers saw a region as empty for the whole gap. The fix has
 * two halves, each covered below:
 *   1. submitClusteringResults now deletes a region's old clusters inside the same transaction that inserts the new ones
 *      -> re-submitting a region atomically *replaces* its clusters (one clustering_session, no duplication), and an
 *      empty submission clears the region; other regions are untouched.
 *   2. getRegionsToCluster no longer deletes anything -> querying the to-cluster list leaves existing clusters intact.
 *
 * Not covered here: the literal "a concurrent reader never observes the region empty mid-swap" guarantee. That follows
 * from Postgres MVCC plus the single-transaction delete+insert and is not deterministically reproducible in a unit test
 * (it would require racing a reader against the in-flight transaction); these tests instead pin the committed-state
 * invariants the guarantee rests on.
 *
 * These mutate real cluster rows for one region, so each mutating case runs inside withRegionRestored, which snapshots
 * the region's clustering_session/cluster/cluster_label rows and restores them (preserving ids) in a finally — leaving
 * the DB untouched even if an assertion fails. Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER /
 * DATABASE_PASSWORD, as in dev/CI); cancels gracefully if the connected DB has no clusterable labels. Scheduling actors
 * are disabled so the background clustering actor can't race the tests.
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

  /** A real region that has API-eligible labels, so we can build submissions with valid label_id/lat/lng FKs. */
  private lazy val candidateRegion: Option[(Int, Seq[LabelToCluster])] = {
    val regionIds: Seq[Int] = run(regions.filter(_.deleted === false).map(_.regionId).result)
    regionIds.iterator.map(id => id -> run(clusteringSessionTable.getLabelsToClusterInRegion(id))).find(_._2.nonEmpty)
  }

  /** Clustering_session ids for a region (read only the id column, so the un-round-trippable thresholds JSON is skipped). */
  private def sessionIdsForRegion(regionId: Int): Seq[Int] =
    run(sessions.filter(_.regionId === regionId).map(_.clusteringSessionId).result)

  /** Clusters belonging to a region (cluster has no region_id; join through its clustering_session). */
  private def clusterCountForRegion(regionId: Int): Int =
    run(clusters.filter(_.clusteringSessionId.inSet(sessionIdsForRegion(regionId))).length.result)

  /** Total clusters NOT in the given region — used to assert a submit touches only its own region. */
  private def clusterCountOutsideRegion(regionId: Int): Int =
    run(
      clusters
        .filter(_.clusteringSessionId.in(sessions.filterNot(_.regionId === regionId).map(_.clusteringSessionId)))
        .length
        .result
    )

  /** A one-cluster submission built from a real label so its label_id/lat/lng satisfy the cluster FKs. */
  private def singleClusterSubmission(label: LabelToCluster): (Seq[ClusterSubmission], Seq[ClusteredLabelSubmission]) =
    (
      Seq(ClusterSubmission(label.labelType, 1, label.lat, label.lng, label.severity)),
      Seq(ClusteredLabelSubmission(label.labelId, label.labelType, 1))
    )

  /**
   * Runs `body` and then restores the region's cluster data to exactly its pre-test state, so these destructive tests
   * leave the dev/CI DB untouched. clustering_session is snapshotted/restored via plain SQL (raw `::text`): its
   * thresholds JSON mapper can't deserialize existing rows — the reader expects "label_type" but the writer emits
   * "label_type_id" (a latent bug unrelated to #2507) — whereas cluster/cluster_label map cleanly through Slick.
   */
  private def withRegionRestored[T](regionId: Int)(body: => T): T = {
    val snapSessions: Seq[(Int, Int, String, String)] = run(
      sql"""SELECT clustering_session_id, region_id, thresholds::text, timestamp::text
            FROM clustering_session WHERE region_id = $regionId""".as[(Int, Int, String, String)]
    )
    val snapClusters      = run(clusters.filter(_.clusteringSessionId.inSet(snapSessions.map(_._1))).result)
    val snapClusterLabels = run(clusterLabels.filter(_.clusterId.inSet(snapClusters.map(_.clusterId))).result)

    try body
    finally {
      // Restore in FK order, preserving original ids (forceInsert / explicit-id INSERT).
      val restoreSessions = DBIO.sequence(snapSessions.map { case (id, rid, thresholds, timestamp) =>
        sqlu"""INSERT INTO clustering_session (clustering_session_id, region_id, thresholds, timestamp)
               VALUES ($id, $rid, ${thresholds}::jsonb, ${timestamp}::timestamptz)"""
      })
      run(
        DBIO
          .seq(
            sessions.filter(_.regionId === regionId).delete, // cascades away whatever the test left behind
            restoreSessions,
            clusters.forceInsertAll(snapClusters),
            clusterLabels.forceInsertAll(snapClusterLabels)
          )
          .transactionally
      )
    }
  }

  "ApiService.submitClusteringResults (#2507 atomic swap)" should {
    "replace a region's clusters on re-submit rather than emptying or duplicating them" in {
      candidateRegion match {
        case None => cancel("No region in the connected DB has clusterable labels; nothing to exercise.")
        case Some((regionId, labels)) =>
          val (clusterSubs, clusterLabelSubs) = singleClusterSubmission(labels.head)
          val noThresholds                    = Seq.empty[ClusteringThreshold]

          withRegionRestored(regionId) {
            val clustersElsewhereBefore = clusterCountOutsideRegion(regionId)

            // First submit: the region now holds exactly our one synthetic cluster under a single session.
            val sessionA =
              await(apiService.submitClusteringResults(regionId, clusterSubs, clusterLabelSubs, noThresholds))
            sessionIdsForRegion(regionId) mustBe Seq(sessionA)
            clusterCountForRegion(regionId) mustBe 1

            // Second submit: the in-transaction delete must drop session A before inserting session B, so the region
            // still has exactly one session (the new one) and the cluster count has not doubled.
            val sessionB =
              await(apiService.submitClusteringResults(regionId, clusterSubs, clusterLabelSubs, noThresholds))
            sessionB must not equal sessionA
            sessionIdsForRegion(regionId) mustBe Seq(sessionB)
            clusterCountForRegion(regionId) mustBe 1

            // The swap is scoped to this region: every other region's clusters are untouched.
            clusterCountOutsideRegion(regionId) mustBe clustersElsewhereBefore
          }
      }
    }

    "clear a region's clusters when an empty result set is submitted" in {
      candidateRegion match {
        case None => cancel("No region in the connected DB has clusterable labels; nothing to exercise.")
        case Some((regionId, labels)) =>
          val (clusterSubs, clusterLabelSubs) = singleClusterSubmission(labels.head)
          val noThresholds                    = Seq.empty[ClusteringThreshold]

          withRegionRestored(regionId) {
            // Seed a known non-empty state so the clear is observable regardless of the region's starting data.
            await(apiService.submitClusteringResults(regionId, clusterSubs, clusterLabelSubs, noThresholds))
            clusterCountForRegion(regionId) must be > 0

            // An empty submission (a region whose labels all disappeared still POSTs an empty payload) must leave the
            // region with a fresh session but zero clusters — the delete commits even when nothing is inserted.
            val emptySession = await(apiService.submitClusteringResults(regionId, Seq.empty, Seq.empty, noThresholds))
            sessionIdsForRegion(regionId) mustBe Seq(emptySession)
            clusterCountForRegion(regionId) mustBe 0
          }
      }
    }
  }

  "ApiService.getRegionsToCluster (#2507)" should {
    "not delete any existing cluster data" in {
      candidateRegion match {
        case None => cancel("No region in the connected DB has clusterable labels; nothing to exercise.")
        case Some((regionId, labels)) =>
          val (clusterSubs, clusterLabelSubs) = singleClusterSubmission(labels.head)
          val noThresholds                    = Seq.empty[ClusteringThreshold]

          withRegionRestored(regionId) {
            // Establish a known cluster for the region, then confirm getRegionsToCluster leaves it in place. This guards
            // against re-introducing the old up-front wipe (it used to delete every dirty region's data).
            await(apiService.submitClusteringResults(regionId, clusterSubs, clusterLabelSubs, noThresholds))
            val regionCountBefore = clusterCountForRegion(regionId)
            val totalBefore       = run(clusters.length.result)
            regionCountBefore mustBe 1

            await(apiService.getRegionsToCluster)

            clusterCountForRegion(regionId) mustBe regionCountBefore
            run(clusters.length.result) mustBe totalBefore
          }
      }
    }
  }
}
