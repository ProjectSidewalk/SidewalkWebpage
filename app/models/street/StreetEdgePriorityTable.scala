package models.street

import models.audit.{AuditTaskEnvironmentTable, AuditTaskTable}
import models.daos.slick.DBTableDefinitions.UserTable
import models.label.LabelTable
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.libs.json._

import scala.slick.lifted.ForeignKeyQuery
import scala.slick.jdbc.{StaticQuery => Q}
import scala.slick.jdbc.GetResult
import scala.math.exp

case class StreetEdgePriorityParameter(streetEdgeId: Int, priorityParameter: Double)
case class StreetEdgePriority(streetEdgePriorityId: Int, streetEdgeId: Int, priority: Double){
  /**
    * Converts a StreetEdgePriority object into the JSON format
    *
    * @return
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
  val userTable = TableQuery[UserTable]

  val LABEL_PER_METER_THRESHOLD: Float = 0.0375.toFloat

  implicit val streetEdgePriorityParameterConverter = GetResult(r => {
    StreetEdgePriorityParameter(r.nextInt, r.nextDouble)
  })

  /**
    * Save a record.
    *
    * @param streetEdgePriority
    * @return
    */
  def save(streetEdgePriority: StreetEdgePriority) = db.withTransaction { implicit session =>
    val streetEdgePriorityId: Int =
      (streetEdgePriorities returning streetEdgePriorities.map(_.streetEdgePriorityId)) += streetEdgePriority
    streetEdgePriorityId
  }

  /**
    * Update the priority attribute of a single streetEdge.
    *
    * @param streetEdgeId
    * @param priority
    * @return
    */

  def updateSingleStreetEdgePriority(streetEdgeId: Int, priority: Double) = db.withTransaction { implicit session =>
    val q = for { edg <- streetEdgePriorities if edg.streetEdgeId === streetEdgeId} yield edg.priority
    q.update(priority)
  }

  def getSingleStreetEdgePriority(streetEdgeId: Int): Double = db.withTransaction { implicit session =>
    streetEdgePriorities.filter{ edg => edg.streetEdgeId === streetEdgeId}.map(_.priority).list.head
  }

  def resetAllStreetEdge(priority: Double) = db.withTransaction { implicit session =>
    streetEdgePriorities.map(_.priority).update(priority)
  }

  /**
    * Helper logistic function to convert a double float to a number between 0 and 1.
    *
    * @param z
    * @return
    */

  def logisticFunction(z: Double): Double = db.withTransaction { implicit session =>
    return exp(-z) / (1 + exp(-z))
  }

  /**
    * Helper function to normalize the priorityParameter of a list of StreetEdgePriorityParameter objects to between 0
    * and 1. This uses the min-max normalization method. If there is no variation in the values (i.e. min value = max
    * value) then just use 1/(number of values).
    *
    * @param priorityParamTable
    * @return
    */

  def normalizePriorityParamMinMax(priorityParamTable: List[StreetEdgePriorityParameter]): List[StreetEdgePriorityParameter] = db.withTransaction { implicit session =>
    val maxParam: Double = priorityParamTable.map(_.priorityParameter).max
    val minParam: Double = priorityParamTable.map(_.priorityParameter).min
    val numParam: Double = priorityParamTable.length.toDouble
    maxParam.equals(minParam) match {
      case false =>
        priorityParamTable.map {
          x => x.copy(priorityParameter = (x.priorityParameter - minParam) / (maxParam - minParam))
        }
      case true =>
        // When the max priority parameter value is the same as the min priority parmeter value then normalization will
        // encounter a divide by zero error. In this case we just assign a normalized priority value of 1/(length of
        // array) for each street edge.
        priorityParamTable.map{x => x.copy(priorityParameter = 1/numParam)}
    }
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

  def listAll: List[StreetEdgePriority] = db.withTransaction { implicit session =>
    streetEdgePriorities.list
  }


  /**
    * Functions that generate paramaters for street edge priority evaluation.
    */

  /**
    * Returns 1 / (1 + audit_count) for each street edge.
    *
    * @return
    */
  def selectCompletionCountPriority: List[StreetEdgePriorityParameter] = db.withSession { implicit session =>
    
    val priorityParamTable: List[StreetEdgePriorityParameter] =
      StreetEdgeAssignmentCountTable.computeEdgeCompletionCounts.list.map {
        x => StreetEdgePriorityParameter.tupled((x._1, x._2.toDouble))
      }
    normalizePriorityReciprocal(priorityParamTable)
  }

  /**
    * Returns 1 if good_user_audit_count = 0, o/w 1 / (1 + good_user_audit_count + 0.25*bad_user_audit_count)
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

    // Compute distance of each street edge
    val streetDist = StreetEdgeTable.streetEdges.map(edge => (edge.streetEdgeId, edge.geom.transform(26918).length))


    /********** Quality of Users **********/

    // To each audit_task completed by a user, we attach a boolean indicating whether or not the user had a labeling
    // frequency above our threshold.
    // NOTE We are calling the getQualityOfUsers function below, which does the heavy lifting.
    val completions = AuditTaskTable.completedTasks
      .groupBy(task => (task.streetEdgeId, task.userId)).map(_._1)  // select distinct on street edge id and user id
      .innerJoin(getQualityOfUsers).on(_._2 === _._1)  // join on user_id
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
    * Computes labeling frequency for each user, marking as "good" if above our labeling frequency threshold.
    *
    * @return A query with rows of the form (user_id: String, is_good_user: Boolean)
    */
  def getQualityOfUsers: Query[(Column[String], Column[Option[Boolean]]), (String, Option[Boolean]), Seq] = db.withSession { implicit session =>
    val streetDist = StreetEdgeTable.streetEdges.map(edge => (edge.streetEdgeId, edge.geom.transform(26918).length))

    // Gets all tasks completed by users, groups by user_id, and sums over the distances of the street edges.
    val auditedDists = (for {
      _user <- userTable if _user.username =!= "anonymous"
      _task <- AuditTaskTable.completedTasks if _task.userId === _user.userId
      _dist <- streetDist if _task.streetEdgeId === _dist._1
    } yield (_user.userId, _dist._2)).groupBy(_._1).map(x => (x._1, x._2.map(_._2).sum))

    // Gets all audit tasks, groups by user_id, and counts number of labels places (incl. incomplete tasks).
    val labelCounts = (for {
      _user <- userTable if _user.username =!= "anonymous"
      _task <- AuditTaskTable.auditTasks if _task.userId === _user.userId
      _lab  <- LabelTable.labelsWithoutDeletedOrOnboarding if _task.auditTaskId === _lab.auditTaskId
    } yield (_user.userId, _lab.labelId)).groupBy(_._1).map(x => (x._1, x._2.length)) // SELECT user_id, COUNT(*)

    // Finally, determine whether each user is above or below the label per meter threshold.
    // SELECT user_id, is_good_user (where is_good_user = label_count/distance_audited > threshold)
    auditedDists
      .leftJoin(labelCounts).on(_._1 === _._1)
      .map { case (d,c) => (d._1, c._2.ifNull(0.asColumnOf[Int]).asColumnOf[Float] / d._2 > LABEL_PER_METER_THRESHOLD) }
  }

  def getIdsOfGoodUsers: List[String] = db.withSession { implicit session =>
    getQualityOfUsers.filter(_._2).map(_._1).list
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
