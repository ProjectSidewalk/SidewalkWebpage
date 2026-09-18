package service

import com.google.inject.ImplementedBy
import models.pano.{MapillaryAllowedSource, MapillaryAllowedSourceTable}
import models.utils.MyPostgresProfile
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{JsArray, Json}
import play.api.libs.ws.WSClient
import play.api.{Configuration, Logger}

import javax.inject.{Inject, Singleton}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

@ImplementedBy(classOf[MapillarySourceServiceImpl])
trait MapillarySourceService {

  /**
   * The Mapillary usernames this deployment is restricted to (#5407). Empty means unfiltered.
   *
   * The one accessor every consumer reads: the pages that hand a pano viewer its options, and the nightly
   * imagery-age poll. Cached, because it is read on every page load and changes only when an admin edits the list.
   */
  def getAllowedCreators: Future[Seq[String]]

  /**
   * Every allowed source paired with the username of the admin who added it (None when the onboarding tooling seeded
   * it), for the admin list. Uncached: the admin page is rarely loaded, and must show a just-made edit.
   */
  def getAllowedSources: Future[Seq[(MapillaryAllowedSource, Option[String])]]

  /**
   * Adds a creator to the allowlist after checking Mapillary actually has 360 imagery under that username.
   *
   * @param username    What the admin typed; trimmed here.
   * @param adminUserId The admin adding it.
   */
  def addCreator(username: String, adminUserId: String): Future[MapillarySourceService.AddOutcome]

  /** Removes a creator from the allowlist, returning the number of rows deleted (0 or 1). */
  def removeCreator(username: String): Future[Int]
}

object MapillarySourceService {

  /** Outcome of an admin's attempt to add a creator to the allowlist. */
  sealed trait AddOutcome

  /** The creator was verified and added. */
  case object Added extends AddOutcome

  /** The creator was already listed, so nothing changed. */
  case object AlreadyListed extends AddOutcome

  /** The text can't be a Mapillary username, so Mapillary was never asked. */
  case object InvalidUsername extends AddOutcome

  /**
   * Mapillary answered, and has no 360 imagery under that username. Refused rather than accepted, because a listed
   * creator with no panos restricts the deployment to nothing: every street would read as having no imagery.
   */
  case object NoPanosFound extends AddOutcome

  /** Mapillary couldn't be asked (no token, auth failure, rate limit, network), so the username is unverified. */
  case class VerificationFailed(reason: String) extends AddOutcome

  /**
   * Whether text could be a Mapillary username. Deliberately loose about which characters Mapillary allows -- the
   * Graph API check is what decides a username is real -- and strict only about what is safe and sane to store and
   * to put in a query string.
   */
  def isPlausibleUsername(username: String): Boolean = username.matches("[A-Za-z0-9_.-]{1,60}")

  /**
   * Whether a Mapillary image passes the creator restriction.
   *
   * Pure, so the rule is unit-testable without an HTTP stub, and shared so the nightly poll can't drift from it.
   * An empty allowlist admits everything: that is the unfiltered state every deployment starts in. Usernames compare
   * exactly, as Mapillary's own `creator_username` filter does.
   *
   * @param allowedCreators The deployment's allowlist.
   * @param creatorUsername The image's `creator.username`, or None when the API response carried no creator.
   */
  def creatorAllowed(allowedCreators: Seq[String], creatorUsername: Option[String]): Boolean =
    allowedCreators.isEmpty || creatorUsername.exists(allowedCreators.contains)

  private[service] val AllowedCreatorsCacheKey: String = "mapillaryAllowedCreators"
}

@Singleton
class MapillarySourceServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    cacheApi: AsyncCacheApi,
    ws: WSClient,
    mapillaryAllowedSourceTable: MapillaryAllowedSourceTable
)(implicit ec: ExecutionContext)
    extends MapillarySourceService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  import MapillarySourceService._

  private val logger = Logger(this.getClass)

  def getAllowedCreators: Future[Seq[String]] = {
    cacheApi.getOrElseUpdate[Seq[String]](AllowedCreatorsCacheKey) {
      db.run(mapillaryAllowedSourceTable.all)
        .map(_.filter(_.sourceType == MapillaryAllowedSource.Creator).map(_.sourceValue))
    }
  }

  def getAllowedSources: Future[Seq[(MapillaryAllowedSource, Option[String])]] =
    db.run(mapillaryAllowedSourceTable.allWithAdder)

  def addCreator(username: String, adminUserId: String): Future[AddOutcome] = {
    val trimmed = username.trim
    if (!isPlausibleUsername(trimmed)) Future.successful(InvalidUsername)
    else {
      creatorHasPanos(trimmed).flatMap {
        case Right(true) =>
          for {
            inserted <- db.run(mapillaryAllowedSourceTable.addCreator(trimmed, adminUserId))
            _        <- cacheApi.remove(AllowedCreatorsCacheKey)
          } yield if (inserted > 0) Added else AlreadyListed
        case Right(false) => Future.successful(NoPanosFound)
        case Left(reason) => Future.successful(VerificationFailed(reason))
      }
    }
  }

  def removeCreator(username: String): Future[Int] = {
    for {
      deleted <- db.run(mapillaryAllowedSourceTable.removeCreator(username.trim))
      _       <- cacheApi.remove(AllowedCreatorsCacheKey)
    } yield deleted
  }

  /**
   * Asks the Mapillary Graph API whether a username has any 360 imagery.
   *
   * @return Right(true/false) when Mapillary answered, Left(why) when it could not be asked or did not answer.
   */
  private def creatorHasPanos(username: String): Future[Either[String, Boolean]] = {
    config.getOptional[String]("mapillary-access-token") match {
      case None              => Future.successful(Left("No Mapillary access token is configured on this server."))
      case Some(accessToken) =>
        ws.url("https://graph.mapillary.com/images")
          .withQueryStringParameters(
            "creator_username" -> username,
            "is_pano"          -> "true",
            "limit"            -> "1",
            "fields"           -> "id"
          )
          .addHttpHeaders("Authorization" -> s"OAuth $accessToken")
          .withRequestTimeout(10.seconds)
          .get()
          .map { response =>
            response.status match {
              case 200 =>
                Try((Json.parse(response.body) \ "data").asOpt[JsArray]).toOption.flatten match {
                  case Some(images) => Right(images.value.nonEmpty)
                  case None         => Left("Mapillary returned a response without a data array.")
                }
              case other =>
                logger.info(s"Mapillary creator check for '$username' returned $other: ${response.body}")
                Left(s"Mapillary returned HTTP $other.")
            }
          }
          .recover { case e: Exception =>
            logger.warn(s"Mapillary creator check for '$username' failed.", e)
            Left("Mapillary could not be reached.")
          }
    }
  }
}
