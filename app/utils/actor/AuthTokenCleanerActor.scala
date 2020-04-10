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

    // Run auth token cleaner every 5 minutes
    cancellable = Some(
      context.system.scheduler.schedule(
        1.second,
        5.minutes,
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
