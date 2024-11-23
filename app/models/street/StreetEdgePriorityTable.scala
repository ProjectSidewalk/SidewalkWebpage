package models.street

import models.audit.AuditTaskTable
import models.user.UserStatTable
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.cache.Cache
import play.api.libs.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.slick.lifted.ForeignKeyQuery
import scala.slick.jdbc.GetResult

case class StreetEdgePriorityParameter(streetEdgeId: Int, priorityParameter: Double)
case class StreetEdgePriority(streetEdgePriorityId: Int, streetEdgeId: Int, priority: Double) {
  /**
    * Converts a StreetEdgePriority object into the JSON format.
    */
  def toJSON: JsObject = {
    Json.obj("streetEdgeId" -> streetEdgeId, "priority" -> priority)
  }
}

class StreetEdgePriorityTable(tag: slick.lifted.Tag) extends Table[StreetEdgePriority](tag, "street_edge_priority") {
  def streetEdgePriorityId = column[Int]("street_edge_priority_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def streetEdgeId = column[Int]("street_edge_id", O.NotNull)
  def priority = column[Double]("priority", O.NotNull)

  def * = (streetEdgePriorityId, streetEdgeId, priority) <> ((StreetEdgePriority.apply _).tupled, StreetEdgePriority.unapply)

  def streetEdge: ForeignKeyQuery[StreetEdgeTable, StreetEdge] =
    foreignKey("street_edge_priority_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTable])(_.streetEdgeId)
}

object StreetEdgePriorityTable {
  val db = play.api.db.slick.DB
  val streetEdgePriorities = TableQuery[StreetEdgePriorityTable]

  implicit val streetEdgePriorityParameterConverter = GetResult(r => {
    StreetEdgePriorityParameter(r.nextInt, r.nextDouble)
  })

  /**
    * Save a record.
    *
    * @param streetEdgePriority
    * @return
    */
  def save(streetEdgePriority: StreetEdgePriority): Int = db.withSession { implicit session =>
    (streetEdgePriorities returning streetEdgePriorities.map(_.streetEdgePriorityId)) += streetEdgePriority
  }

  def auditedStreetDistanceUsingPriority: Float = db.withSession { implicit session =>
    val cacheKey = s"auditedStreetDistanceFromPriority"
    Cache.getOrElse(cacheKey, 30.minutes.toSeconds.toInt) {
      // Get the lengths of all the audited street edges.
      val edgeLengths = for {
        se <- StreetEdgeTable.streetEdgesWithoutDeleted
        sep <- streetEdgePriorities if se.streetEdgeId === sep.streetEdgeId
        if sep.priority < 1.0D
      } yield se.geom.transform(26918).length

      // Sum the lengths and convert from meters to miles.
      edgeLengths.sum.run.map(_ * 0.000621371F).getOrElse(0.0F)
    }
  }

  /**
   * Checks if all streets have been audited by a high quality user (if all have priority < 1).
   *
   * @param regionId
   * @return
   */
  def allStreetsInARegionAuditedUsingPriority(regionId: Int): Boolean = db.withSession { implicit session =>
    val streetsToAudit = for {
      ser <- StreetEdgeTable.streetEdgeRegion
      sep <- streetEdgePriorities if ser.streetEdgeId === sep.streetEdgeId
      if ser.regionId === regionId
      if sep.priority === 1.0
    } yield sep
    streetsToAudit.size.run == 0
  }

  def streetDistanceCompletionRateUsingPriority: Float = db.withSession { implicit session =>
    val auditedDistance: Float = auditedStreetDistanceUsingPriority
    val totalDistance: Float = StreetEdgeTable.totalStreetDistance()
    auditedDistance / totalDistance
  }

  /** Returns the sum of the lengths of all streets in the region that have been audited. */
  def getDistanceAuditedInARegion(regionId: Int): Float = db.withSession { implicit session =>
    // Get the lengths of all the audited street edges in the given region.
    val auditedStreetsInRegion = for {
      ser <- StreetEdgeTable.streetEdgeRegion
      se <- StreetEdgeTable.streetEdgesWithoutDeleted if se.streetEdgeId === ser.streetEdgeId
      sep <- streetEdgePriorities if se.streetEdgeId === sep.streetEdgeId
      if ser.regionId === regionId && sep.priority < 1.0D
    } yield se.geom.transform(26918).length

    // Sum the lengths of the streets.
    auditedStreetsInRegion.sum.run.getOrElse(0.0F)
  }

  /**
    * Helper function to normalize the priorityParameter of a list of StreetEdgePriorityParameter objects to between 0
    * and 1. This returns the reciprocal for each street edge's parameter value. The reciprocal is calculated after
    * adding some prior to the value to prevent divide by zero errors.
    *
    * @param priorityParams
    * @return
    */
  def normalizePriorityReciprocal(priorityParams: List[StreetEdgePriorityParameter]): List[StreetEdgePriorityParameter] = {
    val prior = 1
    priorityParams.map{x => x.copy(priorityParameter = 1 / (x.priorityParameter + prior))}
  }

  /**
    * Recalculates street edge priority for all streets.
    */
  def recalculateStreetPriority() = {
    // Function pointer to the function that returns priority based on audit counts of good/bad users
    // The functions being pointed to should always have the signature ()=>List[StreetEdgePriorityParameter]
    // (Takes no input arguments and returns a List[StreetEdgePriorityParameter])
    val completionCountPriority = () => { StreetEdgePriorityTable.selectGoodBadUserCompletionCountPriority }

    // List of function pointers that will generate priority parameters.
    val rankParameterGeneratorList: List[() => List[StreetEdgePriorityParameter]] =
      List(completionCountPriority)
    // List(completionCountPriority1,completionCountPriority2) // how it would look with two priority param funcs

    // Final Priority for each street edge is calculated by some transformation (paramScalingFunction)
    // of the weighted sum (weights are given by the weightVector) of the priority parameters.
    // val paramScalingFunction: (Double) => Double = StreetEdgePriorityTable.logisticFunction
    val weightVector: List[Double] = List(1)
    // val weightVector: List[Double] = List(0.1,0.9) -- how it would look with two priority param funcs
    updateAllStreetEdgePriorities(rankParameterGeneratorList, weightVector)
  }

  /**
    * Returns list of StreetEdgePriority from a list of streetEdgeIds.
    *
    * @param streetEdgeIds List[Int] of street edge ids.
    * @return
    */
  def streetPrioritiesFromIds(streetEdgeIds: List[Int]): List[StreetEdgePriority] = db.withSession { implicit session =>
    streetEdgePriorities.filter(_.streetEdgeId inSet streetEdgeIds.toSet).list
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
    * @return
    */
  def updateAllStreetEdgePriorities(rankParameterGeneratorList: List[()=>List[StreetEdgePriorityParameter]], weightVector: List[Double]) = db.withSession { implicit session =>

    // Create a map from each street edge to a default priority value of 0.
    val edgePriorityMap = collection.mutable.Map[Int, Double]().withDefaultValue(0.0)
    for (id <- streetEdgePriorities.map(_.streetEdgeId).list) { edgePriorityMap += (id -> 0.0) }

    // Compute weighted sum of priority based on the rankParameter generators.
    for( (f_i,w_i) <- rankParameterGeneratorList.zip(weightVector)) {
      val priorityParamTable: List[StreetEdgePriorityParameter] = f_i()
      priorityParamTable.foreach { edge => edgePriorityMap(edge.streetEdgeId) += (edge.priorityParameter*w_i) }
    }

    // Set priority values in the table.
    // TODO update this to use a batch update after upgrading Slick, there should be easier syntax to do it in future.
    for ((edgeId, newPriority) <- edgePriorityMap) {
      val q = for { edge <- streetEdgePriorities if edge.streetEdgeId === edgeId } yield edge.priority
      val rowsUpdated: Int = q.update(newPriority)
    }
  }

  /**
    * Functions that generate parameters for street edge priority evaluation.
    */

  /**
    * Returns 1 if good_user_audit_count = 0, o/w 1 / (1 + good_user_audit_count + 0.25*bad_user_audit_count).
    *
    *  - assign each user as "good" or "bad" based on their labeling frequency
    *    - compute total distance audited by each user, and total label count for each user
    *    - join the audited distance and label count tables to compute labeling frequency (now done in separate func)
    *  - for each street edge
    *    - count the number of audits by "good" users, and the number of audits by "bad" users
    *    - if good_user_audit_count == 0 -> priority = 1
    *      else                          -> priority = 1 / (1 + good_user_audit_count + 0.25*bad_user_audit_count)
    *
    * @return
    */
  def selectGoodBadUserCompletionCountPriority: List[StreetEdgePriorityParameter] = db.withSession { implicit session =>
    /********** Quality of Users **********/

    // To each audit_task completed by a user, we attach a boolean indicating whether or not the user had a labeling
    // frequency above our threshold.
    // NOTE We are calling the getQualityOfUsers function below, which does the heavy lifting.
    val completions = AuditTaskTable.completedTasks
      // Select distinct street edge ids, and keep user id and street flags
      .groupBy(task => (task.streetEdgeId, task.userId, task.lowQuality, task.incomplete, task.stale)).map(_._1)
      .innerJoin(UserStatTable.getQualityOfUsers).on(_._2 === _._1)  // join on user_id
      .filterNot(_._2._3) // filter out users marked with excluded = TRUE
      // SELECT street_edge_id, (is_good_user AND NOT (low_quality or incomplete or stale))
      .map { case (_task, _qual) => (_task._1, (_qual._2  && !(_task._3 || _task._4 || _task._5))) }

    /********** Compute Audit Counts **********/

    // For audits by good users and bad users separately, group by street_edge_id and count the number of audits.
    val goodUserAuditCounts = completions.filter(_._2).groupBy(_._1).map { case (edge, group) => (edge, group.length)}
    val badUserAuditCounts = completions.filterNot(_._2).groupBy(_._1).map { case (edge, group) => (edge, group.length)}

    // Join the good and bad user audit counts with street_edge table, filling in any counts not present as 0. We now
    // have a table with three columns: street_edge_id, good_user_audit_count, bad_user_audit_count.
    val allAuditCounts =
      StreetEdgeTable.streetEdgesWithoutDeleted.leftJoin(goodUserAuditCounts).on(_.streetEdgeId === _._1).map {
        case (_edge, _goodCount) => (_edge.streetEdgeId, _goodCount._2.ifNull(0.asColumnOf[Int]))
      }.leftJoin(badUserAuditCounts).on(_._1 === _._1).map {
        case (_goodCount, _badCount) => (_goodCount._1, _goodCount._2, _badCount._2.ifNull(0.asColumnOf[Int]))
      }

    /********** Compute Priority **********/
    // If good_user_audit_count > 0, priority = 1 / (1 + good_user_audit_count + 0.25*bad_user_audit_count)
    // Else priority = 1 -- i.e., 1 / (1 + 0)
    val priorityParamTable: List[StreetEdgePriorityParameter] =
      allAuditCounts.list.map {
        streetCount =>
          if (streetCount._2 > 0) {
            StreetEdgePriorityParameter.tupled((streetCount._1, streetCount._2 + 0.25 * streetCount._3))
          }
          else {
            StreetEdgePriorityParameter.tupled((streetCount._1, 0.0))
          }
      }

    normalizePriorityReciprocal(priorityParamTable)
  }

  /**
    * Partially updates priority of a street edge based on current priority (used after an audit of the street is done).
    *
    * Feb 25: This is equivalent to adding 1 to the good_user_audit_count...
    * if old_priority = 1 / c' (where c' = 1 + good_user_audit_count + bad_user_audit_count), then c' = 1 / old_priority
    * Then if you want to calculate a new priority with count c' + 1,
    * you get new_priority = 1 / (1 + c') = 1 / (1 + (1 / old_priority))
    *
    * @param streetEdgeId
    * @return success boolean
    */
  def partiallyUpdatePriority(streetEdgeId: Int, userId: UUID): Boolean = db.withSession { implicit session =>
    // Check if the user that audited is high quality. Make sure they have an entry in user_stat table first.
    UserStatTable.addUserStatIfNew(userId)
    val userHighQuality: Boolean = UserStatTable.userStats.filter(_.userId === userId.toString).map(_.highQuality).first

    val priorityQuery = for { edge <- streetEdgePriorities if edge.streetEdgeId === streetEdgeId } yield edge.priority
    val rowsWereUpdated: Option[Boolean] = priorityQuery.run.headOption.map { currPriority =>
      // Only update the priority if the street was audited by a high quality user.
      val newPriority: Double = if (userHighQuality) {
        1 / (1 + (1 / currPriority))
      } else if (currPriority < 1) {
        1 / (0.25 + (1 / currPriority))
      } else {
        currPriority
      }
      val rowsUpdated: Int = priorityQuery.update(newPriority)
      rowsUpdated > 0
    }
    rowsWereUpdated.getOrElse(false)
  }
}
