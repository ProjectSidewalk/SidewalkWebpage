package modules

import controllers.api._
import play.api.{Configuration, Environment}
import play.api.inject.{Binding, Module}

class ApiModule extends Module {
  override def bindings(environment: Environment, configuration: Configuration): Seq[Binding[_]] = Seq(
    bind[AccessScoreApiController].toSelf.eagerly(),
    bind[LabelApiController].toSelf.eagerly(),
    bind[LabelClustersApiController].toSelf.eagerly(),
    bind[RegionApiController].toSelf.eagerly(),
    bind[StatsApiController].toSelf.eagerly(),
    bind[RegionApiController].toSelf.eagerly()
  )
}
