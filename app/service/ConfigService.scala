package service

import com.google.inject.ImplementedBy
import com.typesafe.config.ConfigException
import models.utils._
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.i18n.{Lang, MessagesApi}
import play.api.libs.ws.WSClient
import play.api.{Configuration, Logger}
import slick.dbio.DBIO

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.duration.Duration
import scala.concurrent.{ExecutionContext, Future}
import scala.reflect.ClassTag

case class CityInfo(cityId: String, countryId: String, cityNameShort: String, cityNameFormatted: String, URL: String, visibility: String)
case class CommonPageData(cityId: String, environmentType: String, googleAnalyticsId: String, prodUrl: String,
                          gMapsApiKey: String, versionId: String, versionTimestamp: OffsetDateTime,
                          allCityInfo: Seq[CityInfo])

@ImplementedBy(classOf[ConfigServiceImpl])
trait ConfigService {
  /**
   * Maps a city ID to its corresponding database user/schema.
   *
   * @param cityId The ID of the city
   * @return The database user/schema for the city
   */
  def getCitySchema(cityId: String): String

  /**
   * Retrieves map parameters for a specific city by directly querying that city's database schema.
   *
   * This method attempts to retrieve map parameters (center coordinates, zoom level, and boundary coordinates) for the
   * specified city by querying its database schema. Gets geographic info about cities other than the current one.
   *
   * @param cityId The ID of the city to retrieve map parameters for
   * @return A Future containing an Option[MapParams]. The Option will be:
   *         - Some(mapParams) if parameters were successfully retrieved
   *         - None if parameters could not be retrieved (e.g., schema not found or query failed)
   */
  def getCityMapParamsBySchema(cityId: String): Future[Option[MapParams]]

  def getCityMapParams: Future[MapParams]
  def getApiFields: Future[(MapParams, MapParams, MapParams)]
  def getTutorialStreetId: Future[Int]
  def getMakeCrops: Future[Boolean]
  def getMapathonEventLink: Future[Option[String]]
  def getOpenStatus: Future[String]
  def getOffsetHours: Future[Int]
  def getExcludedTags: DBIO[Seq[String]]
  def getAllCityInfo(lang: Lang): Seq[CityInfo]
  def getCityId: String
  def getCurrentCountryId: String
  def sendSciStarterContributions(email: String, contributions: Int, timeSpent: Float): Future[Int]
  def cachedDBIO[T: ClassTag](key: String, duration: Duration = Duration.Inf)(dbOperation: => DBIO[T]): DBIO[T]
  def getCommonPageData(lang: Lang): Future[CommonPageData]
}

