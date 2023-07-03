package utils.actor

import java.text.SimpleDateFormat
import java.util.{Calendar, Locale, TimeZone}
import akka.actor.{Actor, Cancellable, Props}
import controllers.helper.AttributeControllerHelper
import play.api.Play.current
import play.api.{Logger, Play}
import models.attribute.ConfigTable
import scala.concurrent.duration._

// Template code comes from this helpful StackOverflow post:
// https://stackoverflow.com/questions/48977612/how-to-schedule-complex-tasks-using-scala-play-2-3/48977937?noredirect=1#comment84961371_48977937
class ClusterLabelAttributesActor extends Actor {

  private var cancellable: Option[Cancellable] = None
  val TIMEZONE = TimeZone.getTimeZone("UTC")

  override def preStart(): Unit = {
    super.preStart()
    // Get the number of hours later to run the code in this city. Used to stagger computation/resource use.
    val cityId: String = Play.configuration.getString("city-id").get
    val hoursOffset: Int = ConfigTable.getOffsetHours

    // If we want to update the cluster table at 1 am PDT every day, we need to figure out how much time there is b/w
    // now and the next 1 am, then we can set the update interval to be 24 hours. So we make a calendar object for right
    // now, and one for 1 am today. If it is after 1 am right now, we set the 1 am object to be 1 am tomorrow. Then we
    // get the time difference between the 1 am object and now.
    val currentTime: Calendar = Calendar.getInstance(TIMEZONE)
    val timeOfNextUpdate: Calendar = Calendar.getInstance(TIMEZONE)
    timeOfNextUpdate.set(Calendar.HOUR_OF_DAY, 8 + hoursOffset)
    timeOfNextUpdate.set(Calendar.MINUTE, 0)
    timeOfNextUpdate.set(Calendar.SECOND, 0)

    // If already past 1 am, set next update to 1 am tomorrow.
    if (currentTime.after(timeOfNextUpdate)) {
      timeOfNextUpdate.add(Calendar.HOUR_OF_DAY, 24)
    }
    // If it is after 1 am, this should have just incremented.
    val millisUntilNextupdate: Long = timeOfNextUpdate.getTimeInMillis - currentTime.getTimeInMillis
    val durationToNextUpdate: FiniteDuration = FiniteDuration(millisUntilNextupdate, MILLISECONDS)

    cancellable = Some(
      context.system.scheduler.schedule(
        durationToNextUpdate,
        24.hour,
        self,
        ClusterLabelAttributesActor.Tick
      )(context.dispatcher)
    )
  }

  override def postStop(): Unit = {
    cancellable.foreach(_.cancel())
    cancellable = None
    super.postStop()
  }

  def receive: Receive = {
    case ClusterLabelAttributesActor.Tick =>
      val dateFormatter = new SimpleDateFormat("EE MMM dd HH:mm:ss zzz yyyy", Locale.US)
      dateFormatter.setTimeZone(TIMEZONE)

      val currentTimeStart: String = dateFormatter.format(Calendar.getInstance(TIMEZONE).getTime)
      Logger.info(s"Auto-scheduled clustering of label attributes starting at: $currentTimeStart")
      AttributeControllerHelper.runClustering("both")
      val currentEndTime: String = dateFormatter.format(Calendar.getInstance(TIMEZONE).getTime)
      Logger.info(s"Label attribute clustering completed at: $currentEndTime")
  }
}

object ClusterLabelAttributesActor {
  val Name = "cluster-label-attributes-actor"
  def props = Props(new ClusterLabelAttributesActor)
  case object Tick
}
