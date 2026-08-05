package actor

import actor.ActorUtils.{dateFormatter, getTimeToNextUpdate}
import org.apache.pekko.actor.{Actor, Cancellable, Props}
import play.api.Logger
import service.{ConfigService, OsmWayService}

import java.time.Instant
import javax.inject._
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.util.{Failure, Success}

object OsmWayRefreshActor {
  val Name  = "osm-way-refresh-actor"
  def props = Props[OsmWayRefreshActor]()
  case object Tick
}

/**
 * Nightly refresh of the cached OSM way data behind the speed-limit sign (#4654).
 *
 * Ticks daily, but OsmWayService only re-fetches ways whose row is missing or older than its staleness period, so
 * most nights are a fast no-op; a new city's ways are backfilled on the first tick after its streets are imported.
 */
@Singleton
class OsmWayRefreshActor @Inject() (osmWayService: OsmWayService)(implicit
    ec: ExecutionContext,
    configService: ConfigService
) extends Actor {

  private var cancellable: Option[Cancellable] = None
  private val logger                           = Logger(this.getClass)

  override def preStart(): Unit = {
    super.preStart()
    // Per-city hour offset staggers computation/resource use across deployments (and their Overpass requests).
    configService.getOffsetHours.foreach { hoursOffset =>
      // Target time is 2:00 am Pacific + offset.
      cancellable = Some(
        context.system.scheduler.scheduleAtFixedRate(
          getTimeToNextUpdate(2, 0, hoursOffset).toMillis.millis,
          24.hours,
          self,
          OsmWayRefreshActor.Tick
        )(context.dispatcher)
      )
      logger.info("OsmWayRefreshActor created")
    }
  }

  override def postStop(): Unit = {
    cancellable.foreach(_.cancel())
    cancellable = None
    super.postStop()
  }

  def receive: Receive = { case OsmWayRefreshActor.Tick =>
    val currentTimeStart: String = dateFormatter.format(Instant.now())
    logger.info(s"Auto-scheduled OSM way data refresh starting at: $currentTimeStart")
    osmWayService.refreshOsmWayData().onComplete {
      case Success(waysRefreshed) =>
        logger.info(s"OSM way data refresh completed at: ${dateFormatter.format(Instant.now())}")
        logger.info(s"Ways refreshed: $waysRefreshed")
      case Failure(e) => logger.error(s"Error refreshing OSM way data: ${e.getMessage}")
    }
  }
}
