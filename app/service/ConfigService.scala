package service

import com.google.inject.ImplementedBy
import com.typesafe.config.ConfigException
import models.api.DailyStatRecord
import models.label.LabelTypeEnum
import models.pano.PanoSource
import models.pano.PanoSource.PanoSource
import models.utils.MyPostgresProfile.api._
import models.utils._
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.i18n.{Lang, MessagesApi}
import play.api.libs.ws.WSClient
import play.api.{Configuration, Logger}
import slick.dbio.DBIO

import java.time.{LocalDate, OffsetDateTime}
import javax.inject._
import scala.concurrent.duration.Duration
import scala.concurrent.{ExecutionContext, Future}
import scala.reflect.ClassTag

case class CityInfo(
    cityId: String,
    stateId: Option[String],
    countryId: String,
    cityNameShort: String,
    cityNameFormatted: String,
    URL: String,
    visibility: String
)
case class CommonPageData(
    cityId: String,
    environmentType: String,
    googleAnalyticsId: String,
    prodUrl: String,
    imagerySource: PanoSource,
    imageryAccessToken: String,
    gMapsApiKey: String,
    mapboxApiKey: String,
    versionId: String,
    versionTimestamp: OffsetDateTime,
    allCityInfo: Seq[CityInfo]
)

/**
 * Represents label statistics for a specific label type.
 *
 * @param labels Total number of labels for this type
 * @param labelsValidated Total number of labels validated for this type
 * @param labelsValidatedAgree Number of validated labels that were agreed upon
 * @param labelsValidatedDisagree Number of validated labels that were disagreed upon
 */
case class LabelTypeStats(
    labels: Int,
    labelsValidated: Int,
    labelsValidatedAgree: Int,
    labelsValidatedDisagree: Int
)

/**
 * Represents aggregate statistics across all Project Sidewalk deployments.
 *
 * @param kmExplored Total kilometers explored across all cities
 * @param kmExploredNoOverlap Total kilometers explored without overlap across all cities
 * @param totalLabels Total number of (non-tutorial) labels across all cities. Equals the sum of `byLabelType` label
 *                    counts by construction (#3981), so the per-type breakdown always reconciles with this total.
 * @param tutorialLabels Total number of practice/tutorial labels across all cities. Tracked separately because tutorial
 *                       labels are excluded from `totalLabels` and `byLabelType` (they would skew the per-type ratios).
 * @param totalValidations Total number of validations across all cities
 * @param totalUsers Number of distinct contributors across all cities — users who added at least one (non-tutorial)
 *                   label or validated at least one label. Counted as distinct people: because `user_id` is a global
 *                   identifier shared across city schemas, a user active in multiple cities is counted once (the union
 *                   of contributor ids, not the sum of per-city counts). The legacy DC deployment contributes a fixed
 *                   historical estimate (`legacyDCUserCount`) since it has no per-user records.
 * @param numCities Number of cities where Project Sidewalk is deployed
 * @param numCountries Number of countries where Project Sidewalk is deployed
 * @param numLanguages Number of distinct languages supported
 * @param byLabelType Map of label type to its statistics
 */
case class AggregateStats(
    kmExplored: Double,
    kmExploredNoOverlap: Double,
    totalLabels: Int,
    tutorialLabels: Int,
    totalValidations: Int,
    totalUsers: Int,
    numCities: Int,
    numCountries: Int,
    numLanguages: Int,
    byLabelType: Map[String, LabelTypeStats]
)

@ImplementedBy(classOf[ConfigServiceImpl])
trait ConfigService {

  /**
   * Maps a city ID to its corresponding database user/schema.
   *
   * @param cityId The ID of the city
   * @return The database user/schema for the city
   */
  def getCitySchema(cityId: String): String

  /**
   * Retrieves map parameters for a specific city by directly querying that city's database schema.
   *
   * This method attempts to retrieve map parameters (center coordinates, zoom level, and boundary coordinates) for the
   * specified city by querying its database schema. Gets geographic info about cities other than the current one.
   *
   * @param cityId The ID of the city to retrieve map parameters for
   * @return A Future containing an Option[MapParams]. The Option will be:
   *         - Some(mapParams) if parameters were successfully retrieved
   *         - None if parameters could not be retrieved (e.g., schema not found or query failed)
   */
  def getCityMapParamsBySchema(cityId: String): Future[Option[MapParams]]

