package service.utils

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import com.google.inject.ImplementedBy
import models.utils.{ConfigTable, MapParams, VersionTable}
import org.apache.http.NameValuePair
import org.apache.http.client.entity.UrlEncodedFormEntity
import org.apache.http.client.methods.HttpPost
import org.apache.http.impl.client.HttpClients
import org.apache.http.impl.client.CloseableHttpClient
import org.apache.http.message.BasicNameValuePair
import play.api.{Configuration, Logger}
import play.api.cache.CacheApi
import play.api.i18n.{Lang, MessagesApi}
import slick.dbio.DBIO

import java.sql.Timestamp
import java.util
import scala.concurrent.duration.Duration
import scala.reflect.ClassTag

case class CityInfo(cityId: String, countryId: String, cityNameShort: String, cityNameFormatted: String, URL: String, visibility: String)

case class CommonPageData(cityId: String, environmentType: String, googleAnalyticsId: Option[String],
                          prodUrl: Option[String], gMapsApiKey: String, versionId: String, versionTimestamp: Timestamp,
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
  def cachedFuture[T: ClassTag](key: String, duration: Duration = Duration.Inf)(dbOperation: => Future[T]): Future[T]
  def cachedDBIO[T: ClassTag](key: String, duration: Duration = Duration.Inf)(dbOperation: => DBIO[T]): DBIO[T]
  def getCommonPageData(lang: Lang): Future[CommonPageData]
}

