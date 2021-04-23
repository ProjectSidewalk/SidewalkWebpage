package models.user

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import java.net.URL
import java.sql.Timestamp
import java.util.Base64
import models.utils.MyPostgresDriver.simple._
import play.api.Play
import play.api.Play.current

case class Version(versionId: String, versionStartTime: Timestamp, description: Option[String])

class VersionTable(tag: Tag) extends Table[Version](tag, Some("sidewalk"), "version") {
  def versionId = column[String]("version_id", O.PrimaryKey)
  def versionStartTime = column[Timestamp]("version_start_time", O.NotNull)
  def description = column[Option[String]]("description")

  def * = (versionId, versionStartTime, description) <> ((Version.apply _).tupled, Version.unapply)
}

/**
  * Data access object for the version table.
  */
object VersionTable {
  val db = play.api.db.slick.DB
  val versions = TableQuery[VersionTable]

  // Grab secret from ENV variable.
  val secretKeyString: String = Play.configuration.getString("google-maps-secret").get

  // Decode secret key as Byte[].
  val secretKey: Array[Byte] = Base64.getDecoder().decode(secretKeyString.replace('-', '+').replace('_', '/'))

  // Get an HMAC-SHA1 signing key from the raw key bytes.
  val sha1Key: SecretKeySpec = new SecretKeySpec(secretKey, "HmacSHA1")

  // Get an HMAC-SHA1 Mac instance and initialize it with the HMAC-SHA1 key.
  val mac: Mac = Mac.getInstance("HmacSHA1")
  mac.init(sha1Key)

  /**
    * Returns current version ID.
    */
  def currentVersionId(): String = db.withSession { implicit session =>
    versions.sortBy(_.versionStartTime.desc).first.versionId
  }

  /**
    * Returns timestamp of most recent update.
    */
  def currentVersionTimestamp(): String = db.withSession { implicit session =>
    versions.sortBy(_.versionStartTime.desc).first.versionStartTime.toString
  }

  /**
   * Signs a Google Maps request using a signing secret.
   * https://developers.google.com/maps/documentation/maps-static/get-api-key#dig-sig-manual
   */
  def signUrl(urlString: String): String = {
    // Convert to Java URL for easy parsing of URL parts.
    val url: URL = new URL(urlString)

    // Gets everything but URL protocol and host that we want to sign.
    val resource: String = url.getPath() + '?' + url.getQuery()

    // Compute the binary signature for the request.
    val sigBytes: Array[Byte] = mac.doFinal(resource.getBytes())

    // Base 64 encode the binary signature and convert the signature to 'web safe' base 64.
    val signature: String = Base64.getEncoder().encodeToString(sigBytes).replace('+', '-').replace('/', '_')

    // Return signed url.
    urlString + "&signature=" + signature
  } 
}
