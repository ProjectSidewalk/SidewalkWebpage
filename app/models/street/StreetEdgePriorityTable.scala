package models.street

import com.google.inject.ImplementedBy
import models.audit.AuditTaskTableDef
import models.user.UserStatTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.collection.mutable
import scala.concurrent.ExecutionContext

case class StreetEdgePriorityParameter(streetEdgeId: Int, priorityParameter: Double)
case class StreetEdgePriority(streetEdgePriorityId: Int, streetEdgeId: Int, priority: Double)

class StreetEdgePriorityTableDef(tag: slick.lifted.Tag) extends Table[StreetEdgePriority](tag, "street_edge_priority") {
  def streetEdgePriorityId: Rep[Int] = column[Int]("street_edge_priority_id", O.PrimaryKey, O.AutoInc)
  def streetEdgeId: Rep[Int] = column[Int]("street_edge_id")
  def priority: Rep[Double] = column[Double]("priority")

  def * = (streetEdgePriorityId, streetEdgeId, priority) <> ((StreetEdgePriority.apply _).tupled, StreetEdgePriority.unapply)

//  def streetEdge: ForeignKeyQuery[StreetEdgeTable, StreetEdge] =
//    foreignKey("street_edge_priority_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(_.streetEdgeId)
}

@ImplementedBy(classOf[StreetEdgePriorityTable])
trait StreetEdgePriorityTableRepository { }

