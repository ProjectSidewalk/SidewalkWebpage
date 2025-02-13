package actor

import java.text.SimpleDateFormat
import java.util.{Calendar, Locale, TimeZone}
import org.apache.pekko.actor.{Actor, Cancellable, Props}

import javax.inject._
import service.utils.ConfigService

import scala.concurrent.ExecutionContext
import play.api.Logger
import scala.concurrent.duration._


object RecalculateStreetPriorityActor {
  val Name = "recalculate-street-priority-actor"
  def props = Props[RecalculateStreetPriorityActor]
  case object Tick
}

@Singleton
class RecalculateStreetPriorityActor @Inject()(implicit ec: ExecutionContext, configService: ConfigService) extends Actor {
  private var cancellable: Option[Cancellable] = None
  val TIMEZONE: TimeZone = TimeZone.getTimeZone("UTC")
  private val logger = Logger(this.getClass)
  println("RecalculateStreetPriorityActor created")

  override def preStart(): Unit = {
    super.preStart()
    // Get the number of hours later to run the code in this city. Used to stagger computation/resource use.
    configService.getOffsetHours.foreach { hoursOffset =>
      // If we want to update the street_edge_priority table at 12:45 am PDT every day, we need to figure out how much
      // time there is b/w now and the next 12:45 am, then we can set the update interval to be 24 hours. So we make a
      // calendar object for right now, and one for 12:45 am today. If it is after 12:45 am right now, we set the 12:45 am
      // object to be 12:45 am tomorrow. Then we get the time difference between the 12:45 am object and now.
      val currentTime: Calendar = Calendar.getInstance(TIMEZONE)
      val timeOfNextUpdate: Calendar = Calendar.getInstance(TIMEZONE)
      timeOfNextUpdate.set(Calendar.HOUR_OF_DAY, 7 + hoursOffset)
      timeOfNextUpdate.set(Calendar.MINUTE, 45)
      timeOfNextUpdate.set(Calendar.SECOND, 0)

      // If already past 12:45 am, set next update to 12:45 am tomorrow.
      if (currentTime.after(timeOfNextUpdate)) {
        timeOfNextUpdate.add(Calendar.HOUR_OF_DAY, 24)
      }
      // If it is after 12:45 am, this should have just incremented.
      val millisUntilNextUpdate: Long = timeOfNextUpdate.getTimeInMillis - currentTime.getTimeInMillis
      val durationToNextUpdate: FiniteDuration = FiniteDuration(millisUntilNextUpdate, MILLISECONDS)

      cancellable = Some(
        context.system.scheduler.schedule(
          durationToNextUpdate,
          24.hour,
          self,
          RecalculateStreetPriorityActor.Tick
        )(context.dispatcher)
      )
    }
  }

  override def postStop(): Unit = {
    cancellable.foreach(_.cancel())
    cancellable = None
    super.postStop()
  }

  def receive: Receive = {
    case RecalculateStreetPriorityActor.Tick =>
      val dateFormatter = new SimpleDateFormat("EE MMM dd HH:mm:ss zzz yyyy", Locale.US)
      dateFormatter.setTimeZone(TIMEZONE)

      val currentTimeStart: String = dateFormatter.format(Calendar.getInstance(TIMEZONE).getTime)
      logger.info(s"Auto-scheduled recalculation of street priority starting at: $currentTimeStart")
//      StreetEdgePriorityTable.recalculateStreetPriority()
//      RegionCompletionTable.truncateTable()
//      RegionCompletionTable.initializeRegionCompletionTable()
      val currentEndTime: String = dateFormatter.format(Calendar.getInstance(TIMEZONE).getTime)
      logger.info(s"Street priority recalculation completed at: $currentEndTime")
  }
}
