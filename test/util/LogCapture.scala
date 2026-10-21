package util

import ch.qos.logback.classic.Logger as LogbackLogger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.slf4j.{Logger, LoggerFactory}

import scala.jdk.CollectionConverters.*

/** Lets a spec see what was logged while it ran. */
object LogCapture {

  /**
   * Runs `body` while recording what is logged under `loggerName` (everything, by default). `body` gets a function
   * that returns the messages logged so far.
   */
  def capturing[T](loggerName: String = Logger.ROOT_LOGGER_NAME)(body: (() => Seq[String]) => T): T = {
    val logger   = LoggerFactory.getLogger(loggerName).asInstanceOf[LogbackLogger]
    val appender = ListAppender[ILoggingEvent]()
    appender.start()
    logger.addAppender(appender)
    // Logging happens on other threads, and the appender holds this same lock while it adds a line.
    def messages(): Seq[String] = appender.synchronized(appender.list.asScala.map(_.getFormattedMessage).toSeq)
    try body(messages)
    finally { val _ = logger.detachAppender(appender) }
  }
}
