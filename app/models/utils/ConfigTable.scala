package models.utils

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import service.{AggregateStats, CityScorecard, LabelTypeStats, WeeklyPoint}
import slick.jdbc.GetResult

import java.time.{LocalDate, OffsetDateTime, ZoneOffset}
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
            tutorial_label_counts.tutorial_label_count AS tutorial_labels,
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
          -- Practice/tutorial labels, reported separately from total_labels so the per-type breakdown reconciles with
          -- the total (#3981). Counted by the label.tutorial flag from non-excluded users.
          SELECT COUNT(*) AS tutorial_label_count
          FROM "#$schema".label
          INNER JOIN "#$schema".user_stat ON label.user_id = user_stat.user_id
          WHERE NOT user_stat.excluded
              AND deleted = FALSE
              AND tutorial = TRUE
      ) AS tutorial_label_counts, (
          SELECT COUNT(*) AS validation_count
          FROM "#$schema".label_validation
          INNER JOIN "#$schema".user_stat ON label_validation.user_id = user_stat.user_id
          WHERE NOT user_stat.excluded
      ) AS total_val_count;
    """
      .as[(Double, Double, Int, Int, Int)]
      .head
      .map { case (kmExplored, kmExploredNoOverlap, totalLabels, tutorialLabels, totalValidations) =>

        // Now get the label type statistics for this schema.
        getLabelTypeStatsBySchema(schema).map { labelTypeStats =>
          AggregateStats(
            kmExplored = kmExplored, kmExploredNoOverlap = kmExploredNoOverlap, totalLabels = totalLabels,
            tutorialLabels = tutorialLabels, totalValidations = totalValidations,
            totalUsers = 0,   // Deduped across schemas in ConfigService (getContributorUserIdsBySchema); not a per-city sum
            numCities = 0,    // Individual cities don't have deployment counts
            numCountries = 0, // These are calculated at the service level
            numLanguages = 0, // when aggregating across all cities
            byLabelType = labelTypeStats
          )
        }
      }
      .flatten
  }

  /**
   * Retrieves the distinct contributor user ids for a single city schema (#3976).
   *
   * A "contributor" is a non-excluded user who added at least one non-tutorial label OR validated at least one label.
   * The two arms reuse the EXACT predicates of `getCityAggregateDataBySchema`'s `label_counts` and `total_val_count`
   * subqueries, so the contributing set is consistent with `total_labels` / `total_validations`. The `UNION` dedupes
   * within this city; cross-city dedup (by the global `user_id`) is done by the caller, which unions these id sets
   * across schemas. Returns ids (not a count) precisely so that caller-side cross-schema dedup is possible.
   *
   * @param schema The database schema to query.
   * @return DBIO action yielding the distinct contributor `user_id`s (a `text` column) for this schema.
   */
  def getContributorUserIdsBySchema(schema: String): DBIO[Seq[String]] = {
    sql"""
      SELECT label.user_id
      FROM "#$schema".label
      INNER JOIN "#$schema".user_stat ON label.user_id = user_stat.user_id
      INNER JOIN "#$schema".audit_task ON label.audit_task_id = audit_task.audit_task_id
      WHERE NOT user_stat.excluded
          AND deleted = FALSE
          AND tutorial = FALSE
          AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM "#$schema".config)
          AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM "#$schema".config)
      UNION
      SELECT label_validation.user_id
      FROM "#$schema".label_validation
      INNER JOIN "#$schema".user_stat ON label_validation.user_id = user_stat.user_id
      WHERE NOT user_stat.excluded;
    """.as[String]
  }

  /**
   * Retrieves label type statistics from a specific schema using existing vote counts.
   *
   * @param schema The database schema to query
   * @return DBIO action that yields a map of label type to LabelTypeStats
   */
  def getLabelTypeStatsBySchema(schema: String): DBIO[Map[String, LabelTypeStats]] = {
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
        -- All label-qualification predicates live in this LEFT JOIN's ON clause (not a WHERE, and not separate joins
        -- with conditions in their own ON) so that (a) label types with zero qualifying labels still appear with a
        -- count of 0, and (b) the qualifying set is IDENTICAL to total_labels in getCityAggregateDataBySchema. Using
        -- EXISTS keeps it a single label row per label (no fan-out) and, unlike a LEFT JOIN ... ON condition, actually
        -- EXCLUDES labels whose audit_task sits on the tutorial street — the source of the #3981 count mismatch.
        AND EXISTS (
          SELECT 1 FROM "#$schema".user_stat us
          WHERE us.user_id = l.user_id AND NOT us.excluded
        )
        AND EXISTS (
          SELECT 1 FROM "#$schema".audit_task at
          WHERE at.audit_task_id = l.audit_task_id
            AND at.street_edge_id <> (SELECT tutorial_street_edge_id FROM "#$schema".config)
        )
      GROUP BY
        lt.label_type_id, lt.label_type
      ORDER BY
        lt.label_type;
    """
      .as[(String, Int, Int, Int, Int)]
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

  /**
   * Internal single-row result of the scorecard core query, before the per-label-type and weekly-trend queries are
   * folded in by [[getCityScorecardBySchema]].
   */
  private case class ScorecardCore(
      totalStreets: Int,
      auditedStreets: Int,
      totalKm: Double,
      auditedKm: Double,
      totalLabels: Int,
      aiLabels: Int,
      labelsWithSeverity: Int,
      labelsSeverityEligible: Int,
      labelsWithTags: Int,
      labelsTagEligible: Int,
      totalValidations: Int,
      validationsAgree: Int,
      validationsDisagree: Int,
      aiValidations: Int,
      activeContributors: Int,
      lowQualityContributors: Int,
      labels7d: Int,
      labels30d: Int,
      validations7d: Int,
      validations30d: Int,
      audits7d: Int,
      audits30d: Int,
      lastActivity: Option[OffsetDateTime]
  )

  /** Number of trailing weeks of activity trend the scorecard fetches per city. */
  private val ScorecardTrendWeeks: Int = 12

  /**
   * Computes a rich per-city summary scorecard for a specific city schema (#4329).
   *
   * Powers the cross-city "Across Cities" admin overview across four lenses — coverage (streets/km audited vs total),
   * activity (7-day and 30-day volume plus a weekly trend), data patterns (the per-label-type mix), and data quality
   * (validated/agreement counts plus low-quality contributors). Each configured city's schema is queried in parallel at
   * the service layer and the rows are rendered as a comparison page. Exclusion predicates mirror
   * `getCityAggregateDataBySchema` (`NOT user_stat.excluded`, `deleted = FALSE`, `tutorial = FALSE`, the tutorial-street
   * guard) so a city's totals here reconcile with its single-city stats.
   *
   * Composed from three queries on the same connection: the single-row core metrics, the per-label-type breakdown
   * (reusing [[getLabelTypeStatsBySchema]]), and the weekly trend (`getCityWeeklyTrendBySchema`).
   *
   * AI is determined by the shared `sidewalk_login` role (`role.role = 'AI'`), not anything in the city schema — so
   * those joins are intentionally not schema-qualified, matching `getCityDailyLabelStatsBySchema`. `COUNT(DISTINCT
   * label_id)` is used for label counts so the AI-role LEFT JOINs can never fan a label out if a user carries more than
   * one role row.
   *
   * @param schema The database schema name for the target city (e.g. "sidewalk_seattle").
   * @return       DBIO yielding a complete CityScorecard. `lastActivity` is None for a schema with no activity;
   *               `coverage` is 0.0 when the city has no streets loaded.
   */
  def getCityScorecardBySchema(schema: String): DBIO[CityScorecard] = {
    // The nullable last-activity timestamp can be NULL on an empty schema, so it is read as an Option and normalized to
    // UTC (we only need the instant, for "days since last activity").
    implicit val getResult: GetResult[ScorecardCore] = GetResult { r =>
      ScorecardCore(
        totalStreets = r.nextInt(),
        auditedStreets = r.nextInt(),
        totalKm = r.nextDouble(),
        auditedKm = r.nextDouble(),
        totalLabels = r.nextInt(),
        aiLabels = r.nextInt(),
        labelsWithSeverity = r.nextInt(),
        labelsSeverityEligible = r.nextInt(),
        labelsWithTags = r.nextInt(),
        labelsTagEligible = r.nextInt(),
        totalValidations = r.nextInt(),
        validationsAgree = r.nextInt(),
        validationsDisagree = r.nextInt(),
        aiValidations = r.nextInt(),
        activeContributors = r.nextInt(),
        lowQualityContributors = r.nextInt(),
        labels7d = r.nextInt(),
        labels30d = r.nextInt(),
        validations7d = r.nextInt(),
        validations30d = r.nextInt(),
        audits7d = r.nextInt(),
        audits30d = r.nextInt(),
        lastActivity = r.nextTimestampOption().map(_.toInstant.atOffset(ZoneOffset.UTC))
      )
    }

    val coreQuery =
      sql"""
      SELECT total_streets.cnt          AS total_streets,
             audited_streets.cnt        AS audited_streets,
             COALESCE(street_km.km, 0)  AS total_km,
             COALESCE(audited_km.km, 0) AS audited_km,
             label_counts.label_count    AS total_labels,
             label_counts.ai_count       AS ai_labels,
             label_counts.with_severity     AS labels_with_severity,
             label_counts.severity_eligible AS labels_severity_eligible,
             label_counts.with_tags         AS labels_with_tags,
             label_counts.tag_eligible      AS labels_tag_eligible,
             val_counts.val_count           AS total_validations,
             val_counts.agree_count     AS validations_agree,
             val_counts.disagree_count  AS validations_disagree,
             ai_val_counts.ai_count     AS ai_validations,
             active_contributors.cnt    AS active_contributors,
             low_quality.cnt            AS low_quality_contributors,
             label_counts.labels_7d     AS labels_7d,
             label_counts.labels_30d    AS labels_30d,
             val_counts.val_7d          AS validations_7d,
             val_counts.val_30d         AS validations_30d,
             audit_windows.audits_7d    AS audits_7d,
             audit_windows.audits_30d   AS audits_30d,
             last_activity.ts           AS last_activity
      FROM (
          SELECT COUNT(*) AS cnt FROM "#$schema".street_edge WHERE deleted = FALSE
      ) AS total_streets, (
          -- Filter audited streets to non-deleted so the numerator can't exceed total_streets (deleted streets can
          -- still have audit_task rows, which would push coverage above 100% and make "streets left" negative). #4329
          SELECT COUNT(DISTINCT street_edge.street_edge_id) AS cnt
          FROM "#$schema".street_edge
          INNER JOIN "#$schema".audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
          INNER JOIN "#$schema".user_stat ON audit_task.user_id = user_stat.user_id
          WHERE completed = TRUE AND NOT user_stat.excluded AND street_edge.deleted = FALSE
      ) AS audited_streets, (
          SELECT SUM(ST_LENGTH(ST_TRANSFORM(geom, 26918))) / 1000 AS km
          FROM "#$schema".street_edge WHERE deleted = FALSE
      ) AS street_km, (
          -- Distinct audited length (no double-counting overlapping audits), non-deleted only (see audited_streets).
          SELECT SUM(ST_LENGTH(ST_TRANSFORM(geom, 26918))) / 1000 AS km
          FROM (
              SELECT DISTINCT street_edge.street_edge_id, geom
              FROM "#$schema".street_edge
              INNER JOIN "#$schema".audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
              INNER JOIN "#$schema".user_stat ON audit_task.user_id = user_stat.user_id
              WHERE completed = TRUE AND NOT user_stat.excluded AND street_edge.deleted = FALSE
          ) AS distinct_audited
      ) AS audited_km, (
          SELECT COUNT(DISTINCT label.label_id) AS label_count,
                 COUNT(DISTINCT label.label_id) FILTER (WHERE role.role = 'AI') AS ai_count,
                 COUNT(DISTINCT label.label_id) FILTER (WHERE label.severity IS NOT NULL) AS with_severity,
                 -- Denominator for "% with severity": only types that CAN take a severity. The three excluded here
                 -- mirror UtilitiesSidewalk.js LABEL_TYPES_WITHOUT_SEVERITY (NoSidewalk, Signal, Occlusion).
                 COUNT(DISTINCT label.label_id) FILTER (
                     WHERE label.label_type_id NOT IN (
                         SELECT label_type_id FROM "#$schema".label_type
                         WHERE label_type IN ('NoSidewalk', 'Signal', 'Occlusion')
                     )
                 ) AS severity_eligible,
                 COUNT(DISTINCT label.label_id) FILTER (WHERE cardinality(label.tags) > 0) AS with_tags,
                 -- Denominator for "% with tags": only types that CAN take tags, i.e. types that have any tag defined
                 -- in this deployment's tag table (self-adapting per city; typically all types except Occlusion).
                 COUNT(DISTINCT label.label_id) FILTER (
                     WHERE label.label_type_id IN (SELECT DISTINCT label_type_id FROM "#$schema".tag)
                 ) AS tag_eligible,
                 COUNT(DISTINCT label.label_id) FILTER (WHERE label.time_created >= NOW() - INTERVAL '7 days') AS labels_7d,
                 COUNT(DISTINCT label.label_id) FILTER (WHERE label.time_created >= NOW() - INTERVAL '30 days') AS labels_30d
          FROM "#$schema".label
          INNER JOIN "#$schema".user_stat ON label.user_id = user_stat.user_id
          INNER JOIN "#$schema".audit_task ON label.audit_task_id = audit_task.audit_task_id
          LEFT  JOIN sidewalk_login.user_role ON label.user_id     = user_role.user_id
          LEFT  JOIN sidewalk_login.role      ON user_role.role_id = role.role_id
          WHERE NOT user_stat.excluded
              AND label.deleted = FALSE
              AND label.tutorial = FALSE
              AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM "#$schema".config)
              AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM "#$schema".config)
      ) AS label_counts, (
          -- val_count / val_7d / val_30d are ALL validations (the activity volume, incl. AI). agree_count and
          -- disagree_count are HUMAN-only (role != 'AI'): the agreement/disagreement quality signal is about whether
          -- people concur; AI verdicts are reported separately (ai_val_counts). COUNT(DISTINCT ...) guards against the
          -- role LEFT JOIN fanning a validation out if a user carries more than one role row.
          SELECT COUNT(DISTINCT label_validation.label_validation_id) AS val_count,
                 COUNT(DISTINCT label_validation.label_validation_id)
                     FILTER (WHERE validation_result::text = 'Agree'    AND role.role IS DISTINCT FROM 'AI') AS agree_count,
                 COUNT(DISTINCT label_validation.label_validation_id)
                     FILTER (WHERE validation_result::text = 'Disagree' AND role.role IS DISTINCT FROM 'AI') AS disagree_count,
                 COUNT(DISTINCT label_validation.label_validation_id)
                     FILTER (WHERE end_timestamp >= NOW() - INTERVAL '7 days')  AS val_7d,
                 COUNT(DISTINCT label_validation.label_validation_id)
                     FILTER (WHERE end_timestamp >= NOW() - INTERVAL '30 days') AS val_30d
          FROM "#$schema".label_validation
          INNER JOIN "#$schema".user_stat ON label_validation.user_id = user_stat.user_id
          LEFT  JOIN sidewalk_login.user_role ON label_validation.user_id = user_role.user_id
          LEFT  JOIN sidewalk_login.role      ON user_role.role_id        = role.role_id
          WHERE NOT user_stat.excluded
      ) AS val_counts, (
          -- AI-authored validations, counted separately from val_counts so the AI-role join can't fan out the totals.
          SELECT COUNT(DISTINCT label_validation.label_validation_id) AS ai_count
          FROM "#$schema".label_validation
          INNER JOIN "#$schema".user_stat ON label_validation.user_id = user_stat.user_id
          LEFT  JOIN sidewalk_login.user_role ON label_validation.user_id = user_role.user_id
          LEFT  JOIN sidewalk_login.role      ON user_role.role_id        = role.role_id
          WHERE NOT user_stat.excluded AND role.role = 'AI'
      ) AS ai_val_counts, (
          SELECT COUNT(DISTINCT street_edge_id) FILTER (WHERE task_end >= NOW() - INTERVAL '7 days')  AS audits_7d,
                 COUNT(DISTINCT street_edge_id) FILTER (WHERE task_end >= NOW() - INTERVAL '30 days') AS audits_30d
          FROM "#$schema".audit_task
          INNER JOIN "#$schema".user_stat ON audit_task.user_id = user_stat.user_id
          WHERE completed = TRUE AND NOT user_stat.excluded
      ) AS audit_windows, (
          -- Distinct PEOPLE who labeled or validated: union of non-excluded, non-AI label authors and validators.
          SELECT COUNT(DISTINCT contributor_id) AS cnt FROM (
              SELECT label.user_id AS contributor_id
              FROM "#$schema".label
              INNER JOIN "#$schema".user_stat ON label.user_id = user_stat.user_id
              LEFT  JOIN sidewalk_login.user_role ON label.user_id     = user_role.user_id
              LEFT  JOIN sidewalk_login.role      ON user_role.role_id = role.role_id
              WHERE NOT user_stat.excluded AND label.deleted = FALSE AND label.tutorial = FALSE
                  AND role.role IS DISTINCT FROM 'AI'
              UNION
              SELECT label_validation.user_id AS contributor_id
              FROM "#$schema".label_validation
              INNER JOIN "#$schema".user_stat ON label_validation.user_id = user_stat.user_id
              LEFT  JOIN sidewalk_login.user_role ON label_validation.user_id = user_role.user_id
              LEFT  JOIN sidewalk_login.role      ON user_role.role_id        = role.role_id
              WHERE NOT user_stat.excluded AND role.role IS DISTINCT FROM 'AI'
          ) AS contributor_union
      ) AS active_contributors, (
          -- Distinct EXCLUDED (low-quality) users who placed a label — the data-quality "how much got filtered" signal.
          SELECT COUNT(DISTINCT label.user_id) AS cnt
          FROM "#$schema".label
          INNER JOIN "#$schema".user_stat ON label.user_id = user_stat.user_id
          WHERE user_stat.excluded AND label.deleted = FALSE AND label.tutorial = FALSE
      ) AS low_quality, (
          SELECT GREATEST(
              (SELECT MAX(time_created)  FROM "#$schema".label),
              (SELECT MAX(end_timestamp) FROM "#$schema".label_validation),
              (SELECT MAX(task_end)      FROM "#$schema".audit_task)
          ) AS ts
      ) AS last_activity;
    """.as[ScorecardCore].head

    // Fold in the per-label-type breakdown, the weekly trend, and the (cheap) per-user output/speed stats (same
    // connection), then assemble the full scorecard. The expensive labeling-speed query is NOT here — it is computed on
    // a separate long-cached path (getCrossCityLabelingSpeed).
    for {
      core        <- coreQuery
      byLabelType <- getLabelTypeStatsBySchema(schema)
      weeklyTrend <- getCityWeeklyTrendBySchema(schema, Some(ScorecardTrendWeeks))
      output      <- getCityContributorOutputBySchema(schema)
    } yield {
      val (lblMedian, lblP90, nLabelers, valMedian, valP90, nValidators, valSecMedian) = output
      CityScorecard(
        cityId = schema, // Replaced with the real cityId at the service layer; schema is the only id known here.
        totalStreets = core.totalStreets,
        auditedStreets = core.auditedStreets,
        coverage = if (core.totalStreets > 0) core.auditedStreets.toDouble / core.totalStreets else 0.0,
        totalKm = core.totalKm,
        auditedKm = core.auditedKm,
        totalLabels = core.totalLabels,
        aiLabels = core.aiLabels,
        labelsWithSeverity = core.labelsWithSeverity,
        labelsSeverityEligible = core.labelsSeverityEligible,
        labelsWithTags = core.labelsWithTags,
        labelsTagEligible = core.labelsTagEligible,
        labelsValidated = byLabelType.values.map(_.labelsValidated).sum,
        totalValidations = core.totalValidations,
        validationsAgree = core.validationsAgree,
        validationsDisagree = core.validationsDisagree,
        aiValidations = core.aiValidations,
        byLabelType = byLabelType,
        activeContributors = core.activeContributors,
        lowQualityContributors = core.lowQualityContributors,
        labels7d = core.labels7d,
        labels30d = core.labels30d,
        validations7d = core.validations7d,
        validations30d = core.validations30d,
        audits7d = core.audits7d,
        audits30d = core.audits30d,
        lastActivity = core.lastActivity,
        weeklyTrend = weeklyTrend,
        labelsPerUserMedian = lblMedian,
        labelsPerUserP90 = lblP90,
        numLabelers = nLabelers,
        validationsPerUserMedian = valMedian,
        validationsPerUserP90 = valP90,
        numValidators = nValidators,
        validationSecondsMedian = valSecMedian
      )
    }
  }

  /**
   * Returns weekly label/validation/active-user volume for a city schema, oldest week first (#4329).
   *
   * Buckets by ISO week (Monday) in Pacific time so the weeks line up with the rest of the daily/weekly stats. Weeks
   * with no activity are absent (the page fills gaps with zeros).
   *
   * @param schema The database schema to query.
   * @param weeks  Trailing weeks to include, or None for the city's full history (the "All time" toggle).
   * @return       DBIO yielding (weekStart, labels, validations, activeUsers), ascending by week.
   */
  def getCityWeeklyTrendBySchema(schema: String, weeks: Option[Int]): DBIO[Seq[WeeklyPoint]] = {
    implicit val getResult: GetResult[WeeklyPoint] =
      GetResult(r => WeeklyPoint(LocalDate.parse(r.nextString()), r.nextInt(), r.nextInt(), r.nextInt()))

    // weeks is an Int (safe to interpolate); None drops the lower bound to return the city's full history.
    val labelBound = weeks.map(w => s"AND label.time_created >= NOW() - ($w * INTERVAL '1 week')").getOrElse("")
    val valBound   =
      weeks.map(w => s"AND label_validation.end_timestamp >= NOW() - ($w * INTERVAL '1 week')").getOrElse("")

    sql"""
      SELECT CAST(DATE_TRUNC('week', activity_ts AT TIME ZONE 'US/Pacific')::date AS TEXT) AS week_start,
             COUNT(*) FILTER (WHERE kind = 'label')      AS labels,
             COUNT(*) FILTER (WHERE kind = 'validation') AS validations,
             COUNT(DISTINCT activity_user_id)            AS active_users
      FROM (
          SELECT label.time_created AS activity_ts, label.user_id AS activity_user_id, 'label' AS kind
          FROM "#$schema".label
          INNER JOIN "#$schema".user_stat ON label.user_id = user_stat.user_id
          WHERE NOT user_stat.excluded AND label.deleted = FALSE AND label.tutorial = FALSE
              #$labelBound
          UNION ALL
          SELECT label_validation.end_timestamp AS activity_ts, label_validation.user_id AS activity_user_id, 'validation' AS kind
          FROM "#$schema".label_validation
          INNER JOIN "#$schema".user_stat ON label_validation.user_id = user_stat.user_id
          WHERE NOT user_stat.excluded
              #$valBound
      ) AS activity
      GROUP BY week_start
      ORDER BY week_start ASC;
    """.as[WeeklyPoint]
  }

  /**
   * Per-contributor output and validation speed for a city schema (#4329), all cheap aggregates (no interaction scan).
   *
   * Per-user label and validation counts are extremely right-skewed (a few power users), so this returns MEDIAN and p90
   * rather than mean ± SD, which would be misleading. AI and excluded users are left out so these describe real people.
   * Validation speed is the MEDIAN per-validation duration (seconds), clamped to <= 5 min to drop "left-the-tab-open"
   * outliers (mirrors the 5-minute idle cap used by the contribution-time stats).
   *
   * @param schema The database schema to query.
   * @return       (labelMedian, labelP90, numLabelers, valMedian, valP90, numValidators, validationSecondsMedian);
   *               zeros when a population is empty.
   */
  def getCityContributorOutputBySchema(schema: String): DBIO[(Double, Double, Int, Double, Double, Int, Double)] = {
    implicit val getResult: GetResult[(Double, Double, Int, Double, Double, Int, Double)] =
      GetResult(r => (r.nextDouble(), r.nextDouble(), r.nextInt(), r.nextDouble(), r.nextDouble(), r.nextInt(), r.nextDouble()))

    sql"""
      SELECT COALESCE(lbl.median, 0), COALESCE(lbl.p90, 0), COALESCE(lbl.n, 0),
             COALESCE(val.median, 0), COALESCE(val.p90, 0), COALESCE(val.n, 0),
             COALESCE(vdur.median_secs, 0)
      FROM (
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY cnt) AS median,
                 percentile_cont(0.9) WITHIN GROUP (ORDER BY cnt) AS p90,
                 count(*)::int AS n
          FROM (
              SELECT count(*) AS cnt
              FROM "#$schema".label
              INNER JOIN "#$schema".user_stat ON label.user_id = user_stat.user_id
              LEFT  JOIN sidewalk_login.user_role ON label.user_id     = user_role.user_id
              LEFT  JOIN sidewalk_login.role      ON user_role.role_id = role.role_id
              WHERE NOT user_stat.excluded AND label.deleted = FALSE AND label.tutorial = FALSE
                  AND role.role IS DISTINCT FROM 'AI'
              GROUP BY label.user_id
          ) lc
      ) lbl, (
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY cnt) AS median,
                 percentile_cont(0.9) WITHIN GROUP (ORDER BY cnt) AS p90,
                 count(*)::int AS n
          FROM (
              SELECT count(*) AS cnt
              FROM "#$schema".label_validation
              INNER JOIN "#$schema".user_stat ON label_validation.user_id = user_stat.user_id
              LEFT  JOIN sidewalk_login.user_role ON label_validation.user_id = user_role.user_id
              LEFT  JOIN sidewalk_login.role      ON user_role.role_id        = role.role_id
              WHERE NOT user_stat.excluded AND role.role IS DISTINCT FROM 'AI'
              GROUP BY label_validation.user_id
          ) vc
      ) val, (
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) AS median_secs
          FROM (
              SELECT EXTRACT(EPOCH FROM (label_validation.end_timestamp - label_validation.start_timestamp)) AS secs
              FROM "#$schema".label_validation
              INNER JOIN "#$schema".user_stat ON label_validation.user_id = user_stat.user_id
              LEFT  JOIN sidewalk_login.user_role ON label_validation.user_id = user_role.user_id
              LEFT  JOIN sidewalk_login.role      ON user_role.role_id        = role.role_id
              WHERE NOT user_stat.excluded AND role.role IS DISTINCT FROM 'AI'
                  AND label_validation.start_timestamp IS NOT NULL
                  AND label_validation.end_timestamp > label_validation.start_timestamp
                  AND EXTRACT(EPOCH FROM (label_validation.end_timestamp - label_validation.start_timestamp)) <= 300
          ) vd
      ) vdur;
    """.as[(Double, Double, Int, Double, Double, Int, Double)].head
  }

  /**
   * Inputs for a city's labeling-speed metric (#4329): idle-capped active auditing time and audited distance.
   *
   * This is the EXPENSIVE query — a window function over `audit_task_interaction_small` — so it is called from a
   * separately, long-cached service path rather than on every scorecard load. The active-time logic mirrors
   * `AuditTaskInteractionTable.calculateTimeExploring`: sum the gaps between a user's consecutive interactions,
   * dropping gaps over 5 minutes (idle). Distance is the audited length WITH overlap (total ground covered), the right
   * denominator for "time to cover 100 m".
   *
   * @param schema The database schema to query.
   * @return       (activeAuditHours, auditedKmWithOverlap); hours is 0 when there is no interaction data.
   */
  def getCityLabelingSpeedBySchema(schema: String): DBIO[(Double, Double)] = {
    implicit val getResult: GetResult[(Double, Double)] = GetResult(r => (r.nextDouble(), r.nextDouble()))

    sql"""
      SELECT COALESCE(audit_time.hours, 0) AS hours,
             COALESCE(audited.km, 0)       AS km
      FROM (
          SELECT extract(epoch from SUM(diff)) / 3600.0 AS hours
          FROM (
              SELECT (timestamp - LAG(timestamp, 1) OVER (PARTITION BY user_id ORDER BY timestamp)) AS diff
              FROM "#$schema".audit_task_interaction_small
              INNER JOIN "#$schema".mission ON audit_task_interaction_small.mission_id = mission.mission_id
          ) time_diffs
          WHERE diff < '00:05:00' AND diff > '00:00:00'
      ) AS audit_time, (
          SELECT SUM(ST_LENGTH(ST_TRANSFORM(geom, 26918))) / 1000 AS km
          FROM "#$schema".street_edge
          INNER JOIN "#$schema".audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
          INNER JOIN "#$schema".user_stat ON audit_task.user_id = user_stat.user_id
          WHERE completed = TRUE AND NOT user_stat.excluded AND street_edge.deleted = FALSE
      ) AS audited;
    """.as[(Double, Double)].head
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

  /**
   * Returns daily label counts split by human vs AI creator and label type for a specific city schema.
   *
   * This is the cross-schema variant of LabelTable.getDailyLabelStats, used by the aggregate
   * endpoint to query each city schema in turn.
   *
   * @param schema           Database schema to query (e.g. "sidewalk_seattle").
   * @param startDate        Inclusive lower bound on label.time_created; no bound if None.
   * @param endDate          Inclusive upper bound; no bound if None.
   * @param filterLowQuality If true, restrict to user_stat.high_quality; otherwise exclude excluded users.
   * @return                 Sequence of (date, labelType, humanLabels, aiLabels).
   */
  def getCityDailyLabelStatsBySchema(
      schema: String,
      startDate: Option[LocalDate],
      endDate: Option[LocalDate],
      filterLowQuality: Boolean
  ): DBIO[Seq[(LocalDate, String, Int, Int)]] = {
    val userFilter = if (filterLowQuality) "user_stat.high_quality" else "NOT user_stat.excluded"
    val whereClauses = scala.collection.mutable.ListBuffer(
      "label.deleted = FALSE",
      "label.tutorial = FALSE",
      userFilter
    )
    startDate.foreach(d => whereClauses += s"label.time_created >= '$d'::date")
    endDate.foreach(d => whereClauses += s"label.time_created < ('$d'::date + INTERVAL '1 day')")
    val where = whereClauses.mkString(" AND ")

    implicit val getResult: GetResult[(LocalDate, String, Int, Int)] =
      GetResult(r => (LocalDate.parse(r.nextString()), r.nextString(), r.nextInt(), r.nextInt()))

    sql"""
      SELECT CAST((label.time_created AT TIME ZONE 'US/Pacific')::date AS TEXT) AS date,
             label_type.label_type,
             COUNT(CASE WHEN role.role IS DISTINCT FROM 'AI' THEN label.label_id END) AS human_labels,
             COUNT(CASE WHEN role.role = 'AI'               THEN label.label_id END) AS ai_labels
      FROM "#$schema".label
      INNER JOIN "#$schema".label_type ON label.label_type_id = label_type.label_type_id
      INNER JOIN "#$schema".user_stat  ON label.user_id       = user_stat.user_id
      LEFT  JOIN sidewalk_login.user_role ON label.user_id     = user_role.user_id
      LEFT  JOIN sidewalk_login.role      ON user_role.role_id = role.role_id
      WHERE #$where
      GROUP BY (label.time_created AT TIME ZONE 'US/Pacific')::date, label_type.label_type
      ORDER BY date ASC, label_type.label_type
    """.as[(LocalDate, String, Int, Int)]
  }

  /**
   * Returns daily validation counts split by human vs AI validator, result, and label type for a
   * specific city schema.
   *
   * This is the cross-schema variant of LabelValidationTable.getDailyValidationStats.
   *
   * validation_result integers: 1 = agree, 2 = disagree, 3 = unsure.
   *
   * @param schema           Database schema to query.
   * @param startDate        Inclusive lower bound on end_timestamp (Pacific date); no bound if None.
   * @param endDate          Inclusive upper bound; no bound if None.
   * @param filterLowQuality If true, restrict to user_stat.high_quality; otherwise exclude excluded users.
   * @return                 Sequence of (date, labelType, humanAgree, humanDisagree, humanUnsure,
   *                         aiAgree, aiDisagree, aiUnsure).
   */
  def getCityDailyValidationStatsBySchema(
      schema: String,
      startDate: Option[LocalDate],
      endDate: Option[LocalDate],
      filterLowQuality: Boolean
  ): DBIO[Seq[(LocalDate, String, Int, Int, Int, Int, Int, Int)]] = {
    val userFilter = if (filterLowQuality) "user_stat.high_quality" else "NOT user_stat.excluded"
    val whereClauses = scala.collection.mutable.ListBuffer(
      "label.deleted = FALSE",
      userFilter
    )
    startDate.foreach(d => whereClauses += s"label_validation.end_timestamp >= '$d'::date")
    endDate.foreach(d => whereClauses += s"label_validation.end_timestamp < ('$d'::date + INTERVAL '1 day')")
    val where = whereClauses.mkString(" AND ")

    implicit val getResult: GetResult[(LocalDate, String, Int, Int, Int, Int, Int, Int)] =
      GetResult(r => (LocalDate.parse(r.nextString()), r.nextString(),
        r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()))

    sql"""
      SELECT CAST((label_validation.end_timestamp AT TIME ZONE 'US/Pacific')::date AS TEXT) AS date,
             label_type.label_type,
             COUNT(CASE WHEN role.role IS DISTINCT FROM 'AI' AND label_validation.validation_result::text = 'Agree'
                        THEN 1 END) AS human_agree,
             COUNT(CASE WHEN role.role IS DISTINCT FROM 'AI' AND label_validation.validation_result::text = 'Disagree'
                        THEN 1 END) AS human_disagree,
             COUNT(CASE WHEN role.role IS DISTINCT FROM 'AI' AND label_validation.validation_result::text = 'Unsure'
                        THEN 1 END) AS human_unsure,
             COUNT(CASE WHEN role.role = 'AI' AND label_validation.validation_result::text = 'Agree'
                        THEN 1 END) AS ai_agree,
             COUNT(CASE WHEN role.role = 'AI' AND label_validation.validation_result::text = 'Disagree'
                        THEN 1 END) AS ai_disagree,
             COUNT(CASE WHEN role.role = 'AI' AND label_validation.validation_result::text = 'Unsure'
                        THEN 1 END) AS ai_unsure
      FROM "#$schema".label_validation
      INNER JOIN "#$schema".label      ON label_validation.label_id    = label.label_id
      INNER JOIN "#$schema".label_type ON label.label_type_id          = label_type.label_type_id
      INNER JOIN "#$schema".user_stat  ON label_validation.user_id     = user_stat.user_id
      LEFT  JOIN sidewalk_login.user_role ON label_validation.user_id = user_role.user_id
      LEFT  JOIN sidewalk_login.role      ON user_role.role_id        = role.role_id
      WHERE #$where
      GROUP BY (label_validation.end_timestamp AT TIME ZONE 'US/Pacific')::date, label_type.label_type
      ORDER BY date ASC, label_type.label_type
    """.as[(LocalDate, String, Int, Int, Int, Int, Int, Int)]
  }
}
