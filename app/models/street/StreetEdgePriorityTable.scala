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
    * - for anonymous and registered users separately:
    *    - assign each user as "good" or "bad" based on their labeling frequency
    *      - compute total distance audited by each user, and total label count for each user
    *      - join the audited distance and label count tables to compute labeling frequency (now done in separate func)
    *  - combine the results for anonymous and registered users
    *  - for each street edge
    *    - count the number of audits by "good" users, and the number of audits by "bad" users
    *    - if good_user_audit_count == 0 -> priority = 1
    *      else                          -> priority = 1 / (1 + good_user_audit_count + 0.25*bad_user_audit_count)
    * NOTE The process for registered and anonymous users is identical, except that for anonymous users there is the
    *      additional step of a join with the audit_task_environment table to get the ip_address, followed by a SELECT
    *      DISTINCT on (ip_address, audit_task_id). This forces us to treat them separately until the end.
    *
    * @return
    */
  def selectGoodBadUserCompletionCountPriority: List[StreetEdgePriorityParameter] = db.withSession { implicit session =>

    // Compute distance of each street edge
    val streetDist = StreetEdgeTable.streetEdges.map(edge => (edge.streetEdgeId, edge.geom.transform(26918).length))


    /********** Registered Users **********/

    // To each audit_task completed by a registered user, we attach a boolean indicating whether or not the user had a
    // labeling frequency above our threshold.
    // NOTE We are calling the getQualityOfRegisteredUserIds function below, which does the heavy lifting.
    val regCompletions = AuditTaskTable.completedTasks
      .groupBy(task => (task.streetEdgeId, task.userId)).map(_._1)  // select distinct on street edge id and user id
      .innerJoin(getQualityOfRegisteredUserIds).on(_._2 === _._1)  // join on user_id
      .map { case (_task, _qual) => (_task._1, _qual._2) }  // SELECT street_edge_id, is_good_user

    /********** Anonymous Users **********/

    // Gets the tasks performed by anonymous users, along with ip address; need to select distinct b/c there can be
    // multiple audit_task_environment entries for a single task.
    // NOTE We are calling the getQualityOfAnonymousUserIps function below, which does the heavy lifting.
    val anonTasks = (for {
      _user <- userTable if _user.username === "anonymous"
      _task <- AuditTaskTable.completedTasks if _user.userId === _task.userId
      _env <- AuditTaskEnvironmentTable.auditTaskEnvironments if _task.auditTaskId === _env.auditTaskId
      if !_env.ipAddress.isEmpty
    } yield (_env.ipAddress, _task.auditTaskId, _task.streetEdgeId)).groupBy(x => x).map(_._1)  // SELECT DISTINCT

    // Now to each audit_task completed by an anonymous user, we attach a boolean indicating whether or not the user
    // had a labeling frequency above our threshold.
    val anonCompletions = anonTasks
      .groupBy(task => (task._1, task._3)).map(_._1)  // select distinct on ip address and street edge id
      .innerJoin(getQualityOfAnonymousUserIps).on(_._1 === _._1)  // join on ip address
      .map { case (_task, _qual) => (_task._2, _qual._2) }  // SELECT street_edge_id, is_good_user

    /********** Compute Audit Counts **********/
    // Combine results from anonymous and registered users.
    val completions = anonCompletions ++ regCompletions

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
    * Computes labeling frequency for each registered user, marking as "good" if above our labeling frequency threshold.
    *
    * @return A query with rows of the form (user_id: String, is_good_user: Boolean)
    */
  def getQualityOfRegisteredUserIds: Query[(Column[String], Column[Option[Boolean]]), (String, Option[Boolean]), Seq] = db.withSession { implicit session =>
    val streetDist = StreetEdgeTable.streetEdges.map(edge => (edge.streetEdgeId, edge.geom.transform(26918).length))

    // Gets all tasks completed by registered users, groups by user_id, and sums over the distances of the street edges.
    val regAuditedDists = (for {
      _user <- userTable if _user.username =!= "anonymous"
      _task <- AuditTaskTable.completedTasks if _task.userId === _user.userId
      _dist <- streetDist if _task.streetEdgeId === _dist._1
    } yield (_user.userId, _dist._2)).groupBy(_._1).map(x => (x._1, x._2.map(_._2).sum))

    // Gets all registered user tasks, groups by user_id, and counts number of labels places (incl. incomplete tasks).
    val regLabelCounts = (for {
      _user <- userTable if _user.username =!= "anonymous"
      _task <- AuditTaskTable.auditTasks if _task.userId === _user.userId
      _lab  <- LabelTable.labelsWithoutDeletedOrOnboarding if _task.auditTaskId === _lab.auditTaskId
    } yield (_user.userId, _lab.labelId)).groupBy(_._1).map(x => (x._1, x._2.length)) // SELECT user_id, COUNT(*)

    // Finally, determine whether each registered user is above or below the label per meter threshold
    // SELECT user_id, is_good_user (where is_good_user = label_count/distance_audited > threshold)
    regAuditedDists
      .leftJoin(regLabelCounts).on(_._1 === _._1)
      .map { case (d,c) => (d._1, c._2.ifNull(0.asColumnOf[Int]).asColumnOf[Float] / d._2 > LABEL_PER_METER_THRESHOLD) }
  }

  def getIdsOfGoodRegisteredUsers: List[String] = db.withSession { implicit session =>
    getQualityOfRegisteredUserIds.filter(_._2).map(_._1).list
  }

  /**
    * Computes labeling frequency for each anonymous user, marking as "good" if above our labeling frequency threshold.
    *
    * @return A query with rows of the form (ip_address: String, is_good_user: Boolean)
    */
  def getQualityOfAnonymousUserIps: Query[(Column[Option[String]], Column[Option[Boolean]]), (Option[String], Option[Boolean]), Seq] = db.withSession { implicit session =>
    val streetDist = StreetEdgeTable.streetEdges.map(edge => (edge.streetEdgeId, edge.geom.transform(26918).length))

    // Gets the tasks performed by anonymous users, along with ip address; need to select distinct b/c there can be
    // multiple audit_task_environment entries for a single task.
    val anonTasks = (for {
      _user <- userTable if _user.username === "anonymous"
      _task <- AuditTaskTable.completedTasks if _user.userId === _task.userId
      _env <- AuditTaskEnvironmentTable.auditTaskEnvironments if _task.auditTaskId === _env.auditTaskId
      if !_env.ipAddress.isEmpty
    } yield (_env.ipAddress, _task.auditTaskId, _task.streetEdgeId)).groupBy(x => x).map(_._1)  // SELECT DISTINCT

    // Takes all tasks completed by anon users, groups by ip_address, and sums over the distances of the street edges.
    val anonAuditedDists = anonTasks.innerJoin(streetDist).on(_._3 === _._1)
      .map { case (_task, _dist) => (_task._1, _dist._2) }    // SELECT ip_address, street_distance
      .groupBy(_._1)                                          // GROUP BY ip_address
      .map { case (ip, group) => (ip, group.map(_._2).sum) }  // SELECT ip_address, SUM(street_distance)

    // Gets all anon user tasks, groups by ip_address, and counts number of labels places (incl. incomplete tasks).
    val anonLabelCounts = (for {
      _user <- userTable if _user.username === "anonymous"
      _task <- AuditTaskTable.auditTasks if _user.userId === _task.userId
      _env <- AuditTaskEnvironmentTable.auditTaskEnvironments if _task.auditTaskId === _env.auditTaskId
      if !_env.ipAddress.isEmpty
      _lab <- LabelTable.labelsWithoutDeletedOrOnboarding if _task.auditTaskId === _lab.auditTaskId
    } yield (_env.ipAddress, _lab.labelId))
      .groupBy(x => x).map(_._1)  // SELECT DISTINCT
      .groupBy(_._1).map(x => (x._1, x._2.length))  // SELECT ip_address, COUNT(*)

    // Finally, determine whether each anonymous user is above or below the label per meter threshold.
    // SELECT ip_address, is_good_user (where is_good_user = label_count/distance_audited > threshold)
    anonAuditedDists
      .leftJoin(anonLabelCounts).on(_._1 === _._1)
      .map { case (d,c) => (d._1, c._2.ifNull(0.asColumnOf[Int]).asColumnOf[Float] / d._2 > LABEL_PER_METER_THRESHOLD) }
  }

  def getIdsOfGoodAnonymousUsers: List[String] = db.withSession { implicit session =>
    getQualityOfAnonymousUserIps.filter(_._2).map(_._1).list.flatten
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
