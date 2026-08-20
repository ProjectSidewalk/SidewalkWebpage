package service

import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.classic.{Level, Logger => LogbackLogger}
import ch.qos.logback.core.read.ListAppender
import org.scalatestplus.play.PlaySpec
import org.slf4j.LoggerFactory

import scala.jdk.CollectionConverters._

/**
 * The one thing standing between a destroyed file and nobody finding out for six days (#4925).
 *
 * Its whole contract is what it says and how often — and both failure modes are silent. Announcing every request
 * buries the loss in its own noise; announcing nothing is indistinguishable from health, which is the state #4926
 * exists to end. So the log lines themselves are the assertions here.
 */
class LostMediaLogSpec extends PlaySpec {

  /**
   * Runs `f` against a fresh log with an appender attached, and returns everything it logged.
   *
   * The level is forced rather than inherited so the spec pins the code's own severity choice instead of whatever
   * the ambient logback config happens to permit.
   */
  private def captured(f: LostMediaLog => Unit): Seq[ILoggingEvent] = {
    val logger   = LoggerFactory.getLogger(classOf[LostMediaLog]).asInstanceOf[LogbackLogger]
    val appender = new ListAppender[ILoggingEvent]
    val original = logger.getLevel
    appender.start()
    logger.addAppender(appender)
    logger.setLevel(Level.WARN)
    // Detach from the console for the duration: these cases deliberately report thousands of losses, and a suite that
    // buries its own output in fake alarms is the noise problem this class exists to avoid, one level up.
    logger.setAdditive(false)
    try f(new LostMediaLog)
    finally {
      logger.setAdditive(true)
      logger.setLevel(original)
      logger.detachAppender(appender)
      appender.stop()
    }
    appender.list.asScala.toSeq
  }

  "LostMediaLog" should {
    "say what was lost and where its bytes should have been" in {
      val events = captured(_.reportMissing("story_media", "331", "/srv/media/chicago-il/story_331.jpg", true))
      events must have size 1
      val message = events.head.getFormattedMessage
      message must include("story_media")
      message must include("331")
      message must include("/srv/media/chicago-il/story_331.jpg")
    }

    "announce a lost item once, however many times it is requested" in {
      // One popular page re-requesting a lost file would otherwise write the same line thousands of times and bury
      // the event in its own noise.
      val events = captured { log =>
        (1 to 25).foreach(_ => log.reportMissing("story_media", "331", "/srv/media/story_331.jpg", true))
      }
      events must have size 1
    }

    "announce every distinct item, so a whole directory going missing reads as a whole directory" in {
      val events = captured { log =>
        Seq("331", "332", "333").foreach(id => log.reportMissing("story_media", id, s"/srv/media/$id.jpg", true))
      }
      events.map(_.getFormattedMessage).mkString(" ") must include("333")
      events must have size 3
    }

    "keep kinds apart, since a story and a pano can share an id" in {
      val events = captured { log =>
        log.reportMissing("story_media", "1", "/srv/media/story_1.jpg", irreplaceable = true)
        log.reportMissing("pano", "1", "/srv/panos/1.jpg", irreplaceable = true)
      }
      events must have size 2
    }

    "log content no rebuild can recreate at ERROR, and rebuildable content at WARN" in {
      // The tiering is the same call PersistentMediaDirCheck makes, and it is what decides whether anyone is paged.
      val error = captured(_.reportMissing("pano", "abc", "/srv/panos/abc.jpg", irreplaceable = true))
      error.head.getLevel mustBe Level.ERROR
      val warn = captured(_.reportMissing("crop", "CurbRamp/7", "/srv/crops/crop_7.png", irreplaceable = false))
      warn.head.getLevel mustBe Level.WARN
    }

    "let a still-lost item announce itself again once it has been crowded out" in {
      // The tracking set is bounded, because a dead mount can make every pano in a city report at once. Eviction
      // eventually re-announcing a loss is the right way for that bound to fail; going permanently quiet is not.
      val events = captured { log =>
        log.reportMissing("pano", "first", "/srv/panos/first.jpg", irreplaceable = true)
        (1 to 5000).foreach(i => log.reportMissing("pano", s"filler$i", s"/srv/panos/$i.jpg", irreplaceable = true))
        log.reportMissing("pano", "first", "/srv/panos/first.jpg", irreplaceable = true)
      }
      events.last.getFormattedMessage must include("pano first ")
    }
  }
}
