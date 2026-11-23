package service

import com.typesafe.config.ConfigFactory
import play.api.libs.ws.ahc.{AhcConfigBuilder, AhcWSClientConfigFactory}
import util.SidewalkSpec

/**
 * What our outbound HTTPS client is set up to offer, built from the real `application.conf` (#6033). Overpass only
 * accepts TLS 1.3, and both `play.ws.ssl` settings have to say so: with either one left at TLS 1.2, the client drops
 * TLS 1.3 from this list and the connection is refused.
 */
class OutboundTlsSpec extends SidewalkSpec {

  "The outbound HTTPS client" should {
    "offer TLS 1.3 first, with TLS 1.2 behind it for servers that have not moved yet" in {
      val clientConfig = AhcConfigBuilder(AhcWSClientConfigFactory.forConfig(ConfigFactory.load())).build()
      clientConfig.getEnabledProtocols.toSeq mustBe Seq("TLSv1.3", "TLSv1.2")
    }
  }
}
