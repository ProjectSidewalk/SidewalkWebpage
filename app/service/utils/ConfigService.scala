package service.utils

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import com.google.inject.ImplementedBy
import models.utils.{ConfigTable, MapParams, MyPostgresProfile, VersionTable}
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.ws.WSClient
import play.api.{Configuration, Logger}
import play.api.i18n.{Lang, MessagesApi}
import slick.dbio.DBIO

import java.time.OffsetDateTime
import scala.concurrent.duration.Duration
import scala.reflect.ClassTag

case class CityInfo(cityId: String, countryId: String, cityNameShort: String, cityNameFormatted: String, URL: String, visibility: String)

case class CommonPageData(cityId: String, environmentType: String, googleAnalyticsId: String, prodUrl: String,
                          gMapsApiKey: String, versionId: String, versionTimestamp: OffsetDateTime,
                          allCityInfo: Seq[CityInfo])

@ImplementedBy(classOf[ConfigServiceImpl])
trait ConfigService {
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
class ConfigServiceImpl @Inject()(
                                   protected val dbConfigProvider: DatabaseConfigProvider,
                                   config: Configuration,
                                   messagesApi: MessagesApi,
                                   cacheApi: AsyncCacheApi,
                                   ws: WSClient,
                                   configTable: ConfigTable,
                                   versionTable: VersionTable
                                 )(implicit val ec: ExecutionContext) extends ConfigService with HasDatabaseConfigProvider[MyPostgresProfile] {
  def getCityMapParams: Future[MapParams] = {
    cacheApi.getOrElseUpdate[MapParams]("getCityMapParams")(db.run(configTable.getCityMapParams))
  }

  def getApiFields: Future[(MapParams, MapParams, MapParams)] = {
    cacheApi.getOrElseUpdate[(MapParams, MapParams, MapParams)]("getApiFields")(db.run(configTable.getApiFields))
  }

  def getTutorialStreetId: Future[Int] = {
    cacheApi.getOrElseUpdate[Int]("getTutorialStreetId")(db.run(configTable.getTutorialStreetId))
  }

  def getMakeCrops: Future[Boolean] = {
    cacheApi.getOrElseUpdate[Boolean]("getMakeCrops")(db.run(configTable.getMakeCrops))
  }

  def getMapathonEventLink: Future[Option[String]] = {
    cacheApi.getOrElseUpdate[Option[String]]("getMapathonEventLink")(db.run(configTable.getMapathonEventLink))
  }

  def getOpenStatus: Future[String] = {
    cacheApi.getOrElseUpdate[String]("getOpenStatus")(db.run(configTable.getOpenStatus))
  }

  def getOffsetHours: Future[Int] = {
    cacheApi.getOrElseUpdate[Int]("getOffsetHours")(db.run(configTable.getOffsetHours))
  }

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

  def sha256Hash(text: String): String = String.format("%064x", new java.math.BigInteger(1, java.security.MessageDigest.getInstance("SHA-256").digest(text.getBytes("UTF-8"))))

  /**
   * Send a POST request to SciStarter to record the user's contributions.
   *
   * @param email         The email address of the user who contributed. Will be hashed in POST request.
   * @param contributions Number of contributions. Either number of labels created or number of labels validated.
   * @param timeSpent     Total time spent on those contributions.
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
        Logger(getClass).warn(s"Error sending contributions to SciStarter: ${e.getMessage}")
        throw e
      }
  }

  def getCurrentCountryId: String = {
    config.get[String](s"city-params.country-id.$getCityId")
  }

  def getCityId: String = {
    config.get[String]("city-id")
  }

  // Uses Play's cache API to cache the result of a DBIO.
  def cachedDBIO[T: ClassTag](key: String, duration: Duration = Duration.Inf)(dbOperation: => DBIO[T]): DBIO[T] = {
    DBIO.from(cacheApi.get[T](key)).flatMap {
      case Some(cached) =>
        DBIO.successful(cached)
      case None =>
        dbOperation.map { result =>
          cacheApi.set(key, result, duration)
          result
        }
    }
  }

  def getCommonPageData(lang: Lang): Future[CommonPageData] = {
    for {
      versionId: String <- versionTable.currentVersionId()
      versionTimestamp: OffsetDateTime <- versionTable.currentVersionTimestamp()
      cityId: String = getCityId
      envType: String = config.get[String]("environment-type")
      googleAnalyticsId: String = config.get[String](s"city-params.google-analytics-4-id.$envType.$cityId")
      prodUrl: String = config.get[String](s"city-params.landing-page-url.prod.$cityId")
      gMapsApiKey: String = config.get[String]("google-maps-api-key")
      allCityInfo: Seq[CityInfo] = getAllCityInfo(lang)
    } yield {
      CommonPageData(cityId, envType, googleAnalyticsId, prodUrl, gMapsApiKey, versionId, versionTimestamp, allCityInfo)
    }
  }
}
