package models.street

import models.utils.MyPostgresDriver.simple._

import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery
import scala.slick.jdbc.{StaticQuery => Q}

import scala.math.exp

case class StreetEdgePriorityParameter(regionId: Int, streetEdgeId: Int, priorityParameter: Double)
case class StreetEdgePriority(streetEdgePriorityId: Int, regionId: Int, streetEdgeId: Int, priority: Double)

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

  def updateSingleStreetEdge(regionId: Int, streetEdgeId: Int, priority: Double) = db.withTransaction { implicit session =>
    val q = for { edg <- streetEdgePriorities if edg.streetEdgeId === streetEdgeId && edg.regionId === regionId} yield edg.priority
    q.update(priority)
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
    * Recalculate the priority attribute for all streetEdges.
    * @param rankParameterGeneratorList list of functions that will generate a number for each streetEdge
    * @param weightVector that will be used to weight the generated parameters
    * @param paramScalingFunction that will be used to convert the weighted sum of numbers for each street into a number between 0 and 1
    * @return
    */
  def updateAllStreetEdgePriorities(rankParameterGeneratorList: List[()=>List[StreetEdgePriorityParameter]], weightVector: List[Double], paramScalingFunction: (Double)=>Double): List[Double] = db.withTransaction { implicit session =>

    //Reset street edge priority to zero
    var tempStreetEdgePriorities = streetEdgePriorities.map{ streetEdge =>
      streetEdge.priority = 0.0
    }

    rankParameterGeneratorList.zip(weightVector).foreach{ (f_i,w_i) =>
      var priorityParamTable: List[StreetEdgePriorityParameter] = f_i()
      var innerJoin = for {
        (t, p) <- tempStreetEdgePriorities join priorityParamTable on (_.regionId === _.regionId && _.streetEdgeId === _.streetEdgeId)
      } yield (t.regionId, t.streetEdgeId, paramScalingFunction(t.priority + p.priorityParam*w_i))

      tempStreetEdgePriorities = innerJoin
    }
    return tempStreetEdgePriorities
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
      """SELECT region.region_id, street_edge.street_edge_id, CAST(street_edge_assignment_count.completion_count as float)
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
    selectCompletionCountQuery.list
  }
}