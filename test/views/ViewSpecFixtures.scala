package views

import controllers.AssetsFinder
import models.user.{Role, SidewalkUserWithRole}
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.i18n.{Lang, Messages, MessagesApi}
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.mvc.RequestHeader
import play.api.test.{CSRFTokenHelper, FakeRequest}
import play.api.{Application, Configuration}
import service.{CommonPageData, ConfigService}

import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

/**
 * The scaffolding a view spec needs to render a template outside a request: a booted app, the implicits every
 * template's parameter list asks for, and a signed-in user to render as.
 *
 * The request carries a CSRF token because several of these pages hold a form, and `CSRF.formField` throws without
 * one rather than rendering empty.
 */
trait ViewSpecFixtures extends GuiceOneAppPerSuite { self: org.scalatest.TestSuite =>

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit protected val request: RequestHeader = CSRFTokenHelper.addCSRFToken(FakeRequest())
  implicit protected val messages: Messages     = app.injector.instanceOf[MessagesApi].preferred(Seq(Lang("en")))
  implicit protected val assets: AssetsFinder   = app.injector.instanceOf[AssetsFinder]
  implicit protected val config: Configuration  = app.injector.instanceOf[Configuration]

  protected val commonData: CommonPageData =
    Await.result(app.injector.instanceOf[ConfigService].getCommonPageData(Lang("en")), 60.seconds)

  protected val user: SidewalkUserWithRole =
    SidewalkUserWithRole("test-user", "testmapper", "test@example.com", Role.Registered, communityService = false,
      infra3dAccess = false)
}
