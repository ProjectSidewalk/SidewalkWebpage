package service.utils

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import com.google.inject.ImplementedBy
import models.utils.{ConfigTable, MapParams, VersionTable}
import play.api.Configuration
import play.api.cache.CacheApi
import play.api.i18n.{Lang, MessagesApi}

import java.sql.Timestamp
import scala.collection.JavaConverters._
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
  def getExcludedTags: Future[Seq[String]]
  def getAllCityInfo(lang: Lang): Seq[CityInfo]
  def getCityId: String
  def getCurrentCountryId: String
  def cachedFuture[T: ClassTag](key: String, duration: Duration = Duration.Inf)(dbOperation: => Future[T]): Future[T]
  def getCommonPageData(lang: Lang): Future[CommonPageData]
}

@Singleton
class ConfigServiceImpl @Inject()(
                                   config: Configuration,
                                   messagesApi: MessagesApi,
                                   cacheApi: CacheApi,
                                   configTable: ConfigTable,
                                   versionTable: VersionTable,
                                   implicit val ec: ExecutionContext
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

  def getExcludedTags: Future[Seq[String]] = {
    // Remove the leading and trailing quotes and split by the delimiter.
    cachedFuture("getExcludedTags")(configTable.getExcludedTagsString.map(_.drop(2).dropRight(2).split("\" \"").toSeq))
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
