package actor

import java.time.format.DateTimeFormatter
import java.time.{LocalDateTime, ZoneId}
import java.util.Locale

object ActorUtils {
  val dateFormatter: DateTimeFormatter = DateTimeFormatter
    .ofPattern("EE MMM dd HH:mm:ss zzz yyyy")
    .withLocale(Locale.US)
    .withZone(ZoneId.of("UTC"))

  def getTimeToNextUpdate(hourOfUpdate: Int, minuteOfUpdate: Int, hoursOffset: Int): java.time.Duration = {
    val now: LocalDateTime         = LocalDateTime.now(ZoneId.of("America/Los_Angeles"))
    val todayHours: Int            = Math.floorMod(hourOfUpdate + hoursOffset, 24)
    val todayTarget: LocalDateTime = now.withHour(todayHours).withMinute(minuteOfUpdate).withSecond(0)
    val nextRun: LocalDateTime     = if (now.isAfter(todayTarget)) todayTarget.plusDays(1) else todayTarget
    java.time.Duration.between(now, nextRun)
  }
}
