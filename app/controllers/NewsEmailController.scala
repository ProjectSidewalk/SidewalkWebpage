package controllers

import controllers.base.*
import models.api.ApiModelUtils
import models.auth.{DefaultEnv, WithAdmin}
import models.user.NewsEmailOptOutSource
import play.api.Configuration
import play.filters.csrf.CSRFAddToken
import play.silhouette.api.Silhouette
import service.{AuthenticationService, ConfigService, NewsEmailTokenService, UserService}

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

/** The newsletter's unsubscribe link and the admin export of who it may go to (#5864). */
@Singleton
class NewsEmailController @Inject() (
    cc: CustomControllerComponents,
    config: Configuration,
    silhouette: Silhouette[DefaultEnv],
    configService: ConfigService,
    userService: UserService,
    authenticationService: AuthenticationService,
    tokens: NewsEmailTokenService,
    addCsrfToken: CSRFAddToken
)(using assets: AssetsFinder, ec: ExecutionContext)
    extends CustomBaseController(cc) {

  given Configuration = config

  /** The account an unsubscribe token names, if the token is genuine and the account still exists. */
  private def tokenOwner(token: String): Future[Option[String]] = tokens.userId(token) match {
    case Some(userId) => authenticationService.findByUserId(userId).map(_.map(_.userId))
    case None         => Future.successful(None)
  }

  /** The confirm page behind the link. A GET changes nothing, since mail scanners follow links before the reader. */
  def unsubscribePage(token: String) = silhouette.UserAwareAction.async { implicit request =>
    for {
      owner      <- tokenOwner(token)
      commonData <- configService.getCommonPageData(request2Messages.lang)
    } yield {
      cc.loggingService.insert(owner, request.ipAddress, s"Visit_Unsubscribe_valid=${owner.isDefined}")
      val page = views.html.newsEmail.unsubscribe(commonData, request.identity, token, _)
      if (owner.isDefined) Ok(page("confirm")) else NotFound(page("invalid"))
    }
  }

  /**
   * Opts the token's account out. Mail clients' one-click unsubscribe (RFC 8058) POSTs here with no session or CSRF
   * token, so the route is `nocsrf`; the skipped filter would have minted the token the navbar's forms render, so
   * `addCsrfToken` does instead.
   */
  def unsubscribe(token: String) = addCsrfToken(silhouette.UserAwareAction.async { implicit request =>
    tokenOwner(token).flatMap { owner =>
      for {
        _ <- owner
          .map(userId => userService.optOutOfNewsEmail(userId, NewsEmailOptOutSource.UnsubscribeLink))
          .getOrElse(Future.successful(0))
        commonData <- configService.getCommonPageData(request2Messages.lang)
      } yield {
        val page = views.html.newsEmail.unsubscribe(commonData, request.identity, token, _)
        owner match {
          case Some(userId) =>
            cc.loggingService.insert(
              userId,
              request.ipAddress,
              "Click_module=NewsEmail_subscribed=false_source=Unsubscribe"
            )
            Ok(page("done"))
          case None => NotFound(page("invalid"))
        }
      }
    }
  })

  /** The send list as a CSV, each row with its unsubscribe link on this city's domain. */
  def newsEmailRecipientsCsv = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    userService.getNewsEmailRecipients.map { recipients =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Click_module=DownloadNewsEmailRecipients")
      val rows = recipients.map { case (userId, username, email) =>
        val unsubscribeUrl = routes.NewsEmailController.unsubscribePage(tokens.token(userId)).absoluteURL()
        Seq(userId, username, email, unsubscribeUrl).map(ApiModelUtils.escapeCsvField).mkString(",")
      }
      Ok(("user_id,username,email,unsubscribe_url" +: rows).mkString("\n"))
        .as("text/csv")
        .withHeaders(CONTENT_DISPOSITION -> "attachment; filename=\"news-email-recipients.csv\"")
    }
  }
}
