package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import play.api.Configuration
import service.ConfigService

import javax.inject._
import scala.concurrent.ExecutionContext

/**
 * Controller for the API documentation pages.
 */
@Singleton
class ApiDocsController @Inject() (
    cc: CustomControllerComponents,
    val config: Configuration,
    implicit val assets: AssetsFinder,
    configService: ConfigService
)(implicit ec: ExecutionContext)
    extends CustomBaseController(cc) {
  implicit val implicitConfig: Configuration = config

  /**
   * Displays API documentation index/introduction page.
   */
  def index = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_APIDocs_Introduction")
      Ok(views.html.apiDocs.index(commonData, request.identity))
    }
  }

  /**
   * Displays API documentation for the label types.
   */
  def labelTypes = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_APIDocs_LabelTypes")
      Ok(views.html.apiDocs.labelTypes(commonData, request.identity))
    }
  }

  /**
   * Displays API documentation for the label tags.
   */
  def labelTags = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_APIDocs_LabelTags")
      Ok(views.html.apiDocs.labelTags(commonData, request.identity))
    }
  }

  /**
   * Displays API documentation for the raw labels.
   */
  def rawLabels = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_APIDocs_RawLabels")
      Ok(views.html.apiDocs.rawLabels(commonData, request.identity))
    }
  }

  /**
   * Displays API documentation for the label clusters.
   */
  def labelClusters = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_APIDocs_LabelClusters")
      Ok(views.html.apiDocs.labelClusters(commonData, request.identity))
    }
  }

  /**
   * Displays API documentation for the streets.
   */
  def streets = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_APIDocs_Streets")
      Ok(views.html.apiDocs.streets(commonData, request.identity))
    }
  }

  /**
   * Displays API documentation for the street types.
   */
  def streetTypes = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_APIDocs_StreetTypes")
      Ok(views.html.apiDocs.streetTypes(commonData, request.identity))
    }
  }

  /**
   * Displays API documentation for the deployed cities.
   */
  def cities = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_APIDocs_Cities")
      Ok(views.html.apiDocs.cities(commonData, request.identity))
    }
  }

  /**
   * Displays API documentation for the user stats.
   */
  def userStats = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_APIDocs_UserStats")
      Ok(views.html.apiDocs.userStats(commonData, request.identity))
    }
  }

  /**
   * Displays API documentation for the overall stats.
   */
  def overallStats = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_APIDocs_OverallStats")
      Ok(views.html.apiDocs.overallStats(commonData, request.identity))
    }
  }

  /**
   * Displays API documentation for the validations.
   */
  def validations = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_APIDocs_Validations")
      Ok(views.html.apiDocs.validations(commonData, request.identity))
    }
  }
}
