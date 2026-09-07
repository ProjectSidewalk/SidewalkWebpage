package service

import com.google.inject.ImplementedBy
import executors.CpuIntensiveExecutionContext
import models.utils.JobRunTrigger
import play.api.libs.json.{JsObject, Json}
import play.api.{Configuration, Environment, Logger}

import java.io.File
import java.util.concurrent.atomic.AtomicReference
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.sys.process.{Process, ProcessLogger}

/**
 * Final counts from a clustering run: how many labels were grouped into how many clusters.
 */
case class ClusteringResults(labelCount: Int, clusterCount: Int) {

  /**
   * The counts as they are stored against a `background_job_run` row.
   *
   * Defined on the result rather than at each call site so the nightly run and the admin hand-trigger can't record
   * the same clustering under two different shapes.
   *
   * @return The run's `details` object.
   */
  def runDetails: JsObject = Json.obj("labels_clustered" -> labelCount, "clusters_created" -> clusterCount)
}

object ClusterServiceImpl {

  /**
   * Job name for the intersection rebuild that opens every clustering run (#5095).
   *
   * Recorded as its own run rather than folded into clustering's: it is deliberately recovered rather than propagated,
   * so a clustering run that reports success says nothing about whether the rebuild inside it worked.
   */
  val IntersectionRebuildJobName: String = "intersection-rebuild"
}

@ImplementedBy(classOf[ClusterServiceImpl])
trait ClusterService {

  /**
   * Rebuilds the intersections, then runs clustering across all regions, updating the attached reference with
   * progress.
   *
   * @param statusRef  Reference to a string that will be updated with the clustering progress.
   * @param allRegions Re-cluster every region instead of only those whose label membership changed.
   * @param trigger    Whether the scheduler or a person set this run going, for the rebuild's own run record.
   * @return           Final counts of labels and clusters.
   */
  def runClustering(
      statusRef: Option[AtomicReference[String]] = None,
      allRegions: Boolean = false,
      trigger: JobRunTrigger.Value = JobRunTrigger.Scheduled
  ): Future[ClusteringResults]
}

/**
 * Runs the label-clustering pipeline: shells out to scripts/label_clustering.py once per region, which calls back into
 * the app over HTTP (authenticated with the internal API key) to fetch labels and submit results.
 */
@Singleton
class ClusterServiceImpl @Inject() (
    config: Configuration,
    environment: Environment,
    apiService: ApiService,
    intersectionService: IntersectionService,
    jobRunService: JobRunService,
    cpuEc: CpuIntensiveExecutionContext
)(implicit ec: ExecutionContext)
    extends ClusterService {
  private val logger = Logger(this.getClass)

  def runClustering(
      statusRef: Option[AtomicReference[String]],
      allRegions: Boolean,
      trigger: JobRunTrigger.Value
  ): Future[ClusteringResults] = {
    for {
      // The intersections must be current before any region's clusters are attributed to them (#5095). A rebuild
      // failure is recovered rather than propagated: it rolled back whole, so the clusters still attribute against
      // last night's table, and letting it abort the clustering would leave every score a day stale. The recovery
      // happens outside the rebuild's own run record, so that record still shows the failure.
      rebuildSummary <- jobRunService
        .record(ClusterServiceImpl.IntersectionRebuildJobName, trigger)(intersectionService.rebuild())(_.runDetails)
        .map(r =>
          s"${r.intersections} intersections (${r.inserted} new, ${r.updated} changed, ${r.deleted} gone), " +
            s"${r.clustersAttributed} clusters re-attributed"
        )
        .recover { case e: Throwable =>
          logger.error("Intersection rebuild failed; clustering against the previous table", e)
          "failed, see error above"
        }
      _ = logger.info(s"Intersection rebuild: $rebuildSummary")
      _      <- runMultiUserClustering(statusRef, allRegions)
      counts <- apiService.getClusteringInfo // Gets the counts to show how many labels were clustered.
    } yield ClusteringResults(labelCount = counts._1, clusterCount = counts._2)
  }

  /**
   * Runs clustering for the labels in each region.
   * @param statusRef  Reference to a string that will be updated with the clustering progress.
   * @param allRegions Re-cluster every region instead of only those whose label membership changed.
   */
  private def runMultiUserClustering(statusRef: Option[AtomicReference[String]], allRegions: Boolean): Future[Unit] = {
    val key: String = config.get[String]("internal-api-key")

    // Resolve the script against the app's root path (where scripts/ is packaged via Universal / mappings in build.sbt)
    // rather than a working-directory-relative path, so a staged/prod app finds it regardless of its launch directory.
    val script: File = environment
      .getExistingFile("scripts/label_clustering.py")
      .getOrElse(
        throw new RuntimeException(
          s"Clustering script not found at " +
            s"${environment.getFile("scripts/label_clustering.py").getAbsolutePath}; is scripts/ packaged into the build?"
        )
      )

    // Each shell-out blocks until that region's clustering script finishes, so the loop runs on the cpu-intensive
    // pool to keep these potentially minutes-long waits off Play's default dispatcher.
    apiService
      .getRegionsToCluster(allRegions)
      .map { regionIds =>
        val nRegions: Int = regionIds.length
        logger.info("N regions = " + nRegions)

        // Runs clustering within each region.
        for ((regionId, i) <- regionIds.view.zipWithIndex) {
          // Update the status in event stream and send a log message.
          statusRef.foreach(_.set(s"Finished ${f"${100.0 * i / nRegions}%1.2f"}% of regions"))
          logger.info(s"Finished ${f"${100.0 * i / nRegions}%1.2f"}% of regions, next: $regionId.")

          // Run the clustering script for this region. Pass the internal key via the subprocess environment rather than
          // an argv flag so it can't leak into the process table / `ps` output.
          val process = Process(
            Seq("/usr/bin/python3", script.getAbsolutePath, "--region_id", regionId.toString),
            None,
            "INTERNAL_API_KEY" -> key
          )

          // Capture stdout/stderr separately so a subprocess failure surfaces the Python error to Play's logger.
          val stdout   = new StringBuilder
          val stderr   = new StringBuilder
          val exitCode = process.!(
            ProcessLogger(
              line => { stdout.append(line).append('\n'); () },
              line => { stderr.append(line).append('\n'); () }
            )
          )

          if (exitCode != 0) {
            logger.error(s"Clustering script failed for region $regionId (exit $exitCode):\n${stderr.toString.trim}")
            throw new RuntimeException(s"Clustering failed for region $regionId (exit $exitCode)")
          }
          logger.debug(stdout.toString)
        }
        logger.info("Finished 100% of regions!!\n\n")
      }(cpuEc)
  }
}
