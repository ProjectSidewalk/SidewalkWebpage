import play.api.ApplicationLoader
import play.api.inject.guice.{GuiceApplicationBuilder, GuiceApplicationLoader}

class CustomApplicationLoader extends GuiceApplicationLoader {
  override def builder(context: ApplicationLoader.Context): GuiceApplicationBuilder = {
    super
      .builder(context)
      .in(context.environment)
      .loadConfig(context.initialConfiguration)
  }
}
