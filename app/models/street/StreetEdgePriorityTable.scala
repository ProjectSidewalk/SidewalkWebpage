package models.street

import models.utils.MyPostgresDriver.simple._

import play.api.Play.current
import play.api.libs.json._

import scala.slick.lifted.ForeignKeyQuery
import scala.slick.jdbc.{StaticQuery => Q}
import scala.slick.jdbc.GetResult

import scala.math.exp

case class StreetEdgePriorityParameter(regionId: Int, streetEdgeId: Int, priorityParameter: Double)
case class StreetEdgePriority(streetEdgePriorityId: Int, regionId: Int, streetEdgeId: Int, priority: Double){
  /**
    * This method converts the data into the JSON format
    * @return
    */
  def toJSON: JsObject = {
    Json.obj("regionId" -> regionId, "streetEdgeId" -> streetEdgeId, "priority" -> priority)
  }
}

class StreetEdgePriorityTable(tag: Tag) extends Table[StreetEdgePriority](tag, Some("sidewalk"),  "street_edge_priority") {
  def streetEdgePriorityId = column[Int]("street_edge_priority_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def regionId = column[Int]("region_id",O.NotNull)
  def streetEdgeId = column[Int]("street_edge_id", O.NotNull)
  def priority = column[Double]("priority", O.NotNull)

  def * = (streetEdgePriorityId, regionId, streetEdgeId, priority) <> ((StreetEdgePriority.apply _).tupled, StreetEdgePriority.unapply)

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
    * @param streetEdgeId
    * @param regionId
    * @return
    */
  def save(streetEdgePriority: StreetEdgePriority): Int = db.withTransaction { implicit session =>
    val streetEdgePriorityId: Int =
      (streetEdgePriorities returning streetEdgePriorities.map(_.streetEdgePriorityId)) += streetEdgePriority
    streetEdgePriorityId
  }

  /**
    * Update the priority attribute of a single streetEdge.
    * @param streetEdgeId
    * @param priority
    * @return
    */

  def updateSingleStreetEdgePriority(regionId: Int, streetEdgeId: Int, priority: Double) = db.withTransaction { implicit session =>
    val q = for { edg <- streetEdgePriorities if edg.streetEdgeId === streetEdgeId && edg.regionId === regionId} yield edg.priority
    q.update(priority)
  }

  def getSingleStreetEdgePriority(regionId: Int, streetEdgeId: Int): Double = db.withTransaction { implicit session =>
    streetEdgePriorities.filter{ edg => edg.streetEdgeId === streetEdgeId && edg.regionId === regionId}.map(_.priority).list.head
  }

  def getAllStreetEdgeInRegionPriority(regionId: Int): List[StreetEdgePriority] = db.withTransaction { implicit session =>
    streetEdgePriorities.filter{ edg => edg.regionId === regionId}.list
  }

  def resetAllStreetEdge(priority: Double) = db.withTransaction { implicit session =>
    streetEdgePriorities.map(s => (s.priority)).update((priority))
  }

  /**
    * Helper logistic function to convert a double float to a number between 0 and 1.
    * @param z
    * @return
    */

  def logisticFunction(z: Double): Double = db.withTransaction { implicit session =>
    return exp(-z)/(1+exp(-z))
  }

  /**
    * Helper function to normalize the priorityParameter of a list of StreetEdgePriorityParameter objects to between 0 and 1
    * This uses the min-max normalization method. If there is no variation in the values (i.e. min value = max value) then just use 1/(number of values)
    * @param z
    * @return
    */

  def normalizePriorityParamMinMax(priorityParamTable: List[StreetEdgePriorityParameter]): List[StreetEdgePriorityParameter] = db.withTransaction { implicit session =>
    val maxPriorityParam: Double = priorityParamTable.map(_.priorityParameter).max
    val minPriorityParam: Double = priorityParamTable.map(_.priorityParameter).min
    val numPriorityParam: Double = priorityParamTable.length.toDouble
    maxPriorityParam.equals(minPriorityParam) match {
      case false =>
        priorityParamTable.map{x => x.copy(priorityParameter = (x.priorityParameter - minPriorityParam)/(maxPriorityParam - minPriorityParam))}
      case true =>
        // When the max priority parameter value is the same as the min priority parmeter value then normalization will encounter a divide by zero error
        // In this case we just assign a normalized priority value of 1/(length of array) for each street edge
        priorityParamTable.map{x => x.copy(priorityParameter = 1/numPriorityParam)}
    }
  }

  /**
    * Recalculate the priority attribute for all streetEdges. (This uses hardcoded min-max normalization)
    * @param rankParameterGeneratorList list of functions that will generate a number (normalized to between 0 and 1) for each streetEdge
    * @param weightVector that will be used to weight the generated parameters. This should be a list of positive real numbers between 0 and 1 that sum to 1.
    * @return
    */
  def updateAllStreetEdgePriorities(rankParameterGeneratorList: List[()=>List[StreetEdgePriorityParameter]], weightVector: List[Double]) = db.withTransaction { implicit session =>

    //Reset street edge priority to zero
    println("Starting streetedge priority recalculation")
    val q1 = for { edg <- streetEdgePriorities} yield edg.priority
    println("Reset street edge priority to zero")
    val updateAction = q1.update(0.0)

    for( (f_i,w_i) <- rankParameterGeneratorList.zip(weightVector)){
      // Run the i'th rankParameter generator.
      // Store this in the priorityParamTable variable
      val priorityParamTable: List[StreetEdgePriorityParameter] = f_i()
      priorityParamTable.foreach{ street_edge =>
        val q2 = for { edg <- streetEdgePriorities if edg.regionId === street_edge.regionId &&  edg.streetEdgeId === street_edge.streetEdgeId } yield edg.priority
        val tempPriority = q2.list.head + street_edge.priorityParameter*w_i
        val updatePriority = q2.update(tempPriority)
      }
    }

    println("Updated streetedge priority")
  }

  def listAll: List[StreetEdgePriority] = db.withTransaction { implicit session =>
    streetEdgePriorities.list
  }

  /**
    * Functions that generate paramaters for street edge priority evaluation
    */

  /**
    * This method returns how many times streets are audited
    * @return
    */
  def selectCompletionCount: List[StreetEdgePriorityParameter] = db.withSession { implicit session =>
    val selectCompletionCountQuery =  Q.queryNA[StreetEdgePriorityParameter](
      """SELECT region.region_id, street_edge.street_edge_id, CAST(-street_edge_assignment_count.completion_count as float) AS completion_count
        |  FROM sidewalk.region
        |INNER JOIN sidewalk.street_edge_region
        |  ON street_edge_region.region_id = region.region_id
        |INNER JOIN sidewalk.street_edge
        |  ON street_edge.street_edge_id = street_edge_region.street_edge_id
        |INNER JOIN street_edge_assignment_count
        |  ON street_edge_assignment_count.street_edge_id = street_edge.street_edge_id
        |WHERE region.deleted = FALSE
        |  AND region.region_type_id = 2
        |  AND street_edge.deleted = FALSE
        |  ORDER BY street_edge.street_edge_id,region.region_id,region.region_id""".stripMargin
    )
    val priorityParamTable = selectCompletionCountQuery.list
    normalizePriorityParamMinMax(priorityParamTable)
  }
}