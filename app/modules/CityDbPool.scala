package modules

import play.api.Configuration

/** Gives low-traffic cities a smaller database pool, since every city's app shares one Postgres limit (#4563). */
object CityDbPool {
  private val slickDb = "slick.dbs.default.db"

  /** @return `config`, with the small pool sizes swapped in if its city is under `city-params.low-traffic`. */
  def applyTo(config: Configuration): Configuration = {
    val lowTraffic: Boolean = config
      .getOptional[String]("city-id")
      .exists(cityId => config.getOptional[Boolean](s"city-params.low-traffic.$cityId").contains(true))
    if (!lowTraffic) config
    else {
      val maxConnections: Int = config.get[Int]("db-pool.low-traffic.max-connections")
      val minConnections: Int = config.get[Int]("db-pool.low-traffic.min-connections")
      // Slick needs one thread per connection, so the two always move together.
      Configuration(
        s"$slickDb.numThreads"     -> maxConnections,
        s"$slickDb.maxConnections" -> maxConnections,
        s"$slickDb.minConnections" -> minConnections
      ).withFallback(config)
    }
  }
}
