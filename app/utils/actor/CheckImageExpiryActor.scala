package utils.actor
import controllers.LabelController
import java.text.SimpleDateFormat
import java.util.{Calendar, Locale, TimeZone}
import akka.actor.{Actor, Cancellable, Props}
import models.attribute.ConfigTable
import play.api.Logger
import scala.concurrent.duration._


class CheckImageExpiry extends Actor {
  private var cancellable: Option[Cancellable] = None
  val TIMEZONE = TimeZone.getTimeZone("UTC")

  override def preStart(): Unit = {
    super.preStart()
    // Get the number of hours later to run the code in this city. Used to stagger computation/resource use.
    val hoursOffset: Int = ConfigTable.getOffsetHours

    // If we want to update the street_edge_priority table at 12:15 am PDT every day, we need to figure out how much
    // time there is b/w now and the next 12:15 am, then we can set the update interval to be 24 hours. So we make a
    // calendar object for right now, and one for 12:15 am today. If it is after 12:15 am right now, we set the 12:15 am
    // object to be 12:15 am tomorrow. Then we get the time difference between the 12:15 am object and now.
    val currentTime: Calendar = Calendar.getInstance(TIMEZONE)
    val timeOfNextUpdate: Calendar = Calendar.getInstance(TIMEZONE)
    timeOfNextUpdate.set(Calendar.HOUR_OF_DAY, 7 + hoursOffset)
    timeOfNextUpdate.set(Calendar.MINUTE, 15)
    timeOfNextUpdate.set(Calendar.SECOND, 0)

    // If already past 12:15 am, set next update to 12:15 am tomorrow.
    if (currentTime.after(timeOfNextUpdate)) {
      timeOfNextUpdate.add(Calendar.HOUR_OF_DAY, 24)
    }
    // If it is after 12:15 am, this should have just incremented.
    val millisUntilNextUpdate: Long = timeOfNextUpdate.getTimeInMillis - currentTime.getTimeInMillis
    val durationToNextUpdate: FiniteDuration = FiniteDuration(millisUntilNextUpdate, MILLISECONDS)

    cancellable = Some(
      context.system.scheduler.schedule(
        durationToNextUpdate,
        24.hour,
        self,
        CheckImageExpiry.Tick
      )(context.dispatcher)
    )
  }

  override def postStop(): Unit = {
    cancellable.foreach(_.cancel())
    cancellable = None
    super.postStop()
  }

  def receive: Receive = {
    case CheckImageExpiry.Tick =>
      val dateFormatter = new SimpleDateFormat("EE MMM dd HH:mm:ss zzz yyyy", Locale.US)
      dateFormatter.setTimeZone(TIMEZONE)

      val currentTimeStart: String = dateFormatter.format(Calendar.getInstance(TIMEZONE).getTime)
      Logger.info(s"Checking image expiry started at: $currentTimeStart")
      LabelController.checkForGSVImagery()
      val currentEndTime: String = dateFormatter.format(Calendar.getInstance(TIMEZONE).getTime)
      Logger.info(s"Checking image expiry completed at: $currentEndTime")
  }
}

object CheckImageExpiry {
  val Name = "check-image-expiry-actor"
  def props = Props(new CheckImageExpiry)
  case object Tick
}
