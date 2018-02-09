package models.street

import models.audit.AuditTaskTable
import models.region.RegionTable
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

class StreetEdgePriorityTable(tag: Tag) extends Table[StreetEdgePriority](tag, Some("sidewalk"),  "street_edge_priority") {
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
    StreetEdgePriorityParameter(r.nextInt, r.nextInt, r.nextDouble)
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

  def getAllStreetEdgeInRegionPriority(regionId: Int): List[StreetEdgePriority] = db.withTransaction { implicit session =>
    // Merge with street edge region table
    val sep = for {
      (sep, ser) <- streetEdgePriorities join streetEdgeRegion
    } yield sep
    sep.list
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
    * Recalculate the priority attribute for all streetEdges (this uses hardcoded min-max normalization).
    *
    * @param rankParameterGeneratorList List of funcs that generate a number between 0 and 1 for each streetEdge.
    * @param weightVector List of positive numbers b/w 0 and 1 that sum to 1; used to weight the generated parameters.
    * @return
    */
  def updateAllStreetEdgePriorities(rankParameterGeneratorList: List[()=>List[StreetEdgePriorityParameter]], weightVector: List[Double]) = db.withTransaction { implicit session =>

    // Reset street edge priority to zero
    val q1 = for { edg <- streetEdgePriorities} yield edg.priority
    val updateAction = q1.update(0.0)

    for( (f_i,w_i) <- rankParameterGeneratorList.zip(weightVector)) {
      // Run the i'th rankParameter generator.
      // Store this in the priorityParamTable variable
      val priorityParamTable: List[StreetEdgePriorityParameter] = f_i()
      priorityParamTable.foreach{ street_edge =>
        val q2 = for { edg <- streetEdgePriorities if edg.streetEdgeId === street_edge.streetEdgeId } yield edg.priority
        val tempPriority = q2.list.head + street_edge.priorityParameter*w_i
        val updatePriority = q2.update(tempPriority)
      }
    }
  }

  def listAll: List[StreetEdgePriority] = db.withTransaction { implicit session =>
    streetEdgePriorities.list
  }


  /**
    * Functions that generate paramaters for street edge priority evaluation
    */

  /**
    * Returns how many times each street has been audited.
    *
    * @return
    */
  def selectCompletionCountPriority: List[StreetEdgePriorityParameter] = db.withSession { implicit session =>

    val completionCounts = for {
      _counts <- StreetEdgeAssignmentCountTable.computeEdgeCompletionCounts
      _edgeRegion <- StreetEdgeRegionTable.streetEdgeRegionTable if _edgeRegion.streetEdgeId === _counts._1
      _region <- RegionTable.regionsWithoutDeleted if _region.regionId === _edgeRegion.regionId
      if _region.regionTypeId === 2 // only neighborhood (exclude cities)
    } yield (_region.regionId, _counts._1, _counts._2)

    val priorityParamTable: List[StreetEdgePriorityParameter] = completionCounts.list.map {
      x => StreetEdgePriorityParameter.tupled((x._2, x._3.toDouble))
    }
    normalizePriorityReciprocal(priorityParamTable)
  }
}
