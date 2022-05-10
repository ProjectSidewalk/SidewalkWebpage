package models.street

import models.audit.AuditTaskTable
import models.user.UserStatTable
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.libs.json._
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

class StreetEdgePriorityTable(tag: slick.lifted.Tag) extends Table[StreetEdgePriority](tag, Some("sidewalk"),  "street_edge_priority") {
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
  def save(streetEdgePriority: StreetEdgePriority): Int = db.withTransaction { implicit session =>
    val streetEdgePriorityId: Int =
      (streetEdgePriorities returning streetEdgePriorities.map(_.streetEdgePriorityId)) += streetEdgePriority
    streetEdgePriorityId
  }

  /**
    * Helper function to normalize the priorityParameter of a list of StreetEdgePriorityParameter objects to between 0
    * and 1. This returns the reciprocal for each street edge's parameter value. The reciprocal is calculated after
    * adding some prior to the value to prevent divide by zero errors.
    *
    * @param priorityParamTable
    * @return
    */
  def normalizePriorityReciprocal(priorityParamTable: List[StreetEdgePriorityParameter]): List[StreetEdgePriorityParameter] = db.withTransaction { implicit session =>
    val prior = 1
    priorityParamTable.map{x => x.copy(priorityParameter = 1 / (x.priorityParameter + prior))}
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
  def updateAllStreetEdgePriorities(rankParameterGeneratorList: List[()=>List[StreetEdgePriorityParameter]],
                                    weightVector: List[Double]) = db.withTransaction { implicit session =>

    // Create a map from each street edge to a default priority value of 0.
    val edgePriorityMap = collection.mutable.Map[Int, Double]().withDefaultValue(0.0)
    for (id <- streetEdgePriorities.map(_.streetEdgeId).list) { edgePriorityMap += (id -> 0.0) }

    // Compute weighted sum of priority based on the rankParameter generators.
    for( (f_i,w_i) <- rankParameterGeneratorList.zip(weightVector)) {
      val priorityParamTable: List[StreetEdgePriorityParameter] = f_i()
      priorityParamTable.foreach { edge => edgePriorityMap(edge.streetEdgeId) += (edge.priorityParameter*w_i) }
    }

    // Set priority values in the table.
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
      .groupBy(task => (task.streetEdgeId, task.userId)).map(_._1)  // select distinct on street edge id and user id
      .innerJoin(UserStatTable.getQualityOfUsers).on(_._2 === _._1)  // join on user_id
      .filterNot(_._2._3.getOrElse(false)) // filter out users marked with exclude_manual = TRUE
      .map { case (_task, _qual) => (_task._1, _qual._2) }  // SELECT street_edge_id, is_good_user

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
  def partiallyUpdatePriority(streetEdgeId: Int): Boolean = db.withTransaction { implicit session =>
    val priorityQuery = for { edge <- streetEdgePriorities if edge.streetEdgeId === streetEdgeId } yield edge.priority
    val rowsWereUpdated: Option[Boolean] = priorityQuery.run.headOption.map {
      currPriority =>
        val newPriority: Double = 1 / (1 + (1 / currPriority))
        val rowsUpdated: Int = priorityQuery.update(newPriority)
        rowsUpdated > 0
    }
    rowsWereUpdated.getOrElse(false)
  }
}
