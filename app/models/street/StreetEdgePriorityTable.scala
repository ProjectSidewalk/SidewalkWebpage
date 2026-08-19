package models.street

import com.google.inject.ImplementedBy
import models.audit.AuditTaskTableDef
import models.user.UserStatTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.jdbc.GetResult

import java.time.{LocalDate, OffsetDateTime}
import javax.inject.{Inject, Singleton}
import scala.collection.mutable
import scala.concurrent.ExecutionContext

case class StreetEdgePriorityParameter(streetEdgeId: Int, priorityParameter: Double)
case class StreetEdgePriority(streetEdgePriorityId: Int, streetEdgeId: Int, priority: Double)

/**
 * One open street's routing priority alongside the audit counts the priority formula derives it from (#4908).
 *
 * The stored priority alone says which street Explore serves next but not why; carrying the same three counts the
 * formula consumes makes the value explainable on the admin map, and lets a spec assert the two still agree.
 *
 * @param priority            The stored `street_edge_priority.priority`, not a recomputation.
 * @param freshGoodCount      Good-user audits on current imagery.
 * @param outdatedGoodCount   Good-user audits flagged `outdated_imagery`; contributes a flat capped 0.5.
 * @param badCount            Audits by low-quality or flagged users; contributes 0.25 each.
 * @param outdated            Audited, with no up-to-date audit left -- the same definition `/v3/api/streets` reports,
 *                            so the page's re-audit counts match the Coverage KPI rather than the priority counts.
 * @param lastAuditDate       UTC date of the most recent completed audit, if any.
 * @param medianNewestCapture The street's polled median newest capture, NULL when never polled conclusively.
 * @param imageryUpdatedAt    When any feeder last wrote this street's `street_imagery` row.
 * @param lengthMeters        Geodesic length, for distance roll-ups.
 */
case class StreetPriorityForAdmin(
    streetEdgeId: Int,
    regionId: Int,
    regionName: String,
    priority: Double,
    freshGoodCount: Int,
    outdatedGoodCount: Int,
    badCount: Int,
    outdated: Boolean,
    lastAuditDate: Option[LocalDate],
    medianNewestCapture: Option[LocalDate],
    imageryUpdatedAt: Option[OffsetDateTime],
    lengthMeters: Double
)

class StreetEdgePriorityTableDef(tag: slick.lifted.Tag) extends Table[StreetEdgePriority](tag, "street_edge_priority") {
  def streetEdgePriorityId: Rep[Int] = column[Int]("street_edge_priority_id", O.PrimaryKey, O.AutoInc)
  def streetEdgeId: Rep[Int]         = column[Int]("street_edge_id")
  def priority: Rep[Double]          = column[Double]("priority", O.Default(0.0))

  def * =
    (streetEdgePriorityId, streetEdgeId, priority) <> ((StreetEdgePriority.apply _).tupled, StreetEdgePriority.unapply)

