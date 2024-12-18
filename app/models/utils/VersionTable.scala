package models.utils

import com.google.inject.ImplementedBy

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import java.net.URL
import java.sql.Timestamp
import java.util.Base64
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.{Configuration}

import javax.inject.{Inject, Singleton}
import scala.concurrent.Future

case class Version(versionId: String, versionStartTime: Timestamp, description: Option[String])

class VersionTableDef(tag: Tag) extends Table[Version](tag, "version") {
  def versionId: Rep[String] = column[String]("version_id", O.PrimaryKey)
  def versionStartTime: Rep[Timestamp] = column[Timestamp]("version_start_time")
  def description: Rep[Option[String]] = column[Option[String]]("description")

  def * = (versionId, versionStartTime, description) <> ((Version.apply _).tupled, Version.unapply)
}

@ImplementedBy(classOf[VersionTable])
trait VersionTableRepository {
  def currentVersionId(): Future[String]
  def currentVersionTimestamp(): Future[Timestamp]
}

@Singleton
class VersionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider, config: Configuration) extends VersionTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val versions = TableQuery[VersionTableDef]

  // Grab secret from ENV variable.
  val secretKeyString: String = config.getString("google-maps-secret").get

  // Decode secret key as Byte[].
  val secretKey: Array[Byte] = Base64.getDecoder().decode(secretKeyString.replace('-', '+').replace('_', '/'))

  // Get an HMAC-SHA1 signing key from the raw key bytes.
  val sha1Key: SecretKeySpec = new SecretKeySpec(secretKey, "HmacSHA1")

  /**
    * Returns current version ID.
    */
  def currentVersionId(): Future[String] = {
    db.run(versions.sortBy(_.versionStartTime.desc).map(_.versionId).result.head)
  }

  /**
    * Returns timestamp of most recent update.
    */
  def currentVersionTimestamp(): Future[Timestamp] = {
    db.run(versions.sortBy(_.versionStartTime.desc).map(_.versionStartTime).result.head)
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

    // Get an HMAC-SHA1 Mac instance and initialize it with the HMAC-SHA1 key.
    val mac: Mac = Mac.getInstance("HmacSHA1")
    mac.init(sha1Key)

    // Compute the binary signature for the request.
    val sigBytes: Array[Byte] = mac.doFinal(resource.getBytes())

    // Base 64 encode the binary signature and convert the signature to 'web safe' base 64.
    val signature: String = Base64.getEncoder().encodeToString(sigBytes).replace('+', '-').replace('/', '_')

    // Return signed url.
    urlString + "&signature=" + signature
  } 
}
