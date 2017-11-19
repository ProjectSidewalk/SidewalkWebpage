package models.street

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

import scala.math.exp

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

  def updateCompleted(regionId: Int, streetEdgeId: Int, priority: Double) = db.withTransaction { implicit session =>
    val q = for { edg <- streetEdgePriorities if edg.streetEdgeId === streetEdgeId && edg.regionId === regionId} yield edg.priority
    q.update(priority)
  }

  /**
    * Helper logistic function to convert an array of doubles to a single number between 0 and 1.
    * @param w weights
    * @param x routing parameters
    * @return
    */

  def logisticFunction(w: Array[Double], x: Array[Double]): Double = db.withTransaction { implicit session =>
    val z: Double = w.zip(x).map { case (w_i, x_i) => w_i * x_i }.sum
    return exp(-z)/(1+exp(-z))
  }

  /**
    * Recalculate the priority attribute for all streetEdges.
    * @param rankParameterGeneratorList list of functions that will generate a number for each streetEdge
    * @param weightVector that will be used to weight the generated parameters
    * @param paramAggregationFunction that will be used to convert the weighted sum of numbers for each street into a number between 0 and 1
    * @return
    */
  def recalculateAllStreetEdgePriorities(rankParameterGeneratorList: List[()=>Array[Double]], weightVector: Array[Double], paramAggregationFunction: (Array[Double],Array[Double])=>Double) = db.withTransaction { implicit session =>

  }

  def listAll: List[StreetEdgePriority] = db.withTransaction { implicit session =>
    streetEdgePriorities.list
  }
}