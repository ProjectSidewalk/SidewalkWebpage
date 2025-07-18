package models.utils

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import service.{AggregateStats, LabelTypeStats}
import javax.inject._
import scala.concurrent.ExecutionContext

case class MapParams(
    centerLat: Double,
    centerLng: Double,
    zoom: Double,
    lat1: Double,
    lng1: Double,
    lat2: Double,
    lng2: Double
)

case class Config(
    openStatus: String,
    mapathonEventLink: Option[String],
    cityMapParams: MapParams,
    tutorialStreetEdgeID: Int,
    offsetHours: Int,
    makeCrops: Boolean,
    excludedTags: Seq[ExcludedTag]
)

class ConfigTableDef(tag: Tag) extends Table[Config](tag, "config") {
  def openStatus: Rep[String]                = column[String]("open_status")
  def mapathonEventLink: Rep[Option[String]] = column[Option[String]]("mapathon_event_link")
  def cityCenterLat: Rep[Double]             = column[Double]("city_center_lat")
  def cityCenterLng: Rep[Double]             = column[Double]("city_center_lng")
  def southwestBoundaryLat: Rep[Double]      = column[Double]("southwest_boundary_lat")
  def southwestBoundaryLng: Rep[Double]      = column[Double]("southwest_boundary_lng")
  def northeastBoundaryLat: Rep[Double]      = column[Double]("northeast_boundary_lat")
  def northeastBoundaryLng: Rep[Double]      = column[Double]("northeast_boundary_lng")
  def defaultMapZoom: Rep[Double]            = column[Double]("default_map_zoom")
  def tutorialStreetEdgeID: Rep[Int]         = column[Int]("tutorial_street_edge_id")
  def offsetHours: Rep[Int]                  = column[Int]("update_offset_hours")
  def makeCrops: Rep[Boolean]                = column[Boolean]("make_crops")
  def excludedTags: Rep[Seq[ExcludedTag]]    = column[Seq[ExcludedTag]]("excluded_tags", O.Default(List.empty))

  override def * = (
    openStatus,
    mapathonEventLink,
    (cityCenterLat, cityCenterLng, defaultMapZoom, southwestBoundaryLat, southwestBoundaryLng, northeastBoundaryLat,
      northeastBoundaryLng),
    tutorialStreetEdgeID,
    offsetHours,
    makeCrops,
    excludedTags
  ).shaped <> (
    { case (openStatus, mapathonEventLink, cityMapParams, tutorialStreetEdgeID, offsetHours, makeCrops, excludedTags) =>
      Config(openStatus, mapathonEventLink, MapParams.tupled.apply(cityMapParams), tutorialStreetEdgeID, offsetHours,
        makeCrops, excludedTags)
    },
    { c: Config =>
      def f1(i: MapParams) = MapParams.unapply(i).get
      Some(
        (c.openStatus, c.mapathonEventLink, f1(c.cityMapParams), c.tutorialStreetEdgeID, c.offsetHours, c.makeCrops,
          c.excludedTags)
      )
    }
  )
}

@ImplementedBy(classOf[ConfigTable])
trait ConfigTableRepository {}

