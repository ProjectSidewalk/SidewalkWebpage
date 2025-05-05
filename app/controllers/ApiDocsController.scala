package controllers

import javax.inject._
import play.api.mvc._
import controllers.AssetsFinder

/**
 * Controller for the API documentation pages.
 */
@Singleton
class ApiDocsController @Inject()(
  cc: ControllerComponents,
  // Inject the assets finder
  implicit val assets: AssetsFinder
) extends AbstractController(cc) {

  /**
   * Displays the API documentation index/introduction page.
   */
  def index() = Action { implicit request =>
    Ok(views.html.apiDocs.index("introduction"))
  }

  /**
   * Displays the API documentation for the label types.
   */
  def labelTypes() = Action { implicit request =>
    Ok(views.html.apiDocs.labelTypes("label-types"))
  }

  
  /**
   * Handles the `rawLabels` endpoint.
   *
   * This method defines an action that processes HTTP requests for raw label data.
   * It uses the Play Framework's `Action` to handle the request and provides
   * an implicit `Request` object for further processing.
   *
   * @return An HTTP response containing the raw label data.
   */
  def rawLabels() = Action { implicit request =>
    Ok(views.html.apiDocs.rawLabels("raw-labels"))
  }

  // /**
  //  * Displays the Labels API documentation page.
  //  */
  // def labels() = Action { implicit request =>
  //   Ok(views.html.apiDocs.labels("labels"))
  // }

  // /**
  //  * Displays the StreetScore API documentation page.
  //  */
  // def streetScore() = Action { implicit request =>
  //   Ok(views.html.apiDocs.streetScore("streetScore"))
  // }

  // /**
  //  * Displays the NeighborhoodScore API documentation page.
  //  */
  // def neighborhoodScore() = Action { implicit request =>
  //   Ok(views.html.apiDocs.neighborhoodScore("neighborhoodScore"))
  // }

  // /**
  //  * Displays the OverallStats API documentation page.
  //  */
  // def overallStats() = Action { implicit request =>
  //   Ok(views.html.apiDocs.overallStats("overallStats"))
  // }

  // /**
  //  * Displays the UserStats API documentation page.
  //  */
  // def userStats() = Action { implicit request =>
  //   Ok(views.html.apiDocs.userStats("userStats"))
  // }
}