  def streetEdge =
    foreignKey("street_edge_priority_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(_.streetEdgeId)
  def streetEdgeUnique = index("street_edge_priority_street_edge_id_key", streetEdgeId, unique = true)
}

@ImplementedBy(classOf[StreetEdgePriorityTable])
trait StreetEdgePriorityTableRepository {}

@Singleton
class StreetEdgePriorityTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    streetEdgeTable: StreetEdgeTable,
    implicit val ec: ExecutionContext
) extends StreetEdgePriorityTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val userStats             = TableQuery[UserStatTableDef]
  val streetEdgePriorities  = TableQuery[StreetEdgePriorityTableDef]
  val streetEdgeRegionTable = TableQuery[StreetEdgeRegionTableDef]
  val auditTaskTable        = TableQuery[AuditTaskTableDef]
  val completedTasks        = auditTaskTable.filter(_.completed === true)

  def insert(streetEdgePriority: StreetEdgePriority): DBIO[Int] = {
    (streetEdgePriorities returning streetEdgePriorities.map(_.streetEdgePriorityId)) += streetEdgePriority
  }

  def auditedStreetDistanceUsingPriority: DBIO[Double] = {
    // Get the lengths of all the audited street edges.
    val edgeLengths = for {
      se  <- streetEdgeTable.streets
      sep <- streetEdgePriorities if se.streetEdgeId === sep.streetEdgeId
      if sep.priority < 1.0d
    } yield se.geom.lengthGeodesic

    // Sum the lengths and convert from meters to miles.
    edgeLengths.sum.result.map(x => x.getOrElse(0.0d))
  }

  /**
   * Every routable street's priority with the audit counts behind it, for the admin imagery panel (#4908).
   *
   * Scoped to open, non-tutorial streets because the question it answers is "where will Explore send people next",
   * and those are the only streets it can send them to.
   *
   * The three counts reproduce `selectGoodBadUserCompletionCountPriority` in SQL, including its dedupe: that query
   * groups completed audits by (street, user, low_quality, incomplete, stale, outdated_imagery) before counting, so
   * one user's repeat audits of a street collapse unless their flags differ. Keep the DISTINCT column list in step
   * with that groupBy -- `StreetPriorityAdminSpec` recomputes the formula from these counts and requires the result to
   * match what `selectGoodBadUserCompletionCountPriority` produces, so a divergence fails there rather than silently
   * mislabeling the map.
   */
  def getPriorityWithInputs: DBIO[Seq[StreetPriorityForAdmin]] = {
    implicit val getStreetPriorityForAdmin: GetResult[StreetPriorityForAdmin] = GetResult { r =>
      StreetPriorityForAdmin(
        r.nextInt(),
        r.nextInt(),
        r.nextString(),
        r.nextDouble(),
        r.nextInt(),
        r.nextInt(),
        r.nextInt(),
        r.nextBoolean(),
        r.nextDateOption().map(_.toLocalDate),
        r.nextDateOption().map(_.toLocalDate),
        r.nextOffsetDateTimeOption(),
        r.nextDouble()
      )
    }
    sql"""
      WITH completions AS (
          SELECT DISTINCT audit_task.street_edge_id, audit_task.user_id, audit_task.low_quality,
                 audit_task.incomplete, audit_task.stale, audit_task.outdated_imagery, user_stat.high_quality
          FROM audit_task
          INNER JOIN user_stat ON user_stat.user_id = audit_task.user_id
          WHERE audit_task.completed = TRUE
              AND user_stat.excluded = FALSE
      ), priority_inputs AS (
          SELECT street_edge_id,
                 COUNT(*) FILTER (
                     WHERE high_quality AND NOT (low_quality OR incomplete OR stale) AND NOT outdated_imagery
                 ) AS fresh_good_count,
                 COUNT(*) FILTER (
                     WHERE high_quality AND NOT (low_quality OR incomplete OR stale) AND outdated_imagery
                 ) AS outdated_good_count,
                 COUNT(*) FILTER (
                     WHERE NOT (high_quality AND NOT (low_quality OR incomplete OR stale))
                 ) AS bad_count
          FROM completions
          GROUP BY street_edge_id
      ), audit_activity AS (
          -- Unfiltered by user quality on purpose: this is the audited/outdated bookkeeping the rest of the app
          -- reports, not the priority formula's weighted view of the same audits.
          SELECT street_edge_id,
                 COUNT(*) AS audit_count,
                 COUNT(*) FILTER (WHERE NOT outdated_imagery) AS up_to_date_audit_count,
                 MAX((task_end AT TIME ZONE 'UTC')::date) AS last_audit_date
          FROM audit_task
          WHERE completed = TRUE
          GROUP BY street_edge_id
      )
      SELECT street_edge.street_edge_id,
             street_edge_region.region_id,
             region.name,
             COALESCE(street_edge_priority.priority, 1.0),
             COALESCE(priority_inputs.fresh_good_count, 0),
             COALESCE(priority_inputs.outdated_good_count, 0),
             COALESCE(priority_inputs.bad_count, 0),
             COALESCE(audit_activity.audit_count, 0) > 0
                 AND COALESCE(audit_activity.up_to_date_audit_count, 0) = 0 AS outdated,
             audit_activity.last_audit_date,
             street_imagery.median_newest_capture,
             street_imagery.updated_at,
             ST_Length(street_edge.geom::geography)
      FROM street_edge
      INNER JOIN street_edge_region ON street_edge_region.street_edge_id = street_edge.street_edge_id
      INNER JOIN region ON region.region_id = street_edge_region.region_id
      LEFT JOIN street_edge_priority ON street_edge_priority.street_edge_id = street_edge.street_edge_id
      LEFT JOIN priority_inputs ON priority_inputs.street_edge_id = street_edge.street_edge_id
      LEFT JOIN audit_activity ON audit_activity.street_edge_id = street_edge.street_edge_id
      LEFT JOIN street_imagery ON street_imagery.street_edge_id = street_edge.street_edge_id
      WHERE street_edge.status = 'open'
          AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
      ORDER BY street_edge.street_edge_id;
    """.as[StreetPriorityForAdmin]
  }

  /**
   * Helper function to normalize the priorityParameter of a list of StreetEdgePriorityParameter objects to between 0
   * and 1. This returns the reciprocal for each street edge's parameter value. The reciprocal is calculated after
   * adding some prior to the value to prevent divide by zero errors.
   *
   * @param priorityParams
   */
  def normalizePriorityReciprocal(
      priorityParams: Seq[StreetEdgePriorityParameter]
  ): Seq[StreetEdgePriorityParameter] = {
    val prior = 1
    priorityParams.map { x => x.copy(priorityParameter = 1 / (x.priorityParameter + prior)) }
  }

  /**
   * Recalculates street edge priority for all streets.
   */
  def recalculateStreetPriority: DBIO[Seq[Int]] = {
    // Function pointer to the function that returns priority based on audit counts of good/bad users
    // The functions being pointed to should always have the signature ()=>Seq[StreetEdgePriorityParameter]
    // (Takes no input arguments and returns a Seq[StreetEdgePriorityParameter])
    val completionCountPriority: DBIO[() => Seq[StreetEdgePriorityParameter]] =
      selectGoodBadUserCompletionCountPriority.map(() => _)

    // List of function pointers that will generate priority parameters.
    val rankParameterGeneratorList: DBIO[Seq[() => Seq[StreetEdgePriorityParameter]]] =
      completionCountPriority.map(Seq(_))
    // Seq(completionCountPriority1,completionCountPriority2) // how it would look with two priority param funcs

    // Final Priority for each street edge is calculated by some transformation (paramScalingFunction)
    // of the weighted sum (weights are given by the weightVector) of the priority parameters.
    // val paramScalingFunction: (Double) => Double = StreetEdgePriorityTable.logisticFunction
    val weightVector: Seq[Double] = Seq(1d)
    // val weightVector: Seq[Double] = Seq(0.1,0.9) -- how it would look with two priority param funcs
    updateAllStreetEdgePriorities(rankParameterGeneratorList, weightVector)
  }

  /**
   * Return streets that have been audited by any user since a given time.
   * @param regionId The ID of the region to filter streets by
   * @param timestamp The time after which the street priorities were updated
   */
  def streetPrioritiesUpdatedSinceTime(regionId: Int, timestamp: OffsetDateTime): DBIO[Seq[StreetEdgePriority]] = {
    (for {
      ct  <- completedTasks
      sep <- streetEdgePriorities if ct.streetEdgeId === sep.streetEdgeId
      ser <- streetEdgeRegionTable if sep.streetEdgeId === ser.streetEdgeId
      if ser.regionId === regionId && ct.taskEnd > timestamp
    } yield sep).distinct.result
  }

  /**
   * Returns list of StreetEdgePriority from a list of streetEdgeIds.
   * @param streetEdgeIds Seq[Int] of street edge ids.
   */
  def streetPrioritiesFromIds(streetEdgeIds: Seq[Int]): DBIO[Seq[StreetEdgePriority]] = {
    streetEdgePriorities.filter(_.streetEdgeId inSetBind streetEdgeIds.toSet).result
  }

  /**
   * Recalculate the priority attribute for all streetEdges.
   *
   * Computes a weighted sum of factors that influence priority (e.g. audit count). It takes a list of functions that
   * generate a list of StreetEdgePriorityParameters (which just means a value between 0 and 1 representing priority
   * for each street), and for each street edge, it computes a weighted sum of the priority parameters to get
   * our final street edge priority.
   *
   * @param rankParameterGeneratorList List of funcs that generate a number between 0 and 1 for each streetEdge.
   * @param weightVector List of positive numbers b/w 0 and 1 that sum to 1; used to weight the generated parameters.
   */
  def updateAllStreetEdgePriorities(
      rankParameterGeneratorList: DBIO[Seq[() => Seq[StreetEdgePriorityParameter]]],
      weightVector: Seq[Double]
  ) = {
    for {
      paramGeneratorList: Seq[() => Seq[StreetEdgePriorityParameter]] <- rankParameterGeneratorList

      // Create a map from each street edge to a default priority value of 0.
      streetIds <- streetEdgePriorities.map(_.streetEdgeId).result
      edgePriorityMap = mutable.Map[Int, Double](streetIds.map(id => id -> 0.0): _*)

      // Compute weighted sum of priority based on the rankParameter generators.
      _ = for ((f_i, w_i) <- paramGeneratorList.zip(weightVector)) {
        val priorityParamTable: Seq[StreetEdgePriorityParameter] = f_i()
        priorityParamTable.foreach { edge => edgePriorityMap(edge.streetEdgeId) += (edge.priorityParameter * w_i) }
      }

      // Set priority values in the table.
      batchUpdate <- DBIO.sequence(edgePriorityMap.map { case (edgeId, newPriority) =>
        streetEdgePriorities.filter(_.streetEdgeId === edgeId).map(_.priority).update(newPriority)
      }.toSeq)
    } yield batchUpdate
  }

  /**
   * Functions that generate parameters for street edge priority evaluation.
   */

  /**
   * Returns 1 if no good-user audit exists, o/w 1 / (1 + fresh_good_count + outdated_half + 0.25*bad_count), where
   * outdated_half is 0.5 if the street has any good-user audit flagged outdated_imagery and 0 otherwise.
   *
   *  - assign each user as "good" or "bad" based on their labeling frequency
   *    - compute total distance audited by each user, and total label count for each user
   *    - join the audited distance and label count tables to compute labeling frequency (now done in separate func)
   *  - for each street edge, count good-user audits on current imagery (fresh), good-user audits flagged
   *    outdated_imagery (outdated), and bad-user audits
   *    - if fresh_good_count == 0 and outdated_good_count == 0 -> priority = 1
   *      else -> priority = 1 / (1 + fresh_good_count + (0.5 if outdated_good_count > 0) + 0.25*bad_count)
   *
   * The flat 0.5 for outdated audits (#4384) places a street whose only audits are on since-replaced imagery at
   * priority 1/1.5 ~= 0.67: below never-audited streets (1.0), so fresh coverage always outranks re-audits, but above
   * freshly-audited streets (<= 0.5), so it re-enters the routing pool ahead of them -- and staying < 1.0 keeps
   * region_completion and the audited-distance stats crediting the street as explored. It is a flat contribution, not
   * 0.5 per audit: per-audit weighting would let a street with several outdated audits sink to or below the
   * freshly-audited tier (two outdated would equal one fresh), pushing streets that need a re-audit behind streets
   * that don't (review finding on #4649).
   *
   * @return
   */
  def selectGoodBadUserCompletionCountPriority: DBIO[Seq[StreetEdgePriorityParameter]] = {

    /**
     * ******** Quality of Users *********
     */

    // Add a boolean indicating whether the user has a labeling frequency above a threshold to each completed auditTask.
    // NOTE We are calling the getQualityOfUsers function below, which does the heavy lifting.
    val completions = completedTasks
      // Select distinct street edge ids, and keep user id and street flags
      .groupBy(task =>
        (task.streetEdgeId, task.userId, task.lowQuality, task.incomplete, task.stale, task.outdatedImagery)
      )
      .map(_._1)
      .join(userStats)
      .on(_._2 === _.userId)    // join on user_id
      .filterNot(_._2.excluded) // filter out users marked with excluded = TRUE
      // SELECT street_edge_id, (is_good_user AND NOT (low_quality or incomplete or stale)), outdated_imagery.
      // outdated_imagery is kept separate from the quality flags: it is a machine-managed freshness signal, not a
      // judgment of the audit, so it discounts a good audit's weight rather than reclassifying it as bad (#4384).
      .map { case (_task, _qual) =>
        (_task._1, _qual.highQuality && !(_task._3 || _task._4 || _task._5), _task._6)
      }

    /**
     * ******** Compute Audit Counts *********
     */

    // Group by street_edge_id and count good-user audits on current imagery, good-user audits on since-replaced
    // imagery, and bad-user audits (freshness doesn't matter for those -- they never gate priority) separately.
    val freshGoodAuditCounts =
      completions.filter(c => c._2 && !c._3).groupBy(_._1).map { case (edge, group) => (edge, group.length) }
    val outdatedGoodAuditCounts =
      completions.filter(c => c._2 && c._3).groupBy(_._1).map { case (edge, group) => (edge, group.length) }
    val badUserAuditCounts =
      completions.filterNot(_._2).groupBy(_._1).map { case (edge, group) => (edge, group.length) }

    // Join the audit counts with the street_edge table, filling in any counts not present as 0. We now have a table
    // with four columns: street_edge_id, fresh_good_count, outdated_good_count, bad_user_audit_count. We keep tutorial
    // street in the set so its street_edge_priority row stays at priority=1.0 (it's never a regular audit target).
    val allAuditCounts =
      streetEdgeTable.streetsWithTutorial
        .joinLeft(freshGoodAuditCounts)
        .on(_.streetEdgeId === _._1)
        .map { case (_edge, _freshCount) => (_edge.streetEdgeId, _freshCount.map(_._2).getOrElse(0)) }
        .joinLeft(outdatedGoodAuditCounts)
        .on(_._1 === _._1)
        .map { case (_fresh, _outdatedCount) => (_fresh._1, _fresh._2, _outdatedCount.map(_._2).getOrElse(0)) }
        .joinLeft(badUserAuditCounts)
        .on(_._1 === _._1)
        .map { case (_counts, _badCount) => (_counts._1, _counts._2, _counts._3, _badCount.map(_._2).getOrElse(0)) }

    /**
     * ******** Compute Priority *********
     */
    // If any good-user audit exists (fresh or outdated), the completion count is
    // fresh_good_count + (0.5 if any outdated good audit) + 0.25*bad_user_audit_count; else 0, which the reciprocal
    // transform turns into priority 1. See the method ScalaDoc for why the outdated contribution is a capped 0.5.
    val priorityParamTable: DBIO[Seq[StreetEdgePriorityParameter]] =
      allAuditCounts.result.map(_.map { case (streetEdgeId, freshGood, outdatedGood, bad) =>
        if (freshGood > 0 || outdatedGood > 0) {
          val outdatedHalf = if (outdatedGood > 0) 0.5 else 0.0
          StreetEdgePriorityParameter.tupled((streetEdgeId, freshGood + outdatedHalf + 0.25 * bad))
        } else {
          StreetEdgePriorityParameter.tupled((streetEdgeId, 0.0))
        }
      })

    priorityParamTable.map(normalizePriorityReciprocal)
  }

  /**
   * Partially updates priority of a street based on current priority (used after an audit of the street is done).
   *
   * TODO this isn't a simple CRUD operation and should probably be moved to a Service file.
   * Feb 25: This is equivalent to adding 1 to the good_user_audit_count...
   * if old_priority = 1 / c' (where c' = 1 + good_user_audit_count + bad_user_audit_count), then c' = 1 / old_priority
   * Then if you want to calculate a new priority with count c' + 1,
   * you get new_priority = 1 / (1 + c') = 1 / (1 + (1 / old_priority))
   *
   * @param streetEdgeId The ID of the street that was audited
   * @param userId The ID of the user who audited the street
   * @return Some(newPriority) if the priority was updated, None otherwise.
   */
  def partiallyUpdatePriority(streetEdgeId: Int, userId: String): DBIO[Option[Double]] = {
    val priorityQuery = streetEdgePriorities.filter(_.streetEdgeId === streetEdgeId).map(_.priority)
    for {
      userHighQuality: Boolean          <- userStats.filter(_.userId === userId).map(_.highQuality).take(1).result.head
      newPriorityOption: Option[Double] <- priorityQuery.result.headOption.map(_.map { currPriority =>
        // Only update the priority if the street was audited by a high quality user.
        if (userHighQuality) {
          1 / (1 + (1 / currPriority))
        } else if (currPriority < 1) {
          1 / (0.25 + (1 / currPriority))
        } else {
          currPriority
        }
      })
      rowsUpdated: Int <- newPriorityOption
        .map { newPriority => priorityQuery.update(newPriority) }
        .getOrElse(DBIO.successful(0))
    } yield {
      if (rowsUpdated > 0) newPriorityOption else None
    }
  }
}