@Singleton
class StreetEdgePriorityTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider,
                                        implicit val ec: ExecutionContext
                                       ) extends StreetEdgePriorityTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {

  val userStats = TableQuery[UserStatTableDef]
  val streetEdgePriorities = TableQuery[StreetEdgePriorityTableDef]
  val streetEdges = TableQuery[StreetEdgeTableDef]
  val streetEdgesWithoutDeleted = streetEdges.filter(_.deleted === false)
  val streetEdgeRegionTable = TableQuery[StreetEdgeRegionTableDef]
  val auditTaskTable = TableQuery[AuditTaskTableDef]
  val completedTasks = auditTaskTable.filter(_.completed === true)

  def insert(streetEdgePriority: StreetEdgePriority): DBIO[Int] = {
    (streetEdgePriorities returning streetEdgePriorities.map(_.streetEdgePriorityId)) += streetEdgePriority
  }

  def auditedStreetDistanceUsingPriority: DBIO[Float] = {
    // Get the lengths of all the audited street edges.
    val edgeLengths = for {
      se <- streetEdgesWithoutDeleted
      sep <- streetEdgePriorities if se.streetEdgeId === sep.streetEdgeId
      if sep.priority < 1.0D
    } yield se.geom.transform(26918).length

    // Sum the lengths and convert from meters to miles.
    edgeLengths.sum.result.map(x => x.getOrElse(0.0F))
  }

  /**
   * Helper function to normalize the priorityParameter of a list of StreetEdgePriorityParameter objects to between 0
   * and 1. This returns the reciprocal for each street edge's parameter value. The reciprocal is calculated after
   * adding some prior to the value to prevent divide by zero errors.
   *
   * @param priorityParams
   */
  def normalizePriorityReciprocal(priorityParams: Seq[StreetEdgePriorityParameter]): Seq[StreetEdgePriorityParameter] = {
    val prior = 1
    priorityParams.map{x => x.copy(priorityParameter = 1 / (x.priorityParameter + prior))}
  }

  /**
   * Recalculates street edge priority for all streets.
   */
  def recalculateStreetPriority: DBIO[Seq[Int]] = {
    // Function pointer to the function that returns priority based on audit counts of good/bad users
    // The functions being pointed to should always have the signature ()=>Seq[StreetEdgePriorityParameter]
    // (Takes no input arguments and returns a Seq[StreetEdgePriorityParameter])
    val completionCountPriority: DBIO[() => Seq[StreetEdgePriorityParameter]] = selectGoodBadUserCompletionCountPriority.map(() => _)

    // List of function pointers that will generate priority parameters.
    val rankParameterGeneratorList: DBIO[Seq[() => Seq[StreetEdgePriorityParameter]]] =
      completionCountPriority.map(Seq(_))
    // Seq(completionCountPriority1,completionCountPriority2) // how it would look with two priority param funcs

    // Final Priority for each street edge is calculated by some transformation (paramScalingFunction)
    // of the weighted sum (weights are given by the weightVector) of the priority parameters.
    // val paramScalingFunction: (Double) => Double = StreetEdgePriorityTable.logisticFunction
    val weightVector: Seq[Double] = Seq(1D)
    // val weightVector: Seq[Double] = Seq(0.1,0.9) -- how it would look with two priority param funcs
    updateAllStreetEdgePriorities(rankParameterGeneratorList, weightVector)
  }

  /**
   * Return streets that have been audited by any user since a given time.
   * @param regionId
   * @param timestamp
   */
  def streetPrioritiesUpdatedSinceTime(regionId: Int, timestamp: OffsetDateTime): DBIO[Seq[StreetEdgePriority]] = {
    (for {
      ct <- completedTasks
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
  def updateAllStreetEdgePriorities(rankParameterGeneratorList: DBIO[Seq[()=>Seq[StreetEdgePriorityParameter]]], weightVector: Seq[Double]) = {
    for {
      paramGeneratorList: Seq[() => Seq[StreetEdgePriorityParameter]] <- rankParameterGeneratorList

      // Create a map from each street edge to a default priority value of 0.
      streetIds <- streetEdgePriorities.map(_.streetEdgeId).result
      edgePriorityMap = mutable.Map[Int, Double](streetIds.map(id => id -> 0.0): _*)

      // Compute weighted sum of priority based on the rankParameter generators.
      _ = for ((f_i,w_i) <- paramGeneratorList.zip(weightVector)) {
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
  def selectGoodBadUserCompletionCountPriority: DBIO[Seq[StreetEdgePriorityParameter]] = {
    /********** Quality of Users **********/

    // Add a boolean indicating whether the user has a labeling frequency above a threshold to each completed auditTask.
    // NOTE We are calling the getQualityOfUsers function below, which does the heavy lifting.
    val completions = completedTasks
      // Select distinct street edge ids, and keep user id and street flags
      .groupBy(task => (task.streetEdgeId, task.userId, task.lowQuality, task.incomplete, task.stale)).map(_._1)
      .join(userStats).on(_._2 === _.userId)  // join on user_id
      .filterNot(_._2.excluded) // filter out users marked with excluded = TRUE
      // SELECT street_edge_id, (is_good_user AND NOT (low_quality or incomplete or stale))
      .map { case (_task, _qual) => (_task._1, _qual.highQuality  && !(_task._3 || _task._4 || _task._5)) }

    /********** Compute Audit Counts **********/

    // For audits by good users and bad users separately, group by street_edge_id and count the number of audits.
    val goodUserAuditCounts = completions.filter(_._2).groupBy(_._1).map { case (edge, group) => (edge, group.length)}
    val badUserAuditCounts = completions.filterNot(_._2).groupBy(_._1).map { case (edge, group) => (edge, group.length)}

    // Join the good and bad user audit counts with street_edge table, filling in any counts not present as 0. We now
    // have a table with three columns: street_edge_id, good_user_audit_count, bad_user_audit_count.
    val allAuditCounts =
      streetEdgesWithoutDeleted.joinLeft(goodUserAuditCounts).on(_.streetEdgeId === _._1).map {
        case (_edge, _goodCount) => (_edge.streetEdgeId, _goodCount.map(_._2).getOrElse(0))
      }.joinLeft(badUserAuditCounts).on(_._1 === _._1).map {
        case (_goodCount, _badCount) => (_goodCount._1, _goodCount._2, _badCount.map(_._2).getOrElse(0))
      }

    /********** Compute Priority **********/
    // If good_user_audit_count > 0, priority = 1 / (1 + good_user_audit_count + 0.25*bad_user_audit_count)
    // Else priority = 1 -- i.e., 1 / (1 + 0)
    val priorityParamTable: DBIO[Seq[StreetEdgePriorityParameter]] =
      allAuditCounts.result.map(_.map {
        streetCount =>
          if (streetCount._2 > 0) {
            StreetEdgePriorityParameter.tupled((streetCount._1, streetCount._2 + 0.25 * streetCount._3))
          }
          else {
            StreetEdgePriorityParameter.tupled((streetCount._1, 0.0))
          }
      })

    priorityParamTable.map(normalizePriorityReciprocal)
  }

  /**
   * Partially updates priority of a street edge based on current priority (used after an audit of the street is done).
   *
   * TODO this isn't a simple CRUD operation and should probably be moved to a Service file.
   * Feb 25: This is equivalent to adding 1 to the good_user_audit_count...
   * if old_priority = 1 / c' (where c' = 1 + good_user_audit_count + bad_user_audit_count), then c' = 1 / old_priority
   * Then if you want to calculate a new priority with count c' + 1,
   * you get new_priority = 1 / (1 + c') = 1 / (1 + (1 / old_priority))
   *
   * @param streetEdgeId
   * @return Some(newPriority) if the priority was updated, None otherwise.
   */
  def partiallyUpdatePriority(streetEdgeId: Int, userId: String): DBIO[Option[Double]] = {
    val priorityQuery = streetEdgePriorities.filter(_.streetEdgeId === streetEdgeId).map(_.priority)
    for {
      userHighQuality: Boolean <- userStats.filter(_.userId === userId).map(_.highQuality).take(1).result.head
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
      rowsUpdated: Int <- newPriorityOption.map { newPriority =>
        priorityQuery.update(newPriority)
      }.getOrElse(DBIO.successful(0))
    } yield {
      if (rowsUpdated > 0) newPriorityOption else None
    }
  }
}