@Singleton
class ConfigServiceImpl @Inject()(protected val dbConfigProvider: DatabaseConfigProvider,
                                  config: Configuration,
                                  messagesApi: MessagesApi,
                                  cacheApi: AsyncCacheApi,
                                  ws: WSClient,
                                  configTable: ConfigTable,
                                  versionTable: VersionTable
                                 )(implicit val ec: ExecutionContext) extends ConfigService with HasDatabaseConfigProvider[MyPostgresProfile] {
  private val logger = Logger("application")

  /**
   * Maps a city ID to its corresponding database user/schema. The mapping is loaded from configuration.
   *
   * @param cityId The ID of the city.
   * @return The database schema name for the city.
   * @throws com.typesafe.config.ConfigException.Missing if the cityId is not found in the configuration
   */
  def getCitySchema(cityId: String): String = {
    // Try to get schema from configuration.
    val configPath = s"city-params.db-schema.$cityId"
    try {
      config.get[String](configPath)
    } catch {
      case e: ConfigException => // Catching any ConfigException (or be more specific like ConfigException.Missing).
        val errorMessage = s"Configuration error for city ID '$cityId' at path '$configPath'."
        // Log the error, including the original exception's stack trace.
        logger.error(errorMessage, e)
        throw e // Rethrow the original caught exception.
    }
  }

  /**
   * Retrieves map parameters for a specific city by directly querying that city's database schema.
   *
   * This method handles the special case of the current city separately, as it can use the standard method that doesn't
   * require cross-schema access. For other cities, it resolves the schema name and queries that schema. Results are
   * cached to improve performance.
   *
   * @param cityId The ID of the city to retrieve map parameters for
   * @return A Future containing an Option[MapParams]
   */
  def getCityMapParamsBySchema(cityId: String): Future[Option[MapParams]] = {
    // For the current city, use the standard method which doesn't require cross-schema access.
    if (cityId == getCityId) {
      getCityMapParams.map(Some(_))
    } else {
      // For other cities, get the schema name and query that schema.
      val schema = getCitySchema(cityId)

      // Use cache to avoid repeated database queries.
      cacheApi.getOrElseUpdate[Option[MapParams]](s"getMapParams_$cityId") {
        try {
          // Attempt to run the database query.
          db.run(configTable.getCityMapParamsBySchema(schema))
            .map(Some(_)) // Wrap successful result in Some.
            .recover {
              case e: Exception =>
                // Log failures but don't propagate exceptions.
                logger.warn(s"Failed to retrieve map params for city $cityId from schema $schema: ${e.getMessage}")
                None // Return None when query fails.
            }
        } catch {
          case e: Exception =>
            // Handle exceptions during query preparation (rare).
            logger.error(s"Exception setting up query for city $cityId: ${e.getMessage}", e)
            Future.successful(None)
        }
      }
    }
  }

  def getCityMapParams: Future[MapParams] =
    cacheApi.getOrElseUpdate[MapParams]("getCityMapParams")(db.run(configTable.getCityMapParams))

  def getApiFields: Future[(MapParams, MapParams, MapParams)] =
    cacheApi.getOrElseUpdate[(MapParams, MapParams, MapParams)]("getApiFields")(db.run(configTable.getApiFields))

  def getTutorialStreetId: Future[Int] =
    cacheApi.getOrElseUpdate[Int]("getTutorialStreetId")(db.run(configTable.getTutorialStreetId))

  def getMakeCrops: Future[Boolean] =
    cacheApi.getOrElseUpdate[Boolean]("getMakeCrops")(db.run(configTable.getMakeCrops))

  def getMapathonEventLink: Future[Option[String]] =
    cacheApi.getOrElseUpdate[Option[String]]("getMapathonEventLink")(db.run(configTable.getMapathonEventLink))

  def getOpenStatus: Future[String] =
    cacheApi.getOrElseUpdate[String]("getOpenStatus")(db.run(configTable.getOpenStatus))

  def getOffsetHours: Future[Int] = cacheApi.getOrElseUpdate[Int]("getOffsetHours")(db.run(configTable.getOffsetHours))

  def getExcludedTags: DBIO[Seq[String]] = {
    // Remove the leading and trailing quotes and split by the delimiter.
    cachedDBIO("getExcludedTags")(configTable.getExcludedTagsString.map(_.drop(2).dropRight(2).split("\" \"").toSeq))
  }

  def getAllCityInfo(lang: Lang): Seq[CityInfo] = {
    val currentCityId = config.get[String]("city-id")
    val currentCountryId = config.get[String](s"city-params.country-id.$currentCityId")
    val envType = config.get[String]("environment-type")

    val cityIds = config.get[Seq[String]]("city-params.city-ids")
    cityIds.map { cityId =>
      val stateId = config.get[Option[String]](s"city-params.state-id.$cityId")
      val countryId = config.get[String](s"city-params.country-id.$cityId")
      val cityURL = config.get[String](s"city-params.landing-page-url.$envType.$cityId")
      val visibility = config.get[String](s"city-params.status.$cityId")

      val cityName = messagesApi(s"city.name.$cityId")(lang)
      val cityNameShort = config.get[Option[String]](s"city-params.city-short-name.$cityId").getOrElse(cityName)
      val cityNameFormatted = if (currentCountryId == "usa" && stateId.isDefined && countryId == "usa")
        messagesApi("city.state", cityName, messagesApi(s"state.name.${stateId.get}")(lang))(lang)
      else
        messagesApi("city.state", cityName, messagesApi(s"country.name.$countryId")(lang))(lang)

      CityInfo(cityId, countryId, cityNameShort, cityNameFormatted, cityURL, visibility)
    }
  }

  def sha256Hash(text: String): String =
    String.format("%064x", new java.math.BigInteger(1, java.security.MessageDigest.getInstance("SHA-256").digest(text.getBytes("UTF-8"))))

  /**
   * Send a POST request to SciStarter to record the user's contributions.
   * @param email         The email address of the user who contributed. Will be hashed in POST request.
   * @param contributions Number of contributions. Either number of labels created or number of labels validated.
   * @param timeSpent     Total time spent on those contributions in seconds.
   * @return Response code from the API request.
   */
  def sendSciStarterContributions(email: String, contributions: Int, timeSpent: Float): Future[Int] = {
    // Make API call, logging any errors.
    ws.url("https://scistarter.org/api/participation/hashed/project-sidewalk")
      .withQueryStringParameters("key" -> config.get[String]("scistarter-api-key"))
      .withHttpHeaders("Content-Type" -> "application/x-www-form-urlencoded")
      .post(Map(
        "hashed" -> Seq(sha256Hash(email)),
        "type" -> Seq("classification"),
        "count" -> Seq(contributions.toString),
        "duration" -> Seq((timeSpent / contributions).toString)
      ))
      .map(response => response.status)
      .recover { case e: Exception =>
        logger.warn(s"Error sending contributions to SciStarter: ${e.getMessage}")
        throw e
      }
  }

  def getCurrentCountryId: String = config.get[String](s"city-params.country-id.$getCityId")

  def getCityId: String = config.get[String]("city-id")

  // Uses Play's cache API to cache the result of a DBIO.
  def cachedDBIO[T: ClassTag](key: String, duration: Duration = Duration.Inf)(dbOperation: => DBIO[T]): DBIO[T] = {
    DBIO.from(cacheApi.get[T](key)).flatMap {
      case Some(cached) => DBIO.successful(cached)
      case None =>
        dbOperation.map { result =>
          cacheApi.set(key, result, duration)
          result
        }
    }
  }

  def getCommonPageData(lang: Lang): Future[CommonPageData] = {
    for {
      version: Version <- cacheApi.getOrElseUpdate[Version]("currentVersion")(versionTable.currentVersion())
      cityId: String = getCityId
      envType: String = config.get[String]("environment-type")
      googleAnalyticsId: String = config.get[String](s"city-params.google-analytics-4-id.$envType.$cityId")
      prodUrl: String = config.get[String](s"city-params.landing-page-url.prod.$cityId")
      gMapsApiKey: String = config.get[String]("google-maps-api-key")
      allCityInfo: Seq[CityInfo] = getAllCityInfo(lang)
    } yield {
      CommonPageData(cityId, envType, googleAnalyticsId, prodUrl, gMapsApiKey, version.versionId, version.versionStartTime, allCityInfo)
    }
  }
}
