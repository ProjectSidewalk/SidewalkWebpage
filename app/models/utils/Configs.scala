package models.utils

import play.api.Play
import play.api.Play.current
import scala.collection.JavaConverters._

object Configs {
  /**
   * Returns list of all cities -- (cityId, name + ", " + state, cityURL, visibility) -- excluding the city specified.
   */
  def getAllCityInfo(excludeCity: String = ""): List[(String, Option[String], String, String, String)] = {
    val envType: String = Play.configuration.getString("environment-type").get
    // Get names and URLs for cities to display in Gallery dropdown.
    val cities: List[String] =
      Play.configuration.getStringList("city-params.city-ids").get.asScala.toList.filterNot(_ == excludeCity)
    val cityInfo: List[(String, Option[String], String, String, String)] = cities.map { cityId =>
      val stateId: Option[String] = Play.configuration.getString("city-params.state-id." + cityId)
      val countryId: String = Play.configuration.getString("city-params.country-id." + cityId).get
      val cityURL: String = Play.configuration.getString("city-params.landing-page-url." + envType + "." + cityId).get
      val visibility: String = Play.configuration.getString("city-params.status." + cityId).get
      (cityId, stateId, countryId, cityURL, visibility)
    }
    cityInfo
  }
}
