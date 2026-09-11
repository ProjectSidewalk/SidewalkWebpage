package controllers.base

import ch.qos.logback.classic.{Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Sink, Source}
import org.scalatest.Assertion
import org.scalatest.concurrent.Eventually
import org.scalatest.time.{Seconds, Span}
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import org.slf4j.LoggerFactory
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder

import scala.concurrent.{Await, ExecutionContext}
import scala.concurrent.duration.DurationInt
import scala.jdk.CollectionConverters._

/**
 * Pins what a streamed response logs when it ends early: to Pekko a client that stops reading looks like a normal
 * finish, so telling the two apart is deliberate work (#4161).
 */
class StreamLoggingSpec extends PlaySpec with GuiceOneAppPerSuite with Eventually {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer    = app.materializer
  implicit lazy val ec: ExecutionContext = app.actorSystem.dispatcher

  /** The smallest controller that can call the protected helper. */
  private class Probe extends CustomBaseController(app.injector.instanceOf[CustomControllerComponents]) {
    def wrap(source: Source[String, _]): Source[String, _] = logStreamFailures(source, "probe")
  }

  private val rows: Source[String, _] = Source(1 to 100).map(_.toString)

  /** Runs `body` with the probe's log captured, then retries `check` on it: the logging runs on another thread. */
  private def logged(body: Probe => Any)(check: Seq[String] => Assertion): Unit = {
    val logger   = LoggerFactory.getLogger(classOf[Probe]).asInstanceOf[LogbackLogger]
    val appender = new ListAppender[ILoggingEvent]()
    appender.start()
    logger.addAppender(appender)
    try {
      body(new Probe)
      val _ = eventually(timeout(Span(5, Seconds)))(check(appender.list.asScala.map(_.getFormattedMessage).toSeq))
    } finally { val _ = logger.detachAppender(appender) }
  }

  "logStreamFailures" should {
    "log nothing for a full send, and the row count for a cut-off" in {
      // One capture for both, so the cut-off's message proves the logging had time to run for the full send too.
      logged { p =>
        Await.result(p.wrap(rows).runWith(Sink.ignore), 10.seconds)
        Await.result(p.wrap(rows).take(5).runWith(Sink.ignore), 10.seconds)
      } { messages =>
        messages must have size 1
        messages.head must include("cut off")
        messages.head must include("5 rows")
      }
    }

    "log an error when the source itself fails" in {
      val broken = rows.concat(Source.failed(new RuntimeException("db went away")))
      logged(p => Await.ready(p.wrap(broken).runWith(Sink.ignore), 10.seconds)) { messages =>
        messages must have size 1
        messages.head must include("failed mid-flight")
      }
    }
  }
}
