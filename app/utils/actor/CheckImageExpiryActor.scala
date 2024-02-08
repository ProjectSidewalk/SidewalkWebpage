package utils.actor
import controllers.LabelController
import java.text.SimpleDateFormat
import java.util.{Calendar, Locale, TimeZone}
import akka.actor.{Actor, Cancellable, Props}
import scala.concurrent.duration._


class CheckImageExpiry extends Actor {
  private var cancellable: Option[Cancellable] = None
  val TIMEZONE = TimeZone.getTimeZone("UTC")

  override def preStart(): Unit = {
    super.preStart()

    // every night
    val currentTime: Calendar = Calendar.getInstance(TIMEZONE)
    val timeOfNextNight: Calendar = Calendar.getInstance(TIMEZONE)
    timeOfNextNight.set(Calendar.HOUR_OF_DAY, 0)
    timeOfNextNight.set(Calendar.MINUTE, 0)
    timeOfNextNight.set(Calendar.SECOND, 0)

    // If already past 12:30 am, set next update to 12:30 am tomorrow.
    if (currentTime.after(timeOfNextNight)) {
      timeOfNextNight.add(Calendar.HOUR_OF_DAY, 24)
    }

    val millisUntilNextupdate: Long = timeOfNextNight.getTimeInMillis - currentTime.getTimeInMillis
    val durationToNextUpdate: FiniteDuration = FiniteDuration(millisUntilNextupdate, MILLISECONDS)

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
      println(s"Nightly task started at: $currentTimeStart")
      LabelController.test()
      val currentEndTime: String = dateFormatter.format(Calendar.getInstance(TIMEZONE).getTime)
      println(s"Nightly task completed at: $currentEndTime")
  }
}

object CheckImageExpiry {
  val Name = "CheckImageExpiry"
  def props = Props(new CheckImageExpiry)
  case object Tick
}
