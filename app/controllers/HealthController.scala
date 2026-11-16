package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import formats.json.HealthFormats.given
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}
import service.HealthService

import javax.inject.*
import scala.concurrent.ExecutionContext

/**
 * `GET /health` (#4548, #5138): which code this instance runs and whether its database answers, for deploy
 * verification and the ops liveness probe. A plain, unlogged Action because a probe hits it every few seconds in
 * every city: a SecuredAction would mint an anonymous account per hit and logging would flood `webpage_activity`.
 */
@Singleton
class HealthController @Inject() (cc: CustomControllerComponents, healthService: HealthService)(implicit
    ec: ExecutionContext
) extends CustomBaseController(cc) {

  /** 200 when the database answers, 503 otherwise; `no-store` so a cached answer can't pass a deploy check. */
  def health: Action[AnyContent] = Action.async { _ =>
    healthService.getHealthStatus.map { status =>
      noStore((if (status.status == "ok") Ok else ServiceUnavailable) (Json.toJson(status)))
    }
  }
}