@Singleton
class ConfigServiceImpl @Inject()(
                                   config: Configuration,
                                   messagesApi: MessagesApi,
                                   cacheApi: CacheApi,
                                   implicit val ec: ExecutionContext,
                                   configTable: ConfigTable,
                                   versionTable: VersionTable
                                 ) extends ConfigService {
  def getCityMapParams: Future[MapParams] = {
    cachedFuture("getCityMapParams")(configTable.getCityMapParams)
  }

  def getApiFields: Future[(MapParams, MapParams, MapParams)] = {
    cachedFuture("getApiFields")(configTable.getApiFields)
  }

  def getTutorialStreetId: Future[Int] = {
    cachedFuture("getTutorialStreetId")(configTable.getTutorialStreetId)
  }

  def getMakeCrops: Future[Boolean] = {
    cachedFuture("getMakeCrops")(configTable.getMakeCrops)
  }

  def getMapathonEventLink: Future[Option[String]] = {
    cachedFuture("getMapathonEventLink")(configTable.getMapathonEventLink)
  }

  def getOpenStatus: Future[String] = {
    cachedFuture("getOpenStatus")(configTable.getOpenStatus)
  }

  def getOffsetHours: Future[Int] = {
    cachedFuture("getOffsetHours")(configTable.getOffsetHours)
  }

  def getExcludedTags: DBIO[Seq[String]] = {
    // Remove the leading and trailing quotes and split by the delimiter.
    cachedDBIO("getExcludedTags")(configTable.getExcludedTagsString.map(_.drop(2).dropRight(2).split("\" \"").toSeq))
  }

  def getAllCityInfo(lang: Lang): Seq[CityInfo] = {
    val currentCityId = config.getString("city-id").get
    val currentCountryId = config.getString(s"city-params.country-id.$currentCityId").get
    val envType = config.getString("environment-type").get

    val cityIds = config.getStringSeq("city-params.city-ids").get
    cityIds.map { cityId =>
      val stateId = config.getString(s"city-params.state-id.$cityId")
      val countryId = config.getString(s"city-params.country-id.$cityId").get
      val cityURL = config.getString(s"city-params.landing-page-url.$envType.$cityId").get
      val visibility = config.getString(s"city-params.status.$cityId").get

      val cityName = messagesApi(s"city.name.$cityId")(lang)
      val cityNameShort = config.getString(s"city-params.city-short-name.$cityId").getOrElse(cityName)
      val cityNameFormatted = if (currentCountryId == "usa" && stateId.isDefined && countryId == "usa")
        messagesApi("city.state", cityName, messagesApi(s"state.name.${stateId.get}")(lang))(lang)
      else
        messagesApi("city.state", cityName, messagesApi(s"country.name.$countryId")(lang))(lang)

      CityInfo(cityId, countryId, cityNameShort, cityNameFormatted, cityURL, visibility)
    }
  }

  def sha256Hash(text: String) : String = String.format("%064x", new java.math.BigInteger(1, java.security.MessageDigest.getInstance("SHA-256").digest(text.getBytes("UTF-8"))))

  /**
   * Send a POST request to SciStarter to record the user's contributions.
   *
   * @param email The email address of the user who contributed. Will be hashed in POST request.
   * @param contributions Number of contributions. Either number of labels created or number of labels validated.
   * @param timeSpent Total time spent on those contributions.
   * @return Response code from the API request.
   */
  def sendSciStarterContributions(email: String, contributions: Int, timeSpent: Float): Future[Int] = Future {
    // Get the SciStarter API key, throw an error if not found.
    val apiKey: Option[String] = config.getString("scistarter-api-key")
    if (apiKey.isEmpty) {
      Logger.error("SciStarter API key not found.")
      throw new Exception("SciStarter API key not found.")
    }

    // Set up the URL and POST request data with hashed email and amount of contribution.
    val hashedEmail: String = sha256Hash(email)
    val url: String = s"https://scistarter.org/api/participation/hashed/project-sidewalk?key=${apiKey.get}"
    val post: HttpPost = new HttpPost(url)
    val client: CloseableHttpClient = HttpClients.createDefault()
    val nameValuePairs = new util.ArrayList[NameValuePair](1)
    nameValuePairs.add(new BasicNameValuePair("hashed", hashedEmail))
    nameValuePairs.add(new BasicNameValuePair("type", "classification"))
    nameValuePairs.add(new BasicNameValuePair("count", contributions.toString))
    nameValuePairs.add(new BasicNameValuePair("duration", (timeSpent / contributions).toString))
    post.setEntity(new UrlEncodedFormEntity(nameValuePairs))

    // Make API call, logging any errors.
    try {
      val response = client.execute(post)
      response.getStatusLine.getStatusCode
    } catch {
      case e: Exception =>
        Logger.warn(e.getMessage)
        throw e
    } finally {
      client.close()
    }
  }

  def getCurrentCountryId: String = {
    config.getString(s"city-params.country-id.$getCityId").get
  }

  def getCityId: String = {
    config.getString("city-id").get
  }

  // Uses Play's cache API to cache the result of a future. Future versions of Play will have a built-in way to do this.
  def cachedFuture[T: ClassTag](key: String, duration: Duration = Duration.Inf)(dbOperation: => Future[T]): Future[T] = {
    cacheApi.get[T](key) match {
      case Some(cached) => Future.successful(cached)
      case None =>
        dbOperation.map { result =>
          cacheApi.set(key, result, duration)
          result
        }
    }
  }

  // Mirror of the above but for DBIOs.
  def cachedDBIO[T: ClassTag](key: String, duration: Duration = Duration.Inf)(dbOperation: => DBIO[T]): DBIO[T] = {
    DBIO.from(Future.successful(cacheApi.get[T](key))).flatMap {
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
      versionTimestamp: Timestamp <- versionTable.currentVersionTimestamp()
      cityId: String = getCityId
      envType: String = config.getString("environment-type").get
      googleAnalyticsId: Option[String] = config.getString(s"city-params.google-analytics-4-id.$envType.$cityId")
      prodUrl: Option[String] = config.getString(s"city-params.landing-page-url.prod.$cityId")
      gMapsApiKey: String = config.getString("google-maps-api-key").get
      allCityInfo: Seq[CityInfo] = getAllCityInfo(lang)
    } yield {
      CommonPageData(cityId, envType, googleAnalyticsId, prodUrl, gMapsApiKey, versionId, versionTimestamp, allCityInfo)
    }
  }
}
