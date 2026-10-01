package controllers

import org.scalatest.concurrent.Eventually
import org.scalatest.time.{Seconds, Span}
import org.scalatestplus.play.guice.GuiceOneServerPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{LogCapture, SidewalkSpec}

import java.net.Socket
import java.nio.charset.StandardCharsets.UTF_8
import scala.util.Using

/**
 * Pins that a request too broken to parse (what security scanners send) logs nothing, while the server's other
 * warnings still do (#5617). Needs a real server: `route()` skips the layer that parses raw requests.
 */
class ScannerNoiseLoggingSpec extends SidewalkSpec with GuiceOneServerPerSuite with Eventually {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  /** Sends raw bytes to the test server and returns the first line of its answer. */
  private def statusLineFor(rawRequest: String): String =
    Using.resource(Socket("localhost", port)) { socket =>
      socket.setSoTimeout(5000)
      socket.getOutputStream.write(rawRequest.getBytes(UTF_8))
      socket.getOutputStream.flush()
      scala.io.Source.fromInputStream(socket.getInputStream, UTF_8.name).getLines().next()
    }

  "The server's log" should {
    "skip an unparseable request but keep the server's other warnings" in {
      LogCapture.capturing() { messages =>
        statusLineFor("BOGUS / HTTP/1.1\r\nHost: localhost\r\n\r\n") must startWith("HTTP/1.1 501")

        // Pekko logs in order on another thread, so once this warning shows up the bad request's line would have too.
        app.actorSystem.log.warning("probe warning")
        eventually(timeout(Span(5, Seconds)))(messages() must contain("probe warning"))
        messages().filter(_.contains("Illegal request")) mustBe empty
      }
    }
  }
}
