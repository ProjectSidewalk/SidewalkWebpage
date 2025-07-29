package modules

import controllers.base.{CustomControllerComponents, CustomControllerComponentsProvider}
import play.api.inject.{Binding, Module}
import play.api.{Configuration, Environment}

class CustomControllerModule extends Module {
  override def bindings(environment: Environment, configuration: Configuration): Seq[Binding[_]] = Seq(
    bind[CustomControllerComponents].toProvider[CustomControllerComponentsProvider]
  )
}
