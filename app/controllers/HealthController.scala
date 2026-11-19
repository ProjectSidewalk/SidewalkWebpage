package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import formats.json.HealthFormats.given
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}
import service.{ConfigService, HealthService, MemoryReport}

import javax.inject.*
import scala.concurrent.ExecutionContext

/**
 * `GET /health` (#4548, #5138): which code this instance runs and whether its database and PostGIS answer, for deploy
 * verification and the ops liveness probe. A plain, unlogged Action because a probe hits it every few seconds in
 * every city: a SecuredAction would mint an anonymous account per hit and logging would flood `webpage_activity`.
 */
@Singleton
class HealthController @Inject() (
    cc: CustomControllerComponents,
    healthService: HealthService,
    configService: ConfigService
)(implicit ec: ExecutionContext)
    extends CustomBaseController(cc) {

  /** 200 when the database answers and loads PostGIS, 503 otherwise; `no-store` so a cached answer can't pass. */
  def health: Action[AnyContent] = Action.async { _ =>
    healthService.getHealthStatus.map { status =>
      noStore((if (status.status == "ok") Ok else ServiceUnavailable) (Json.toJson(status)))
    }
  }

  /**
   * `GET /health/memory` (#6022): how much memory this instance uses and where it goes. Public and unlogged like
   * `/health`, so one loop on the server can read every city without a session.
   */
  def memory: Action[AnyContent] = Action { _ =>
    noStore(Ok(Json.toJson(MemoryReport.read(configService.getCityId, configService.appStartTime))))
  }
}
