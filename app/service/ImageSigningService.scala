package service

import play.api.Configuration

import java.time.Instant
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import javax.inject.{Inject, Singleton}

/**
 * Signs and verifies time-limited image-serving URLs to prevent unauthorized scraping.
 *
 * Uses HMAC-SHA256 over the path and expiry epoch so that a signature is only valid for the resource for a limited
 * time, to guard against bulk scraping. Safe to embed in server-rendered JSON responses and will expire on their own.
 */
@Singleton
class ImageSigningService @Inject() (config: Configuration) {
  private val secret        = config.get[String]("image.signing.secret")
  private val ExpirySeconds = 3600 // 60 minutes

  private def hmac(data: String): String = {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(new SecretKeySpec(secret.getBytes("UTF-8"), "HmacSHA256"))
    Base64.getUrlEncoder.withoutPadding.encodeToString(mac.doFinal(data.getBytes("UTF-8")))
  }

  /**
   * Returns the given path with ?exp=<epoch>&sig=<hmac> appended.
   * @param path URL path to sign (e.g. "/backupImage/abc123").
   */
  def signedUrl(path: String): String = {
    val exp = Instant.now.getEpochSecond + ExpirySeconds
    s"$path?exp=$exp&sig=${hmac(s"$path:$exp")}"
  }

  /**
   * Returns true if the signature is valid for the given path and the URL has not yet expired.
   * @param path The request path, without query string (e.g. "/backupImage/myPanoId").
   * @param exp  The expiry epoch second from the query string.
   * @param sig  The HMAC signature from the query string.
   */
  def verify(path: String, exp: Long, sig: String): Boolean =
    Instant.now.getEpochSecond <= exp && sig == hmac(s"$path:$exp")
}
