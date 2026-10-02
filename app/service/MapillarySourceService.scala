package service

import com.google.inject.ImplementedBy
import models.pano.{MapillarySource, MapillarySourceMode, MapillarySourceTable}
import models.utils.{ConfigTable, MyPostgresProfile}
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{JsArray, JsValue, Json, Writes}
import play.api.libs.ws.WSClient
import play.api.{Configuration, Logger}

import javax.inject.{Inject, Singleton}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

@ImplementedBy(classOf[MapillarySourceServiceImpl])
trait MapillarySourceService {

  /**
   * The deployment's Mapillary sources and how they apply (#5407). No creators means unfiltered, whatever the mode.
   *
   * The one accessor every consumer reads: the pages that hand a pano viewer its options, and the nightly
   * imagery-age poll. Cached, because it is read on every page load and changes only when an admin edits it.
   */
  def getSources: Future[MapillarySourceService.MapillarySources]

  /**
   * Every listed source paired with the username of the admin who added it (None for a row added by hand in SQL),
   * for the admin list. Uncached: the admin page is rarely loaded, and must show a just-made edit.
   */
  def getListedSources: Future[Seq[(MapillarySource, Option[String])]]

  /**
   * Adds a creator to the list after checking Mapillary actually has 360 imagery under that username.
   *
   * @param username    What the admin typed; trimmed here.
   * @param adminUserId The admin adding it.
   */
  def addCreator(username: String, adminUserId: String): Future[MapillarySourceService.AddOutcome]

  /** Removes a creator from the list, returning the number of rows deleted (0 or 1). */
  def removeCreator(username: String): Future[Int]

  /** Sets how the listed sources apply, returning the number of config rows updated (1). */
  def setMode(mode: MapillarySourceMode): Future[Int]
}

object MapillarySourceService {

  /**
   * A deployment's Mapillary sources as the pano viewer and the nightly poll consume them.
   *
   * @param mode     How the creators apply.
   * @param creators Listed Mapillary usernames, as Mapillary spells them. Empty means unfiltered.
   */
  case class MapillarySources(mode: MapillarySourceMode, creators: Seq[String]) {

    /** Whether any other creator's imagery is excluded outright, rather than merely outranked. */
    def restricts: Boolean = mode == MapillarySourceMode.Restrict && creators.nonEmpty
  }

  /** What a deployment with no listed creators has, and what every non-Mapillary deployment reports. */
  val Unfiltered: MapillarySources = MapillarySources(MapillarySourceMode.Prefer, Seq.empty)

  /** The shape MapillaryViewer reads from `panoOptions.mapillarySources`: `{"mode": "prefer", "creators": [...]}`. */
  implicit val mapillarySourcesWrites: Writes[MapillarySources] = (sources: MapillarySources) =>
    Json.obj("mode" -> sources.mode.name, "creators" -> sources.creators)

  /** Outcome of an admin's attempt to add a creator to the list. */
  sealed trait AddOutcome

  /**
   * The creator was verified and added.
   *
   * @param username Mapillary's spelling of the username, which can differ in case from what the admin typed.
   */
  case class Added(username: String) extends AddOutcome

  /**
   * The creator was already listed, so nothing changed.
   *
   * @param username Mapillary's spelling of the username, which can differ in case from what the admin typed.
   */
  case class AlreadyListed(username: String) extends AddOutcome

  /** The text can't be a Mapillary username, so Mapillary was never asked. */
  case object InvalidUsername extends AddOutcome

  /**
   * Mapillary answered, and has no 360 imagery under that username. Refused rather than accepted: under Restrict a
   * listed creator with no panos restricts the deployment to nothing, so every street would read as having no
   * imagery, and under Prefer it is almost certainly a typo for someone who does have imagery.
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
   * Whether a Mapillary image may be used at all. Only Restrict excludes anything; under Prefer every image stays a
   * candidate and the listed creators merely outrank others nearby, which the pano viewer and scan decide.
   *
   * Pure, so the rule is unit-testable without an HTTP stub, and shared so the nightly poll can't drift from it.
   * Usernames compare exactly: images carry Mapillary's spelling, and the list stores that same spelling
   * ([[canonicalCreator]]).
   *
   * @param sources         The deployment's sources.
   * @param creatorUsername The image's `creator.username`, or None when the API response carried no creator.
   */
  def imageUsable(sources: MapillarySources, creatorUsername: Option[String]): Boolean =
    !sources.restricts || creatorUsername.exists(sources.creators.contains)

