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
 * A token is `<user id>.<HMAC-SHA256 of the user id>`, so a link works without signing in but can't be made up for
 * someone else, and nobody can walk the user ids. Tokens don't expire: a newsletter sits in inboxes for months, and
 * the worst a leaked token can do is unsubscribe its owner, who can opt back in from Settings.
 */
@Singleton
class NewsEmailTokenService @Inject() (config: Configuration) {
  // The application secret, which every city shares, so a link made by one city's export verifies in any city.
  private val key =
    SecretKeySpec(config.get[String]("play.http.secret.key").getBytes(StandardCharsets.UTF_8), "HmacSHA256")

  // Keyed to this purpose, so a signature made here can never pass as one of the image-serving signatures.
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
