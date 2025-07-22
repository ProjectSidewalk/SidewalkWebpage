package models.utils

import play.api.Play
import play.api.Play.current
import play.api.cache.Cache
import scala.collection.JavaConverters._
import play.api.i18n.{Lang, Messages}

case class CityInfo(cityId: String, countryId: String, cityNameShort: String, cityNameFormatted: String, URL: String, visibility: String, current: Boolean,
                    aiTagSuggestionsEnabled: Boolean = false, aiValidationsEnabled: Boolean = false, aiValidationsMinAccuracy: Float = 0.0F)

object Configs {
  /**
   * Returns list of info for all cities, including formatted names (in current language), URL, visibility.
   */
  def getAllCityInfo(lang: Lang): List[CityInfo] = {
    Cache.getOrElse(s"getAllCityInfo($lang)") {
      val currentCityId: String = Play.configuration.getString("city-id").get
      val currentCountryId: String = Play.configuration.getString(s"city-params.country-id.$currentCityId").get
      val envType: String = Play.configuration.getString("environment-type").get

      // Get names and URLs for cities to display in Gallery dropdown.
      val cityIds: List[String] = Play.configuration.getStringList("city-params.city-ids").get.asScala.toList
      val cityInfo: List[CityInfo] = cityIds.map { cityId =>
        val stateId: Option[String] = Play.configuration.getString(s"city-params.state-id.$cityId")
        val countryId: String = Play.configuration.getString(s"city-params.country-id.$cityId").get
        val cityURL: String = Play.configuration.getString(s"city-params.landing-page-url.$envType.$cityId").get
        val visibility: String = Play.configuration.getString(s"city-params.status.$cityId").get

        // Get the name of the city in frequently used formats in the current language.
        val cityName: String = Messages(s"city.name.$cityId")(lang)
        val cityNameShort: String = Play.configuration.getString(s"city-params.city-short-name.$cityId").getOrElse(cityName)
        val cityNameFormatted: String = if (currentCountryId == "usa" && stateId.isDefined && countryId == "usa")
          Messages("city.state", cityName, Messages(s"state.name.${stateId.get}")(lang))(lang)
        else
          Messages("city.state", cityName, Messages(s"country.name.$countryId")(lang))(lang)

        // Get AI-related configurations.
        val aiTagSuggestionsEnabled: Boolean = Play.configuration.getString(s"city-params.ai-tag-suggestions-enabled.$cityId").getOrElse("off") == "on"
        val aiValidationsEnabled: Boolean = Play.configuration.getString(s"city-params.ai-validations-enabled.$cityId").getOrElse("off") == "on"
        val aiValidationsMinAccuracy: Float = Play.configuration.getString(s"city-params.ai-validations-min-accuracy.$cityId").getOrElse("0.0").toFloat

        CityInfo(cityId, countryId, cityNameShort, cityNameFormatted, cityURL, visibility, cityId == currentCityId,
          aiTagSuggestionsEnabled, aiValidationsEnabled, aiValidationsMinAccuracy)
      }
      cityInfo
    }
  }

  def getLangFromRequest(request: play.api.mvc.RequestHeader): Lang = {
    request.cookies.get("PLAY_LANG").map(l => Lang(l.value)).getOrElse(Lang.preferred(request.acceptLanguages))
  }

  def getCurrentCountryId(): String = {
    val cityId: String = Play.configuration.getString("city-id").get
    val currentCountryId: String = Play.configuration.getString(s"city-params.country-id.$cityId").get
    currentCountryId
  }

}
