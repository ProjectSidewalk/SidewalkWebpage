package utils.actor

import java.text.SimpleDateFormat
import java.sql.Timestamp
import java.util.{Calendar, Locale, TimeZone}
import java.time.Instant
import javax.inject.Inject

import akka.actor.{Actor, Cancellable, Props}
import models.services.{AuthTokenService, AuthTokenServiceImpl}
import models.daos.slick.AuthTokenDAOSlick
import play.api.Logger

import scala.concurrent.duration._
import play.api.libs.concurrent.Execution.Implicits._

// Template code comes from this helpful StackOverflow post:
// https://stackoverflow.com/questions/48977612/how-to-schedule-complex-tasks-using-scala-play-2-3/48977937?noredirect=1#comment84961371_48977937
class AuthTokenCleanerActor extends Actor {

  private var cancellable: Option[Cancellable] = None
  val TIMEZONE = TimeZone.getTimeZone("UTC")
  val authTokenService : AuthTokenService = new AuthTokenServiceImpl(new AuthTokenDAOSlick())

  override def preStart(): Unit = {
    super.preStart()

    // If we want to clean the auth_tokens table at 2:00am every day, we need to figure out how much time there
    // is b/w now and the next 2:00am, then we can set the update interval to be 24 hours. So we make a calendar object
    // for right now, and one for 2:00am today. If it is after 2:00am right now, we set the 2:00am object to be 2:00am
    // tomorrow. Then we get the time difference between the 2:00am object and now.
    val currentTime: Calendar = Calendar.getInstance(TIMEZONE)
    var timeOfNextUpdate: Calendar = Calendar.getInstance(TIMEZONE)
    timeOfNextUpdate.set(Calendar.HOUR_OF_DAY, 9)
    timeOfNextUpdate.set(Calendar.MINUTE, 0)
    timeOfNextUpdate.set(Calendar.SECOND, 0)

    // If already past 2:00am, set next update to 2:00am tomorrow.
    if (currentTime.after(timeOfNextUpdate)) {
      timeOfNextUpdate.add(Calendar.HOUR_OF_DAY, 24)
    }
    // If it is after 2:00am, this should have just incremented.
    val millisUntilNextupdate: Long = timeOfNextUpdate.getTimeInMillis - currentTime.getTimeInMillis
    val durationToNextUpdate: FiniteDuration = FiniteDuration(millisUntilNextupdate, MILLISECONDS)

    // Run auth token cleaner every 24 hours
    cancellable = Some(
      context.system.scheduler.schedule(
        durationToNextUpdate,
        24.hour,
        self,
        AuthTokenCleanerActor.Tick
      )(context.dispatcher)
    )
  }

  override def postStop(): Unit = {
    cancellable.foreach(_.cancel())
    cancellable = None
    super.postStop()
  }

  def receive: Receive = {
    case AuthTokenCleanerActor.Tick =>
      val dateFormatter = new SimpleDateFormat("EE MMM dd HH:mm:ss zzz yyyy", Locale.US)
      dateFormatter.setTimeZone(TIMEZONE)

      val currentTimeStart: String = dateFormatter.format(Calendar.getInstance(TIMEZONE).getTime)
      Logger.info(s"Auto-scheduled removal of expired auth tokens starting at: $currentTimeStart")

      authTokenService.clean

      val currentEndTime: String = dateFormatter.format(Calendar.getInstance(TIMEZONE).getTime)
      Logger.info(s"Removal of expired auth tokens completed at: $currentEndTime")
  }
}

object AuthTokenCleanerActor {
  val Name = "auth-token-cleaner-actor"
  def props = Props(new AuthTokenCleanerActor)
  case object Tick
}
