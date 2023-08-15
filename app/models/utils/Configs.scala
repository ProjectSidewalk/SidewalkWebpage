package models.utils

import play.api.Play
import play.api.Play.current
import play.api.mvc.RequestHeader
import scala.collection.JavaConverters._

object Configs {
  /**
   * Returns list of all cities -- (cityId, name + ", " + state, cityURL, visibility) -- excluding the city specified.
   */
  def getAllCityInfo(excludeCity: String = ""): List[(String, String, String, String)] = {
    val envType: String = Play.configuration.getString("environment-type").get
    // Get names and URLs for cities to display in Gallery dropdown.
    val cities: List[String] =
      Play.configuration.getStringList("city-params.city-ids").get.asScala.toList.filterNot(_ == excludeCity)
    val cityInfo: List[(String, String, String, String)] = cities.map { cityId =>
      val name: String = Play.configuration.getString("city-params.city-name." + cityId).get
      val state: String = Play.configuration.getString("city-params.state-abbreviation." + cityId).get
      val cityURL: String = Play.configuration.getString("city-params.landing-page-url." + envType + "." + cityId).get
      val visibility: String = Play.configuration.getString("city-params.status." + cityId).get
      (cityId, name + ", " + state, cityURL, visibility)
    }
    cityInfo
  }

  def cityId(request: RequestHeader) = request.headers.get("city-id").get
  def schema(cityId: String) = Play.configuration.getString(s"city-params.schemata.${cityId}")
}
