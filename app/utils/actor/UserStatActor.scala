package utils.actor

import java.text.SimpleDateFormat
import java.util.{Calendar, Locale, TimeZone}
import akka.actor.{Actor, Cancellable, Props}
import models.user.UserStatTable
import play.api.Play.current
import play.api.{Logger, Play}
import java.sql.Timestamp
import java.time.Instant
import scala.concurrent.duration._

// Template code comes from this helpful StackOverflow post:
// https://stackoverflow.com/questions/48977612/how-to-schedule-complex-tasks-using-scala-play-2-3/48977937?noredirect=1#comment84961371_48977937
class UserStatActor extends Actor {

  private var cancellable: Option[Cancellable] = None
  val TIMEZONE = TimeZone.getTimeZone("UTC")

  override def preStart(): Unit = {
    super.preStart()
    for (cityId <- Play.configuration.getStringSeq("city-params.city-ids").get) {
      // Get the number of hours later to run the code in this city. Used to stagger computation/resource use.
      val hoursOffset: Int = Play.configuration.getInt(s"city-params.update-offset-hours.${cityId}").get

      // If we want to update the user_stat table at 12:30 am PDT every day, we need to figure out how much time there is
      // b/w now and the next 12:30 am, then we can set the update interval to be 24 hours. So we make a calendar object
      // for right now, and one for 12:30 am today. If it is after 12:30 am right now, we set the 12:30 am object to be
      // 12:30 am tomorrow. Then we get the time difference between the 12:30 am object and now.
      val currentTime: Calendar = Calendar.getInstance(TIMEZONE)
      val timeOfNextUpdate: Calendar = Calendar.getInstance(TIMEZONE)
      timeOfNextUpdate.set(Calendar.HOUR_OF_DAY, 7 + hoursOffset)
      timeOfNextUpdate.set(Calendar.MINUTE, 30)
      timeOfNextUpdate.set(Calendar.SECOND, 0)

      // If already past 12:30 am, set next update to 12:30 am tomorrow.
      if (currentTime.after(timeOfNextUpdate)) {
        timeOfNextUpdate.add(Calendar.HOUR_OF_DAY, 24)
      }
      // If it is after 12:30 am, this should have just incremented.
      val millisUntilNextupdate: Long = timeOfNextUpdate.getTimeInMillis - currentTime.getTimeInMillis
      val durationToNextUpdate: FiniteDuration = FiniteDuration(millisUntilNextupdate, MILLISECONDS)

      cancellable = Some(
        context.system.scheduler.schedule(
          durationToNextUpdate,
          24.hour,
          self,
          UserStatActor.Tick(cityId)
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
    case UserStatActor.Tick(cityId) =>
      val dateFormatter = new SimpleDateFormat("EE MMM dd HH:mm:ss zzz yyyy", Locale.US)
      dateFormatter.setTimeZone(TIMEZONE)

      val currentTimeStart: String = dateFormatter.format(Calendar.getInstance(TIMEZONE).getTime)
      Logger.info(s"Auto-scheduled computation of user stats starting at: $currentTimeStart")
      // Update stats for anyone who audited in past 36 hours.
      val msCutoff: Long = 36 * 3600000L
      val cutoffTime: Timestamp = new Timestamp(Instant.now.toEpochMilli - msCutoff)
      UserStatTable.updateUserStatTable(cutoffTime, cityId)
      val currentEndTime: String = dateFormatter.format(Calendar.getInstance(TIMEZONE).getTime)
      Logger.info(s"Updating user stats completed at: $currentEndTime")
  }
}

object UserStatActor {
  val Name = "user-stats-actor"
  def props = Props(new UserStatActor)
  case class Tick(cityId: String)
}
