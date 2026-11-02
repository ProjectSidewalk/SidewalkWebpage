package service

import play.api.Configuration

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import javax.inject.{Inject, Singleton}

/**
 * Signs and checks the tokens in the newsletter's unsubscribe links (#5864).
 *
 * A token is `<user id>.<HMAC-SHA256 of the user id>`: a link works without signing in, can't be forged for someone
 * else, and gives away no other user ids. Tokens don't expire, since a newsletter sits in inboxes for months and a
 * leaked token can only unsubscribe its owner, who can opt back in from Settings.
 */
@Singleton
class NewsEmailTokenService @Inject() (config: Configuration) {
  // The app secret is shared by every city, so a link from one city's export verifies in any city.
  private val key =
    SecretKeySpec(config.get[String]("play.http.secret.key").getBytes(StandardCharsets.UTF_8), "HmacSHA256")

  // The purpose prefix keeps these signatures from ever passing as image-serving ones.
  private def hmac(userId: String): String = {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(key)
    Base64.getUrlEncoder.withoutPadding.encodeToString(mac.doFinal(s"news-unsubscribe:$userId".getBytes("UTF-8")))
  }

  /** @return The unsubscribe token for this user, safe to put in a URL as-is. */
  def token(userId: String): String = s"$userId.${hmac(userId)}"

  /**
   * @param token A token from an unsubscribe link.
   * @return      The user id the token was made for, or None if it was altered or made up.
   */
  def userId(token: String): Option[String] = token.lastIndexOf('.') match {
    case -1    => None
    case split =>
      val (userId, signature) = (token.take(split), token.drop(split + 1))
      // A constant-time compare, so response timing gives away nothing about the expected signature.
      val matches =
        MessageDigest.isEqual(hmac(userId).getBytes(StandardCharsets.UTF_8), signature.getBytes(StandardCharsets.UTF_8))
      Option.when(userId.nonEmpty && matches)(userId)
  }
}
