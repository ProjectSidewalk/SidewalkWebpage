package service

import com.google.inject.ImplementedBy
import executors.CpuIntensiveExecutionContext
import play.api.{Configuration, Logger}

import java.util.concurrent.atomic.AtomicReference
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.sys.process.{Process, ProcessLogger}

/**
 * Final counts from a clustering run: how many labels were grouped into how many clusters.
 */
case class ClusteringResults(labelCount: Int, clusterCount: Int)

@ImplementedBy(classOf[ClusterServiceImpl])
trait ClusterService {

  /**
   * Runs clustering across all regions, updating the attached reference with progress.
   *
   * @param statusRef Reference to a string that will be updated with the clustering progress.
   * @return          Final counts of labels and clusters.
   */
  def runClustering(statusRef: Option[AtomicReference[String]] = None): Future[ClusteringResults]
}

/**
 * Runs the label-clustering pipeline: shells out to scripts/label_clustering.py once per region, which calls back into
 * the app over HTTP (authenticated with the internal API key) to fetch labels and submit results.
 */
@Singleton
class ClusterServiceImpl @Inject() (
    config: Configuration,
    apiService: ApiService,
    cpuEc: CpuIntensiveExecutionContext
)(implicit ec: ExecutionContext)
    extends ClusterService {
  private val logger = Logger(this.getClass)

  def runClustering(statusRef: Option[AtomicReference[String]]): Future[ClusteringResults] = {
    for {
      _      <- runMultiUserClustering(statusRef)
      counts <- apiService.getClusteringInfo // Gets the counts to show how many labels were clustered.
    } yield ClusteringResults(labelCount = counts._1, clusterCount = counts._2)
  }

  /**
   * Runs clustering for the labels in each region.
   * @param statusRef Reference to a string that will be updated with the clustering progress.
   */
  private def runMultiUserClustering(statusRef: Option[AtomicReference[String]]): Future[Unit] = {
    val key: String = config.get[String]("internal-api-key")

    // Each shell-out blocks until that region's clustering script finishes, so the loop runs on the cpu-intensive
    // pool to keep these potentially minutes-long waits off Play's default dispatcher.
    apiService.getRegionsToCluster.map { regionIds =>
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
          Seq("/usr/bin/python3", "scripts/label_clustering.py", "--region_id", regionId.toString),
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
