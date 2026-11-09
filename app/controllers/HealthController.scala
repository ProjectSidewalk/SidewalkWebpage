package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import formats.json.HealthFormats.{HealthStatus, given}
import models.utils.{BuildInfo, VersionTable}
import play.api.{Configuration, Logger}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}
import service.ConfigService

import java.time.OffsetDateTime
import javax.inject.*
import scala.concurrent.ExecutionContext

/**
 * `GET /health` (#4548, #5138): which code this instance runs and whether its database answers, for deploy
 * verification and the ops liveness probe. A plain, unlogged Action because a probe hits it every few seconds in
 * every city: a SecuredAction would mint an anonymous account per hit and logging would flood `webpage_activity`.
 */
@Singleton
class HealthController @Inject() (
    cc: CustomControllerComponents,
    config: Configuration,
    configService: ConfigService,
    versionTable: VersionTable
)(implicit ec: ExecutionContext)
    extends CustomBaseController(cc) {

  private val logger = Logger(this.getClass)

  private val envType: String = config.get[String]("environment-type")

  /** 200 when the database answers, 503 otherwise. Uncached read and `no-store` so every probe is a real check. */
  def health: Action[AnyContent] = Action.async { _ =>
    versionTable
      .currentVersion()
      .map { version => Ok(Json.toJson(report("ok", Some(version.versionId), Some(version.versionStartTime)))) }
      .recover { case e: Exception =>
        logger.warn(s"Health check failed to read the version table: ${e.getMessage}")
        ServiceUnavailable(Json.toJson(report("error", None, None)))
      }
      .map(noStore)
  }

  private def report(status: String, version: Option[String], releasedAt: Option[OffsetDateTime]) =
    HealthStatus(status, BuildInfo.gitSha, BuildInfo.gitDescribe, BuildInfo.gitDirty, version, releasedAt,
      configService.getCityId, envType, configService.appStartTime)
}
