package controllers.base

import ch.qos.logback.classic.{Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Sink, Source}
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import org.slf4j.LoggerFactory
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder

import scala.concurrent.{Await, ExecutionContext}
import scala.concurrent.duration.DurationInt
import scala.jdk.CollectionConverters._

/**
 * Pins what a streamed API response logs when it ends early: a client that stops reading (or a proxy/idle timeout)
 * cancels the stream, which looks like a normal completion to Pekko, so it has to be told apart on purpose (#4161).
 */
class StreamLoggingSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer    = app.materializer
  implicit lazy val ec: ExecutionContext = app.actorSystem.dispatcher

  /** The smallest controller that can call the protected helper. */
  private class Probe extends CustomBaseController(app.injector.instanceOf[CustomControllerComponents]) {
    def wrap(source: Source[String, _]): Source[String, _] = logStreamFailures(source, "probe")
  }

  private val rows: Source[String, _] = Source(1 to 100).map(_.toString)

  /** @return What the probe controller logged while `body` ran. */
  private def logged(body: Probe => Any): Seq[String] = {
    val logger   = LoggerFactory.getLogger(classOf[Probe]).asInstanceOf[LogbackLogger]
    val appender = new ListAppender[ILoggingEvent]()
    appender.start()
    logger.addAppender(appender)
    try {
      body(new Probe)
      Thread.sleep(500) // The termination callback runs on another thread after the stream ends.
    } finally { val _ = logger.detachAppender(appender) }
    appender.list.asScala.map(_.getFormattedMessage).toSeq
  }

  "logStreamFailures" should {
    "log nothing when every row is sent" in {
      logged(p => Await.result(p.wrap(rows).runWith(Sink.ignore), 10.seconds)) mustBe empty
    }

    "warn with how far it got when the client stops reading early" in {
      val messages = logged(p => Await.result(p.wrap(rows).take(5).runWith(Sink.ignore), 10.seconds))
      messages must have size 1
      messages.head must include("cut off")
      messages.head must include("5 rows")
    }

    "log an error when the source itself fails" in {
      val broken   = rows.concat(Source.failed(new RuntimeException("db went away")))
      val messages = logged(p => Await.ready(p.wrap(broken).runWith(Sink.ignore), 10.seconds))
      messages must have size 1
      messages.head must include("failed mid-flight")
    }
  }
}