  /**
   * Mapillary's own spelling of the creator behind a Graph API `/images` response.
   *
   * The API's `creator_username` filter ignores case, but each image's `creator.username` carries the canonical
   * spelling, and that is what [[imageUsable]], the viewer's preference and its SDK filter compare against exactly.
   * Storing what the admin typed instead would let "ProfJFray" pass verification and then match none of profjfray's
   * images, preferring nothing or restricting the deployment to nothing.
   *
   * @param response A parsed `/images` response requested with `fields=id,creator`.
   * @return Right(Some(username)) for the first image's creator, Right(None) when there are no images, and Left(why)
   *         when the response isn't shaped as expected.
   */
  def canonicalCreator(response: JsValue): Either[String, Option[String]] =
    (response \ "data").asOpt[JsArray] match {
      case None                                 => Left("Mapillary returned a response without a data array.")
      case Some(images) if images.value.isEmpty => Right(None)
      case Some(images)                         =>
        (images.value.head \ "creator" \ "username").asOpt[String] match {
          case Some(username) => Right(Some(username))
          case None           => Left("Mapillary returned an image without a creator username.")
        }
    }

  private[service] val SourcesCacheKey: String = "mapillarySources"
}

@Singleton
class MapillarySourceServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    cacheApi: AsyncCacheApi,
    ws: WSClient,
    mapillarySourceTable: MapillarySourceTable,
    configTable: ConfigTable
)(implicit ec: ExecutionContext)
    extends MapillarySourceService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  import MapillarySourceService._

  private val logger = Logger(this.getClass)

  def getSources: Future[MapillarySources] = {
    cacheApi.getOrElseUpdate[MapillarySources](SourcesCacheKey) {
      db.run(for {
        modeName <- configTable.getMapillarySourceMode
        sources  <- mapillarySourceTable.all
      } yield {
        // The DB CHECK admits only known names, so a miss here is a code/schema mismatch worth failing loudly on.
        val mode = MapillarySourceMode
          .fromName(modeName)
          .getOrElse(throw new IllegalStateException(s"Unknown config.mapillary_source_mode '$modeName'."))
        MapillarySources(mode, sources.filter(_.sourceType == MapillarySource.Creator).map(_.sourceValue))
      })
    }
  }

  def getListedSources: Future[Seq[(MapillarySource, Option[String])]] =
    db.run(mapillarySourceTable.allWithAdder)

  def addCreator(username: String, adminUserId: String): Future[AddOutcome] = {
    val trimmed = username.trim
    if (!isPlausibleUsername(trimmed)) Future.successful(InvalidUsername)
    else {
      fetchCanonicalCreator(trimmed).flatMap {
        case Right(Some(canonical)) =>
          for {
            inserted <- db.run(mapillarySourceTable.addCreator(canonical, adminUserId))
            _        <- cacheApi.remove(SourcesCacheKey)
          } yield if (inserted > 0) Added(canonical) else AlreadyListed(canonical)
        case Right(None)  => Future.successful(NoPanosFound)
        case Left(reason) => Future.successful(VerificationFailed(reason))
      }
    }
  }

  def removeCreator(username: String): Future[Int] = {
    for {
      deleted <- db.run(mapillarySourceTable.removeCreator(username.trim))
      _       <- cacheApi.remove(SourcesCacheKey)
    } yield deleted
  }

  def setMode(mode: MapillarySourceMode): Future[Int] = {
    for {
      updated <- db.run(configTable.setMapillarySourceMode(mode.name))
      _       <- cacheApi.remove(SourcesCacheKey)
    } yield updated
  }

  /**
   * Asks the Mapillary Graph API whether a username has any 360 imagery, and how Mapillary spells it.
   *
   * @return Right(Some(spelling)) or Right(None) when Mapillary answered, per [[MapillarySourceService.canonicalCreator]];
   *         Left(why) when it could not be asked or did not answer.
   */
  private def fetchCanonicalCreator(username: String): Future[Either[String, Option[String]]] = {
    config.getOptional[String]("mapillary-access-token") match {
      case None              => Future.successful(Left("No Mapillary access token is configured on this server."))
      case Some(accessToken) =>
        ws.url("https://graph.mapillary.com/images")
          .withQueryStringParameters(
            "creator_username" -> username,
            "is_pano"          -> "true",
            "limit"            -> "1",
            "fields"           -> "id,creator"
          )
          .addHttpHeaders("Authorization" -> s"OAuth $accessToken")
          .withRequestTimeout(10.seconds)
          .get()
          .map { response =>
            response.status match {
              case 200 =>
                Try(Json.parse(response.body)).toOption match {
                  case Some(json) => canonicalCreator(json)
                  case None       => Left("Mapillary returned a response that isn't JSON.")
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
