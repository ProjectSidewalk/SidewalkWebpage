package controllers

import javax.inject._
import play.api.mvc._
import controllers.AssetsFinder
import play.api.i18n.{MessagesApi, I18nSupport}
import service.ConfigService
import scala.concurrent.ExecutionContext

/**
 * Controller for the API documentation pages.
 */
@Singleton
class ApiDocsController @Inject()(
  cc: ControllerComponents,
  implicit val assets: AssetsFinder,
  configService: ConfigService,
  messagesApi: MessagesApi
)(implicit ec: ExecutionContext) extends AbstractController(cc) {

  /**
   * Helper method to get the city name based on the current request.
   *
   * @param request The implicit HTTP request header containing the city information.
   * @return The name of the city as a string.
   */
  private def getCityName(implicit request: RequestHeader): String = {
    val lang = messagesApi.preferred(request).lang
    val cityId = configService.getCityId
    val cityInfo = configService.getAllCityInfo(lang).find(_.cityId == cityId)
    cityInfo.map(_.cityNameFormatted).getOrElse(cityId) // Fallback to cityId if not found
  }

  /**
   * Displays API documentation index/introduction page.
   */
  def index() = Action { implicit request =>
    Ok(views.html.apiDocs.index("introduction"))
  }

  /**
   * Displays API documentation for the label types.
   */
  def labelTypes() = Action { implicit request =>
    Ok(views.html.apiDocs.labelTypes("label-types"))
  }

  /**
   * Displays API documentation for the label tags.
   */
  def labelTags() = Action { implicit request =>
    val cityName = getCityName
    Ok(views.html.apiDocs.labelTags("label-tags")(request, assets, cityName))
  }

  /**
   * Displays API documentation for the raw labels.
   */
  def rawLabels() = Action { implicit request =>
    val cityName = getCityName
    Ok(views.html.apiDocs.rawLabels("raw-labels")(request, assets, cityName))
  }

  /**
   * Displays API documentation for the raw labels.
   */
  def labelClusters() = Action { implicit request =>
    val cityName = getCityName
    Ok(views.html.apiDocs.labelClusters("label-clusters")(request, assets, cityName))
  }

  /**
  * Displays API documentation for the deployed cities.
  */
  def streets() = Action { implicit request =>
    val cityName = getCityName
    Ok(views.html.apiDocs.streets("streets")(request, assets, cityName))
  }
  
  /**
   * Displays API documentation for the street types.
   */
  def streetTypes() = Action { implicit request =>
    val cityName = getCityName
    Ok(views.html.apiDocs.streetTypes("street-types")(request, assets, cityName))
  }

  /**
    * Displays API documentation for the deployed cities.
    */
  def cities() = Action { implicit request =>
    Ok(views.html.apiDocs.cities("cities"))
  }

  /**
   * Displays API documentation for the user stats
   */
  def userStats() = Action { implicit request =>
    val cityName = getCityName
    Ok(views.html.apiDocs.userStats("user-stats")(request, assets, cityName))
  }

  /**
   * Displays API documentation for the user stats
   */
  def overallStats() = Action { implicit request =>
    val cityName = getCityName
    Ok(views.html.apiDocs.overallStats("overall-stats")(request, assets, cityName))
  }
}