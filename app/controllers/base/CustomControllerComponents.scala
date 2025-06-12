package controllers.base

import play.api.http.FileMimeTypes
import play.api.i18n.MessagesApi
import play.api.mvc._
import service.{CustomSecurityService, LoggingService}

import javax.inject._
import scala.concurrent.ExecutionContext

/**
 * Custom components bundle for controllers.
 */
case class CustomControllerComponents(
                                       // Standard Play components.
                                       actionBuilder: DefaultActionBuilder,
                                       parsers: PlayBodyParsers,
                                       messagesApi: MessagesApi,
                                       langs: play.api.i18n.Langs,
                                       fileMimeTypes: FileMimeTypes,
                                       executionContext: ExecutionContext,

                                       // Commonly used services or utilities to inject into controllers.
                                       loggingService: LoggingService,
                                       securityService: CustomSecurityService
                                     ) extends ControllerComponents

@Singleton
class CustomControllerComponentsProvider @Inject()(actionBuilder: DefaultActionBuilder,
                                                   parsers: PlayBodyParsers,
                                                   messagesApi: MessagesApi,
                                                   langs: play.api.i18n.Langs,
                                                   fileMimeTypes: FileMimeTypes,
                                                   executionContext: ExecutionContext,
                                                   loggingService: LoggingService,
                                                   securityService: CustomSecurityService
                                                  ) extends Provider[CustomControllerComponents] {

  override def get(): CustomControllerComponents = {
    CustomControllerComponents(
      actionBuilder,
      parsers,
      messagesApi,
      langs,
      fileMimeTypes,
      executionContext,
      loggingService,
      securityService
    )
  }
}
