package utils.actor

import java.text.SimpleDateFormat
import java.util.{Calendar, Locale, TimeZone}
import akka.actor.{Actor, Cancellable, Props}
import models.street.StreetEdgePriorityTable
import play.api.Logger
import scala.concurrent.duration._

// Template code comes from this helpful StackOverflow post:
// https://stackoverflow.com/questions/48977612/how-to-schedule-complex-tasks-using-scala-play-2-3/48977937?noredirect=1#comment84961371_48977937
class RecalculateStreetPriorityActor extends Actor {

  private var cancellable: Option[Cancellable] = None
  val TIMEZONE = TimeZone.getTimeZone("UTC")

  override def preStart(): Unit = {
    super.preStart()
    // If we want to update the street_edge_priority table at 3am every day, we need to figure out how much time there
    // is b/w now and the next 3am, then we can set the update interval to be 24 hours. So we make a calendar object for
    // right now, and one for 3am today. If it is after 3am right now, we set the 3am object to be 3am tomorrow. Then we
    // get the time difference between the 3am object and now.

    val currentTime: Calendar = Calendar.getInstance(TIMEZONE)
    var timeOfNextUpdate: Calendar = Calendar.getInstance(TIMEZONE)
    timeOfNextUpdate.set(Calendar.HOUR_OF_DAY, 10)
    timeOfNextUpdate.set(Calendar.MINUTE, 0)
    timeOfNextUpdate.set(Calendar.SECOND, 0)

    // If already past 3am, set next update to 3am tomorrow.
    if (currentTime.after(timeOfNextUpdate)) {
      timeOfNextUpdate.add(Calendar.HOUR_OF_DAY, 24)
    }
    // If it is after 3am, this should have just incremented.
    val millisUntilNextupdate: Long = timeOfNextUpdate.getTimeInMillis - currentTime.getTimeInMillis
    val durationToNextUpdate: FiniteDuration = FiniteDuration(millisUntilNextupdate, MILLISECONDS)

    cancellable = Some(
      context.system.scheduler.schedule(
        durationToNextUpdate,
        24.hour,
        self,
        RecalculateStreetPriorityActor.Tick
      )(context.dispatcher)
    )
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
      Logger.info(s"Auto-scheduled recalculation of street priority starting at: $currentTimeStart")
      StreetEdgePriorityTable.recalculateStreetPriority
      val currentEndTime: String = dateFormatter.format(Calendar.getInstance(TIMEZONE).getTime)
      Logger.info(s"Street priority recalculation completed at: $currentEndTime")
  }

}

object RecalculateStreetPriorityActor {
  val Name = "recalculate-street-priority-actor"
  def props = Props(new RecalculateStreetPriorityActor)
  case object Tick
}
