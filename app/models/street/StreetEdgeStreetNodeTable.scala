package models.street

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class StreetEdgeStreetNode(streetEdgeStreetNodeId: Int, streetEdgeId: Int, streetNodeId: Int)

class StreetEdgeStreetNodeTable(tag: Tag) extends Table[StreetEdgeStreetNode](tag, Some("sidewalk"),  "street_edge_parent_edge") {
  def streetEdgeStreetNodeId = column[Int]("street_edge_street_node_id", O.PrimaryKey)
  def streetEdgeId = column[Int]("street_edge_id")
  def streetNodeId = column[Int]("street_node_id")

  def * = (streetEdgeStreetNodeId, streetEdgeId, streetNodeId) <> ((StreetEdgeStreetNode.apply _).tupled, StreetEdgeStreetNode.unapply)
}

object StreetEdgeStreetNodeTable {
  val db = play.api.db.slick.DB
  val streetEdgeStreetNodes = TableQuery[StreetEdgeStreetNodeTable]
}
