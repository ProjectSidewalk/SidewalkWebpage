package controllers

import controllers.base.*
import formats.json.UserFormats.newsEmailSuppressionReads
import models.api.ApiModelUtils
import models.auth.{DefaultEnv, WithAdmin}
import models.user.{NewsEmailOptOutSource, NewsEmailSuppression}
import play.api.Configuration
import play.api.libs.json.{JsError, JsSuccess, Json}
import play.api.mvc.Result
import play.filters.csrf.CSRFAddToken
import play.silhouette.api.Silhouette
import service.{AuthenticationService, ConfigService, NewsEmailTokenService, UserService}

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

/** The newsletter's unsubscribe link, the admin export of who it may go to, and the bounce import (#5864). */
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

  /** The account an unsubscribe token names, if the token is there, genuine, and the account still exists. */
  private def tokenOwner(token: Option[String]): Future[Option[String]] = token.flatMap(tokens.userId) match {
    case Some(userId) => authenticationService.findByUserId(userId).map(_.map(_.userId))
    case None         => Future.successful(None)
  }

  /** The token is the credential, so it mustn't leak to other sites through the Referer header. */
  private def withoutReferrer(result: Result): Result = result.withHeaders("Referrer-Policy" -> "no-referrer")

  /** A CSV cell: quoted when needed, and kept from running as a formula when the file is opened in a spreadsheet. */
  private def csvCell(value: String): String = {
    val formulaStart = Set('=', '+', '-', '@', '\t', '\r')
    ApiModelUtils.escapeCsvField(if (value.headOption.exists(formulaStart.contains)) s"'$value" else value)
  }

  /** The confirm page behind the link. A GET changes nothing, since mail scanners follow links before the reader. */
  def unsubscribePage(token: Option[String]) = silhouette.UserAwareAction.async { implicit request =>
    val ownerLookup    = tokenOwner(token)
    val pageDataLookup = configService.getCommonPageData(request2Messages.lang)
    for {
      owner      <- ownerLookup
      commonData <- pageDataLookup
    } yield {
      cc.loggingService.insert(owner, request.ipAddress, s"Visit_Unsubscribe_valid=${owner.isDefined}")
      val page = views.html.newsEmail.unsubscribe(commonData, request.identity, token.getOrElse(""), _)
      withoutReferrer(if (owner.isDefined) Ok(page("confirm")) else NotFound(page("invalid")))
    }
  }

  /**
   * Opts the token's account out. Mail clients' one-click unsubscribe (RFC 8058) POSTs here with no session or CSRF
   * token, so the route is `nocsrf`, and `addCsrfToken` mints the token the navbar's forms need in its place.
   */
  def unsubscribe(token: Option[String]) = addCsrfToken(silhouette.UserAwareAction.async { implicit request =>
    tokenOwner(token).flatMap { owner =>
      for {
        _ <- owner
          .map(userId => userService.optOutOfNewsEmail(userId, NewsEmailOptOutSource.UnsubscribeLink))
          .getOrElse(Future.successful(0))
        commonData <- configService.getCommonPageData(request2Messages.lang)
      } yield {
        val page = views.html.newsEmail.unsubscribe(commonData, request.identity, token.getOrElse(""), _)
        withoutReferrer(owner match {
          case Some(userId) =>
            cc.loggingService.insert(
              userId,
              request.ipAddress,
              "Click_module=NewsEmail_subscribed=false_source=Unsubscribe"
            )
            Ok(page("done"))
          case None => NotFound(page("invalid"))
        })
      }
    }
  })

  /** The send list as a CSV, each row with its unsubscribe link on this city's domain. */
  def newsEmailRecipientsCsv = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    userService.getNewsEmailRecipients.map { recipients =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Click_module=DownloadNewsEmailRecipients")
      val rows = recipients.map { case (userId, username, email) =>
        val unsubscribeUrl = routes.NewsEmailController.unsubscribePage(Some(tokens.token(userId))).absoluteURL()
        Seq(userId, username, email, unsubscribeUrl).map(csvCell).mkString(",")
      }
      Ok(("user_id,username,email,unsubscribe_url" +: rows).mkString("\n"))
        .as("text/csv")
        .withHeaders(CONTENT_DISPOSITION -> "attachment; filename=\"news-email-recipients.csv\"")
    }
  }

  /**
   * Opts out the accounts behind the mail sender's suppression list, as `sync-news-suppressions.py` in
   * sidewalk-server-tools exports it. A bad row refuses the whole file, and a repeat import changes nothing.
   */
  def importNewsEmailSuppressions =
    cc.securityService.SecuredAction(WithAdmin(), parse.json(NewsEmailController.MaxSuppressionBytes)) {
      implicit request =>
        request.body.validate[Seq[NewsEmailSuppression]] match {
          case JsError(errors) =>
            // The first bad row and field is enough to fix the file by.
            val (path, problems) = errors.head
            val reason           = problems.flatMap(_.messages).mkString("; ")
            Future.successful(BadRequest(s"Not a suppression list ($path: $reason)"))
          case JsSuccess(suppressions, _) =>
            userService.importNewsEmailSuppressions(suppressions).map { optedOut =>
              cc.loggingService.insert(
                request.identity.userId,
                request.ipAddress,
                s"Click_module=ImportNewsEmailSuppressions_addresses=${suppressions.size}_optedOut=$optedOut"
              )
              Ok(Json.obj("addresses" -> suppressions.size, "opted_out" -> optedOut))
            }
        }
    }
}

object NewsEmailController {
  // Play stops a JSON body at 100 KB by default, which a few thousand rows would pass.
  val MaxSuppressionBytes: Long = 5L * 1024 * 1024
}