  /**
   * Calculates aggregate statistics across all Project Sidewalk deployments.
   *
   * Fetches statistics from all configured cities by querying their respective db schemas and aggregating the results.
   *
   * @return A Future containing aggregated statistics across all cities
   */
  def getAggregateStats(): Future[AggregateStats]

  /**
   * Returns daily label and validation counts aggregated across all configured cities.
   *
   * Queries each city schema in parallel and sums counts by (date, labelType) across cities.
   * Cities whose schemas do not exist in the current environment are silently skipped (same
   * guard as getAggregateStats). The legacy DC dataset is omitted because its schema predates
   * the label_validation table format used here.
   *
   * @param startDate        Inclusive start date (Pacific time); no lower bound if None.
   * @param endDate          Inclusive end date; no upper bound if None.
   * @param filterLowQuality If true, restrict to high-quality users.
   * @return                 Merged, sorted sequence of DailyStatRecord summed across all cities.
   */
  def getAggregateStatsByDay(
      startDate: Option[LocalDate],
      endDate: Option[LocalDate],
      filterLowQuality: Boolean
  ): Future[Seq[DailyStatRecord]]

  def getCityMapParams: Future[MapParams]
  def getTutorialStreetId: Future[Int]
  def getMakeCrops: Future[Boolean]
  def getMapathonEventLink: Future[Option[String]]
  def getOpenStatus: Future[String]
  def getOffsetHours: Future[Int]
  def getExcludedTags: DBIO[Seq[ExcludedTag]]
  def getAllCityInfo(lang: Lang): Seq[CityInfo]
  def getCityId: String
  def getCurrentCountryId: String
  def getCityName(lang: Lang): String
  def getAiTagSuggestionsEnabled: Boolean
  def getPanoSource: PanoSource
  def sendSciStarterContributions(email: String, contributions: Int, timeSpent: Double): Future[Int]
  def cachedDBIO[T: ClassTag](key: String, duration: Duration = Duration.Inf)(dbOperation: => DBIO[T]): DBIO[T]
  def getCommonPageData(lang: Lang): Future[CommonPageData]
}