@Singleton
class ConfigTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
    extends ConfigTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val config = TableQuery[ConfigTableDef]

  def getCityMapParams: DBIO[MapParams] = {
    config.result.head.map(_.cityMapParams)
  }

  /**
   * Gets the map parameters from a specific schema. This allows querying data from other city schemas.
   *
   * The method uses an explicit schema reference in the SQL query to access the config table in a different schema.
   * This enables retrieving map parameters for cities other than the current one.
   *
   * @param schema The database schema to query
   * @return DBIO action that returns MapParams from the specified schema
   * @throws NoSuchElementException if no map parameters are found in the specified schema
   */
  def getCityMapParamsBySchema(schema: String): DBIO[MapParams] = {
    // SQL query with explicit schema reference using double quotes for proper PostgreSQL schema qualification.
    sql"""
      SELECT city_center_lat, city_center_lng, default_map_zoom,
             southwest_boundary_lat, southwest_boundary_lng, northeast_boundary_lat, northeast_boundary_lng
      FROM "#$schema".config
    """
      .as[(Double, Double, Double, Double, Double, Double, Double)]
      .map { rows =>
        // Extract the first row from the result set (if any).
        rows.headOption.map { row => MapParams.tupled(row) }.getOrElse {
          // Throw an exception if no results were found.
          throw new NoSuchElementException(s"No map parameters found in schema: $schema")
        }
      }
  }

  /**
   * Retrieves essential aggregate data for a specific city schema.
   *
   * @param schema The database schema name for the target city
   * @return DBIO action that yields AggregateStats
   */
  def getCityAggregateDataBySchema(schema: String): DBIO[AggregateStats] = {
    sql"""
      SELECT km_audited.km_audited AS km_explored,
            km_audited_no_overlap.km_audited_no_overlap AS km_explored_no_overlap,
            label_counts.label_count AS total_labels,
            total_val_count.validation_count AS total_validations
      FROM (
          SELECT SUM(ST_LENGTH(ST_TRANSFORM(geom, 26918))) / 1000 AS km_audited
          FROM "#$schema".street_edge
          INNER JOIN "#$schema".audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
          INNER JOIN "#$schema".user_stat ON audit_task.user_id = user_stat.user_id
          WHERE completed = TRUE AND NOT user_stat.excluded
      ) AS km_audited, (
          SELECT SUM(ST_LENGTH(ST_TRANSFORM(geom, 26918))) / 1000 AS km_audited_no_overlap
          FROM (
              SELECT DISTINCT street_edge.street_edge_id, geom
              FROM "#$schema".street_edge
              INNER JOIN "#$schema".audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
              INNER JOIN "#$schema".user_stat ON audit_task.user_id = user_stat.user_id
              WHERE completed = TRUE AND NOT user_stat.excluded
          ) distinct_streets
      ) AS km_audited_no_overlap, (
          SELECT COUNT(*) AS label_count
          FROM "#$schema".label
          INNER JOIN "#$schema".user_stat ON label.user_id = user_stat.user_id
          INNER JOIN "#$schema".audit_task ON label.audit_task_id = audit_task.audit_task_id
          WHERE NOT user_stat.excluded
              AND deleted = FALSE
              AND tutorial = FALSE
              AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM "#$schema".config)
              AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM "#$schema".config)
      ) AS label_counts, (
          SELECT COUNT(*) AS validation_count
          FROM "#$schema".label_validation
          INNER JOIN "#$schema".user_stat ON label_validation.user_id = user_stat.user_id
          WHERE NOT user_stat.excluded
      ) AS total_val_count;
    """.as[(Double, Double, Int, Int)].head.map { case (kmExplored, kmExploredNoOverlap, totalLabels, totalValidations) =>

      // Now get the label type statistics for this schema
      getLabelTypeStatsBySchema(schema).map { labelTypeStats =>
        AggregateStats(
          kmExplored = kmExplored,
          kmExploredNoOverlap = kmExploredNoOverlap,
          totalLabels = totalLabels,
          totalValidations = totalValidations,
          numCities = 0, // Individual cities don't have deployment counts
          numCountries = 0, // These are calculated at the service level
          numLanguages = 0, // when aggregating across all cities
          byLabelType = labelTypeStats
        )
      }
    }.flatten
  }

  /**
   * Retrieves label type statistics from a specific schema using existing vote counts.
   *
   * @param schema The database schema to query
   * @return DBIO action that yields a map of label type to LabelTypeStats
   */
  private def getLabelTypeStatsBySchema(schema: String): DBIO[Map[String, LabelTypeStats]] = {
    sql"""
      SELECT
        lt.label_type,
        COUNT(DISTINCT l.label_id) AS label_count,
        COUNT(DISTINCT CASE WHEN (l.agree_count + l.disagree_count + l.unsure_count) > 0 THEN l.label_id END) AS labels_validated,
        COUNT(DISTINCT CASE WHEN l.agree_count > l.disagree_count THEN l.label_id END) AS labels_agreed,
        COUNT(DISTINCT CASE WHEN l.disagree_count > l.agree_count THEN l.label_id END) AS labels_disagreed
      FROM
        "#$schema".label_type lt
      LEFT JOIN
        "#$schema".label l ON lt.label_type_id = l.label_type_id
        AND l.deleted = FALSE
        AND l.tutorial = FALSE
        AND l.street_edge_id <> (SELECT tutorial_street_edge_id FROM "#$schema".config)
      LEFT JOIN
        "#$schema".audit_task at ON l.audit_task_id = at.audit_task_id
        AND at.street_edge_id <> (SELECT tutorial_street_edge_id FROM "#$schema".config)
      LEFT JOIN
        "#$schema".user_stat us ON l.user_id = us.user_id AND NOT us.excluded
      WHERE
        us.user_id IS NOT NULL OR l.label_id IS NULL
      GROUP BY
        lt.label_type_id, lt.label_type
      ORDER BY
        lt.label_type;
    """.as[(String, Int, Int, Int, Int)]
      .map { rows =>
        rows.map { case (labelType, labelCount, validatedCount, agreeCount, disagreeCount) =>
          labelType -> LabelTypeStats(
            labels = labelCount,
            labelsValidated = validatedCount,
            labelsValidatedAgree = agreeCount,
            labelsValidatedDisagree = disagreeCount
          )
        }.toMap
      }
  }

  def getTutorialStreetId: DBIO[Int] = {
    config.map(_.tutorialStreetEdgeID).result.head
  }

  def getMakeCrops: DBIO[Boolean] = {
    config.map(_.makeCrops).result.head
  }

  def getMapathonEventLink: DBIO[Option[String]] = {
    config.map(_.mapathonEventLink).result.head
  }

  def getOpenStatus: DBIO[String] = {
    config.map(_.openStatus).result.head
  }

  def getOffsetHours: DBIO[Int] = {
    config.map(_.offsetHours).result.head
  }

  def getExcludedTagsString: DBIO[Seq[ExcludedTag]] = {
    config.map(_.excludedTags).result.head
  }
}