@Singleton
class ConfigServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    messagesApi: MessagesApi,
    cacheApi: AsyncCacheApi,
    ws: WSClient,
    configTable: ConfigTable,
    versionTable: VersionTable,
    panoDataService: PanoDataService
)(implicit val ec: ExecutionContext)
    extends ConfigService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  private val logger = Logger(this.getClass)

  /**
   * Per-label-type counts for the original DC deployment (2015–2017), preserved from the historical spreadsheet:
   * https://docs.google.com/spreadsheets/d/1eTwVuEIz2lV-LD-Vz_5knNoyGgzmH5kERsQ0y_jGHDE/
   *
   * That deployment used an outdated schema too costly to migrate, so these hard-coded counts are folded into the
   * aggregate stats to represent Project Sidewalk's full historical scope. DC only ever had these seven label types
   * (Crosswalk and Pedestrian Signal did not exist yet).
   *
   * These per-type rows sum to 249,905. The spreadsheet also lists 263,403, which is the UNFILTERED count: the
   * ~13,498 difference is DC's tutorial labels plus "junk"-user labels (low-quality users Mikey identified by manual
   * assessment) — exactly the labels our stats exclude elsewhere via `tutorial = FALSE` and `NOT user_stat.excluded`.
   * So 249,905 is the correct filtered `total_labels` (consistent with how live cities are counted), and 263,403 must
   * NOT be used as the total. `legacyDCData.totalLabels` is therefore derived from this breakdown (#3981).
   */
  private val legacyDCByLabelType: Map[String, LabelTypeStats] = Map(
      LabelTypeEnum.CurbRamp.name -> LabelTypeStats(
        labels = 150680,
        labelsValidated = 0,
        labelsValidatedAgree = 0,
        labelsValidatedDisagree = 0
      ),
      LabelTypeEnum.NoCurbRamp.name -> LabelTypeStats(
        labels = 19792,
        labelsValidated = 0,
        labelsValidatedAgree = 0,
        labelsValidatedDisagree = 0
      ),
      LabelTypeEnum.Obstacle.name -> LabelTypeStats(
        labels = 22264,
        labelsValidated = 0,
        labelsValidatedAgree = 0,
        labelsValidatedDisagree = 0
      ),
      LabelTypeEnum.SurfaceProblem.name -> LabelTypeStats(
        labels = 8964,
        labelsValidated = 0,
        labelsValidatedAgree = 0,
        labelsValidatedDisagree = 0
      ),
      LabelTypeEnum.NoSidewalk.name -> LabelTypeStats(
        labels = 45395,
        labelsValidated = 0,
        labelsValidatedAgree = 0,
        labelsValidatedDisagree = 0
      ),
      LabelTypeEnum.Other.name -> LabelTypeStats(
        labels = 1471,
        labelsValidated = 0,
        labelsValidatedAgree = 0,
        labelsValidatedDisagree = 0
      ),
      LabelTypeEnum.Occlusion.name -> LabelTypeStats(
        labels = 1339,
        labelsValidated = 0,
        labelsValidatedAgree = 0,
        labelsValidatedDisagree = 0
      )
      // Note: Crosswalk and Signal data not available (NA) for DC legacy deployment.
    )

  /**
   * DC's UNFILTERED historical label count from the source spreadsheet (gid=963888605 tab):
   * https://docs.google.com/spreadsheets/d/1eTwVuEIz2lV-LD-Vz_5knNoyGgzmH5kERsQ0y_jGHDE/edit?gid=963888605#gid=963888605
   *
   * This counts everything, including tutorial and low-quality "junk"-user labels. It is NOT the reportable total — see
   * `legacyDCData` for how the filtered total and `tutorialLabels` are derived from it.
   */
  private val legacyDCUnfilteredLabelCount = 263403

  /**
   * Distinct contributors from the legacy DC deployment, a fixed historical estimate (#3976).
   *
   * The archived DC dataset has no per-user records we can query, so unlike live cities its user count can't be derived
   * from the union of contributor ids. This value (from the gid=963888605 tab of the DC spreadsheet linked above) is
   * added on top of the live-city distinct-user union in getAggregateStats. DC user_ids don't exist in current schemas,
   * so there is nothing to dedup against — the addition is exact.
   */
  private val legacyDCUserCount = 1395

  /**
   * Legacy DC deployment rolled into an AggregateStats so getAggregateStats can sum it alongside live cities.
   *
   * `totalLabels` is derived from `legacyDCByLabelType` (249,905, the filtered count), NOT the unfiltered 263,403
   * headline, so the per-type breakdown always reconciles with the total (see `legacyDCByLabelType` above).
   *
   * `tutorialLabels` is the gap between the unfiltered count and the filtered total (263,403 − 249,905 = 13,498) so
   * DC's numbers close cleanly back to the historical headline. CAVEAT: for live cities `tutorialLabels` is strictly
   * `tutorial = TRUE` labels, but DC's export can't separate tutorial from junk-user labels, so this single legacy
   * value bundles both and is really an UPPER BOUND on DC's tutorial labels. Documented as such in the API docs.
   *
   * Validations were never implemented during the DC deployment, so `totalValidations` is 0.
   *
   * `totalUsers` is 0 here: DC's contributors are added separately via `legacyDCUserCount` (they can't be deduped by
   * union like live-city users), so this field must NOT also contribute to the aggregate user count.
   */
  private val legacyDCData = AggregateStats(
    kmExplored = 5482.0,
    kmExploredNoOverlap = 1747, // Mikey calculated this for us on July 18, 2025
    totalLabels = legacyDCByLabelType.values.map(_.labels).sum,
    tutorialLabels = legacyDCUnfilteredLabelCount - legacyDCByLabelType.values.map(_.labels).sum,
    totalValidations = 0,
    totalUsers = 0,
    numCities = 0,
    numCountries = 0,
    numLanguages = 0,
    byLabelType = legacyDCByLabelType
  )

  /**
   * Maps a city ID to its corresponding database user/schema. The mapping is loaded from configuration.
   *
   * @param cityId The ID of the city.
   * @return The database schema name for the city.
   * @throws com.typesafe.config.ConfigException.Missing if the cityId is not found in the configuration
   */
  def getCitySchema(cityId: String): String = {
    // Try to get schema from configuration.
    val configPath = s"city-params.db-schema.$cityId"
    try {
      config.get[String](configPath)
    } catch {
      case e: ConfigException => // Catching any ConfigException (or be more specific like ConfigException.Missing).
        val errorMessage = s"Configuration error for city ID '$cityId' at path '$configPath'."
        // Log the error, including the original exception's stack trace.
        logger.error(errorMessage, e)
        throw e // Rethrow the original caught exception.
    }
  }

  /**
   * Retrieves map parameters for a specific city by directly querying that city's database schema.
   *
   * This method handles the special case of the current city separately, as it can use the standard method that doesn't
   * require cross-schema access. For other cities, it resolves the schema name and queries that schema. Results are
   * cached to improve performance.
   *
   * @param cityId The ID of the city to retrieve map parameters for
   * @return A Future containing an Option[MapParams]
   */
  def getCityMapParamsBySchema(cityId: String): Future[Option[MapParams]] = {
    // For the current city, use the standard method which doesn't require cross-schema access.
    if (cityId == getCityId) {
      getCityMapParams.map(Some(_))
    } else {
      // For other cities, get the schema name and query that schema.
      val schema = getCitySchema(cityId)

      // Use cache to avoid repeated database queries.
      cacheApi.getOrElseUpdate[Option[MapParams]](s"getMapParams_$cityId", Duration(1, "days")) {
        try {
          // Attempt to run the database query.
          db.run(configTable.getCityMapParamsBySchema(schema))
            .map(Some(_)) // Wrap successful result in Some.
            .recover { case e: Exception =>
              // Log failures but don't propagate exceptions.
              logger.warn(s"Failed to retrieve map params for city $cityId from schema $schema: ${e.getMessage}")
              None // Return None when query fails.
            }
        } catch {
          case e: Exception =>
            // Handle exceptions during query preparation (rare).
            logger.error(s"Exception setting up query for city $cityId: ${e.getMessage}", e)
            Future.successful(None)
        }
      }
    }
  }

  /**
   * Calculates aggregate statistics across all Project Sidewalk deployments.
   *
   * This method uses direct database queries with cross-schema access to efficiently gather only the essential
   * statistics from all configured cities. It filters out cities whose schemas don't exist in the current environment
   * (so plays nice with localhost dev setups). Additionally, calculates deployment counts for cities, countries, and
   * supported languages.
   *
   * @return A Future containing aggregated statistics across all cities
   */
  def getAggregateStats(): Future[AggregateStats] = {
    // Use cache to avoid repeated expensive calculations.
    cacheApi.getOrElseUpdate[AggregateStats]("getAggregateStats", Duration(5, "minutes")) {
      // Get all configured city IDs.
      val configuredCityIds = config.get[Seq[String]]("city-params.city-ids")

      // Filter to only include cities whose schemas actually exist in the database.
      val schemaExistenceChecks: Seq[Future[(String, Boolean)]] = configuredCityIds.map { cityId =>
        try {
          val schema = getCitySchema(cityId)
          // Check if the schema actually exists in the database.
          checkSchemaExists(schema).map(cityId -> _).recover { case _ => cityId -> false }
        } catch {
          case _: Exception =>
            Future.successful(cityId -> false)
        }
      }

      // Wait for all schema checks to complete.
      Future.sequence(schemaExistenceChecks).flatMap { schemaResults =>
        val availableCities = schemaResults.filter(_._2).map(_._1)

        if (availableCities.isEmpty) {
          logger.warn("No cities with valid schemas found")
          Future.successful(
            AggregateStats(
              kmExplored = 0.0, kmExploredNoOverlap = 0.0, totalLabels = 0, tutorialLabels = 0, totalValidations = 0,
              totalUsers = 0, numCities = 0, numCountries = 0, numLanguages = 0, byLabelType = Map.empty
            )
          )
        } else {
          // Calculate deployment statistics.
          val numCities    = availableCities.length + 1 // +1 for legacy DC city
          val numCountries = calculateNumCountries(availableCities)
          val numLanguages = calculateNumLanguages()

          // Fetch essential statistics from available cities in parallel.
          val cityStatsFutures: Seq[Future[Option[AggregateStats]]] = availableCities.map { cityId =>
            getCityAggregateData(cityId)
          }

          // Distinct contributors across all live cities, deduped by the global `user_id` then DC added on top (#3976).
          // Computed by unioning per-city contributor-id sets rather than summing per-city counts, so a user active in
          // multiple cities is counted once. Each city recovers to an empty set so one bad schema can't sink the count.
          val distinctUsersFut: Future[Int] = Future
            .sequence(availableCities.map { cityId =>
              db.run(configTable.getContributorUserIdsBySchema(getCitySchema(cityId)))
                .map(_.toSet)
                .recover { case e: Exception =>
                  logger.warn(s"Failed to retrieve contributor ids for city $cityId: ${e.getMessage}")
                  Set.empty[String]
                }
            })
            .map(perCity => perCity.foldLeft(Set.empty[String])(_ ++ _).size + legacyDCUserCount)

          // Wait for all futures to complete and aggregate results.
          Future.sequence(cityStatsFutures).zip(distinctUsersFut).map { case (cityStatsOptions, totalUsers) =>
            // Filter out failed requests and aggregate the successful ones.
            val validCityStats = cityStatsOptions.flatten

            if (validCityStats.isEmpty) {
              logger.warn("No valid city statistics found for aggregate calculation")
              // Return empty aggregate stats if no cities provided data.
              AggregateStats(
                kmExplored = 0.0, kmExploredNoOverlap = 0.0, totalLabels = 0, tutorialLabels = 0, totalValidations = 0,
                totalUsers = 0, numCities = numCities, numCountries = numCountries, numLanguages = numLanguages,
                byLabelType = Map.empty
              )
            } else {
              // Add legacy DC data to the valid city stats before aggregating.
              aggregateCityData(validCityStats :+ legacyDCData, numCities, numCountries, numLanguages, totalUsers)
            }
          }
        }
      }
    }
  }

  def getAggregateStatsByDay(
      startDate: Option[LocalDate],
      endDate: Option[LocalDate],
      filterLowQuality: Boolean
  ): Future[Seq[DailyStatRecord]] = {
    val configuredCityIds = config.get[Seq[String]]("city-params.city-ids")

    val schemaChecks = configuredCityIds.map { cityId =>
      try {
        val schema = getCitySchema(cityId)
        checkSchemaExists(schema).map(cityId -> _).recover { case _ => cityId -> false }
      } catch {
        case _: Exception => Future.successful(cityId -> false)
      }
    }

    Future.sequence(schemaChecks).flatMap { results =>
      val availableCities = results.filter(_._2).map(_._1)

      if (availableCities.isEmpty) {
        Future.successful(Seq.empty)
      } else {
        val cityDataFutures = availableCities.map { cityId =>
          val schema = getCitySchema(cityId)
          val labelsFuture = db.run(configTable.getCityDailyLabelStatsBySchema(schema, startDate, endDate,
            filterLowQuality))
            .recover { case e: Exception =>
              logger.warn(s"Failed daily label stats for city $cityId: ${e.getMessage}")
              Seq.empty[(LocalDate, String, Int, Int)]
            }
          val valsFuture = db.run(configTable.getCityDailyValidationStatsBySchema(schema, startDate, endDate,
            filterLowQuality))
            .recover { case e: Exception =>
              logger.warn(s"Failed daily validation stats for city $cityId: ${e.getMessage}")
              Seq.empty[(LocalDate, String, Int, Int, Int, Int, Int, Int)]
            }
          for {
            labels      <- labelsFuture
            validations <- valsFuture
          } yield DailyStatRecord.merge(labels, validations)
        }

        Future.sequence(cityDataFutures).map { cityResults =>
          // Sum all numeric fields across cities, grouped by (date, labelType).
          cityResults.flatten
            .groupBy(r => (r.date, r.labelType))
            .map { case ((date, labelType), records) =>
              DailyStatRecord(
                date                     = date,
                labelType                = labelType,
                humanLabels              = records.map(_.humanLabels).sum,
                aiLabels                 = records.map(_.aiLabels).sum,
                humanValidationsAgree    = records.map(_.humanValidationsAgree).sum,
                humanValidationsDisagree = records.map(_.humanValidationsDisagree).sum,
                humanValidationsUnsure   = records.map(_.humanValidationsUnsure).sum,
                aiValidationsAgree       = records.map(_.aiValidationsAgree).sum,
                aiValidationsDisagree    = records.map(_.aiValidationsDisagree).sum,
                aiValidationsUnsure      = records.map(_.aiValidationsUnsure).sum
              )
            }
            .toSeq.sortBy(r => (r.date, r.labelType))
        }
      }
    }
  }

  /**
   * Fetches essential aggregate data for a specific city using direct database access.
   * This method does NOT use caching since it's called from within a cached context.
   *
   * @param cityId The ID of the city to retrieve statistics for
   * @return A Future containing optional aggregate data for the city
   */
  private def getCityAggregateData(cityId: String): Future[Option[AggregateStats]] = {
    // Get the schema name.
    val schemaResult =
      try {
        Some(getCitySchema(cityId))
      } catch {
        case e: Exception =>
          logger.error(s"Failed to get schema for city $cityId: ${e.getMessage}", e)
          None
      }

    schemaResult match {
      case Some(schema) =>
        try {
          // Direct database query without additional caching.
          db.run(configTable.getCityAggregateDataBySchema(schema))
            .map(Some(_)) // Wrap successful result in Some
            .recover { case e: Exception =>
              // Log failures but don't propagate exceptions.
              logger.warn(s"Failed to retrieve aggregate data for city $cityId from schema $schema: ${e.getMessage}")
              None // Return None when query fails
            }
        } catch {
          case e: Exception =>
            // Handle exceptions during query preparation.
            logger.error(s"Exception setting up aggregate data query for city $cityId: ${e.getMessage}", e)
            Future.successful(None)
        }
      case None =>
        Future.successful(None)
    }
  }

  /**
   * Calculates the number of unique countries from available cities.
   *
   * @param cityIds List of available city IDs
   * @return Number of unique countries
   */
  private def calculateNumCountries(cityIds: Seq[String]): Int = {
    val countries = cityIds.flatMap { cityId =>
      try {
        Some(config.get[String](s"city-params.country-id.$cityId"))
      } catch {
        case e: ConfigException =>
          logger.warn(s"Could not get country ID for city $cityId: ${e.getMessage}")
          None
      }
    }.toSet
    countries.size
  }

  /**
   * Calculates the number of supported languages from configuration.
   *
   * Language variants (e.g., "en-US", "zh-TW", "es-MX") are grouped by their base language code
   * following ISO 639-1 standard where the part before the hyphen represents the base language.
   * For example: "en", "en-US", "en-NZ" all count as one language (English).
   *
   * @return Number of distinct base languages supported
   */
  private def calculateNumLanguages(): Int = {
    try {
      val configuredLanguages = config.get[Seq[String]]("play.i18n.langs")

      // Extract base language codes by taking everything before the first hyphen
      val baseLanguages = configuredLanguages.map { lang => lang.split("-").head.toLowerCase }.toSet

      baseLanguages.size
    } catch {
      case e: ConfigException =>
        logger.warn(s"Could not get language configuration: ${e.getMessage}")
        1 // Default to 1 if configuration is missing
    }
  }

  /**
   * Aggregates data from multiple cities into a single result.
   *
   * This method combines the individual city data into aggregate totals and includes deployment statistics.
   *
   * @param cityData Sequence of city aggregate data to combine
   * @param numCities Number of cities in deployment
   * @param numCountries Number of countries in deployment
   * @param numLanguages Number of languages supported
   * @param totalUsers Distinct contributors across all deployments. Passed in (like numCountries/numLanguages) rather
   *                   than summed from `cityData`, because it is a cross-schema deduped union, not a per-city sum (#3976).
   * @return Aggregated statistics across all provided cities
   */
  private def aggregateCityData(
      cityData: Seq[AggregateStats],
      numCities: Int,
      numCountries: Int,
      numLanguages: Int,
      totalUsers: Int
  ): AggregateStats = {
    import scala.collection.mutable

    // Aggregate basic metrics.
    val totalKmExplored          = cityData.map(_.kmExplored).sum
    val totalKmExploredNoOverlap = cityData.map(_.kmExploredNoOverlap).sum
    val totalLabelsCount         = cityData.map(_.totalLabels).sum
    val tutorialLabelsCount      = cityData.map(_.tutorialLabels).sum
    val totalValidationsCount    = cityData.map(_.totalValidations).sum

    // Aggregate label type statistics.
    val labelTypeStatsMap = mutable.Map[String, LabelTypeStats]()

    cityData.foreach { city =>
      city.byLabelType.foreach { case (labelType, stats) =>
        val currentStats = labelTypeStatsMap.getOrElse(labelType, LabelTypeStats(0, 0, 0, 0))

        // Update the aggregated stats.
        labelTypeStatsMap(labelType) = LabelTypeStats(
          labels = currentStats.labels + stats.labels,
          labelsValidated = currentStats.labelsValidated + stats.labelsValidated,
          labelsValidatedAgree = currentStats.labelsValidatedAgree + stats.labelsValidatedAgree,
          labelsValidatedDisagree = currentStats.labelsValidatedDisagree + stats.labelsValidatedDisagree
        )
      }
    }

    AggregateStats(
      kmExplored = totalKmExplored, kmExploredNoOverlap = totalKmExploredNoOverlap, totalLabels = totalLabelsCount,
      tutorialLabels = tutorialLabelsCount, totalValidations = totalValidationsCount, totalUsers = totalUsers,
      numCities = numCities, numCountries = numCountries, numLanguages = numLanguages,
      byLabelType = labelTypeStatsMap.toMap
    )
  }

  /**
   * Checks if a database schema exists.
   *
   * @param schemaName The name of the schema to check
   * @return A Future containing true if the schema exists, false otherwise
   */
  private def checkSchemaExists(schemaName: String): Future[Boolean] = {
    db.run(
      sql"""
        SELECT EXISTS(
          SELECT 1
          FROM information_schema.schemata
          WHERE schema_name = $schemaName
        )
      """.as[Boolean].head
    ).recover { case _ => false }
  }

  def getCityMapParams: Future[MapParams] =
    cacheApi.getOrElseUpdate[MapParams]("getCityMapParams")(db.run(configTable.getCityMapParams))

  def getTutorialStreetId: Future[Int] =
    cacheApi.getOrElseUpdate[Int]("getTutorialStreetId")(db.run(configTable.getTutorialStreetId))

  def getMakeCrops: Future[Boolean] =
    cacheApi.getOrElseUpdate[Boolean]("getMakeCrops")(db.run(configTable.getMakeCrops))

  def getMapathonEventLink: Future[Option[String]] =
    cacheApi.getOrElseUpdate[Option[String]]("getMapathonEventLink")(db.run(configTable.getMapathonEventLink))

  def getOpenStatus: Future[String] =
    cacheApi.getOrElseUpdate[String]("getOpenStatus")(db.run(configTable.getOpenStatus))

  def getOffsetHours: Future[Int] = cacheApi.getOrElseUpdate[Int]("getOffsetHours")(db.run(configTable.getOffsetHours))

  def getExcludedTags: DBIO[Seq[ExcludedTag]] = cachedDBIO("getExcludedTags")(configTable.getExcludedTagsString)

  def getAllCityInfo(lang: Lang): Seq[CityInfo] = {
    val currentCityId    = config.get[String]("city-id")
    val currentCountryId = config.get[String](s"city-params.country-id.$currentCityId")
    val envType          = config.get[String]("environment-type")

    val cityIds = config.get[Seq[String]]("city-params.city-ids")
    cityIds.map { cityId =>
      val stateId    = config.get[Option[String]](s"city-params.state-id.$cityId")
      val countryId  = config.get[String](s"city-params.country-id.$cityId")
      val cityURL    = config.get[String](s"city-params.landing-page-url.$envType.$cityId")
      val visibility = config.get[String](s"city-params.status.$cityId")

      val cityName          = messagesApi(s"city.name.$cityId")(lang)
      val cityNameShort     = config.get[Option[String]](s"city-params.city-short-name.$cityId").getOrElse(cityName)
      val cityNameFormatted =
        if (currentCountryId == "usa" && stateId.isDefined && countryId == "usa")
          messagesApi("city.state", cityName, messagesApi(s"state.name.${stateId.get}")(lang))(lang)
        else
          messagesApi("city.state", cityName, messagesApi(s"country.name.$countryId")(lang))(lang)

      CityInfo(cityId, stateId, countryId, cityNameShort, cityNameFormatted, cityURL, visibility)
    }
  }

  def sha256Hash(text: String): String =
    String.format(
      "%064x",
      new java.math.BigInteger(1, java.security.MessageDigest.getInstance("SHA-256").digest(text.getBytes("UTF-8")))
    )

  /**
   * Send a POST request to SciStarter to record the user's contributions.
   * @param email         The email address of the user who contributed. Will be hashed in POST request.
   * @param contributions Number of contributions. Either number of labels created or number of labels validated.
   * @param timeSpent     Total time spent on those contributions in seconds.
   * @return Response code from the API request.
   */
  def sendSciStarterContributions(email: String, contributions: Int, timeSpent: Double): Future[Int] = {
    // Make API call, logging any errors.
    ws.url("https://scistarter.org/api/participation/hashed/project-sidewalk")
      .withQueryStringParameters("key" -> config.get[String]("scistarter-api-key"))
      .withHttpHeaders("Content-Type" -> "application/x-www-form-urlencoded")
      .post(
        Map(
          "hashed"   -> Seq(sha256Hash(email)),
          "type"     -> Seq("classification"),
          "count"    -> Seq(contributions.toString),
          "duration" -> Seq((timeSpent / contributions).toString)
        )
      )
      .map(response => response.status)
      .recover { case e: Exception =>
        logger.warn(s"Error sending contributions to SciStarter: ${e.getMessage}")
        throw e
      }
  }

  def getCityId: String = config.get[String]("city-id")

  def getCurrentCountryId: String = config.get[String](s"city-params.country-id.$getCityId")

  def getCityName(lang: Lang): String = messagesApi(s"city.name.$getCityId")(lang)

  def getAiTagSuggestionsEnabled: Boolean = config.get[Boolean](s"city-params.ai-tag-suggestions-enabled.$getCityId")

  def getPanoSource: PanoSource = PanoSource.withName(config.get[String](s"city-params.pano-viewer-type.$getCityId"))

  // Uses Play's cache API to cache the result of a DBIO.
  def cachedDBIO[T: ClassTag](key: String, duration: Duration = Duration.Inf)(dbOperation: => DBIO[T]): DBIO[T] = {
    DBIO.from(cacheApi.get[T](key)).flatMap {
      case Some(cached) => DBIO.successful(cached)
      case None         =>
        dbOperation.map { result =>
          cacheApi.set(key, result, duration)
          result
        }
    }
  }

  def getCommonPageData(lang: Lang): Future[CommonPageData] = {
    for {
      version: Version <- cacheApi.getOrElseUpdate[Version]("currentVersion")(versionTable.currentVersion())
      cityId: String            = getCityId
      envType: String           = config.get[String]("environment-type")
      googleAnalyticsId: String = config.get[String](s"city-params.google-analytics-4-id.$envType.$cityId")
      prodUrl: String           = config.get[String](s"city-params.landing-page-url.prod.$cityId")
      gMapsApiKey: String       = config.get[String]("google-maps-api-key")
      imagerySource: PanoSource = PanoSource.withName(config.get[String](s"city-params.pano-viewer-type.$cityId"))
      imageryAccessToken: String <-
        if (imagerySource == PanoSource.Gsv) Future.successful(gMapsApiKey)
        else if (imagerySource == PanoSource.Infra3d) panoDataService.getInfra3dToken(cityId)
        else if (imagerySource == PanoSource.Mapillary) Future.successful(config.get[String]("mapillary-access-token"))
        else Future.failed(new Exception("No valid imagery source specified"))
      gMapsApiKey: String        = config.get[String]("google-maps-api-key")
      mapboxApiKey: String       = config.get[String]("mapbox-api-key")
      allCityInfo: Seq[CityInfo] = getAllCityInfo(lang)
    } yield {
      CommonPageData(cityId, envType, googleAnalyticsId, prodUrl, imagerySource, imageryAccessToken, gMapsApiKey,
        mapboxApiKey, version.versionId, version.versionStartTime, allCityInfo)
    }
  }
}
