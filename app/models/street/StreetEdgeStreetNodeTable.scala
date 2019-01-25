package models.street

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

case class StreetEdgeStreetNode(streetEdgeStreetNodeId: Int, streetEdgeId: Int, streetNodeId: Int)

class StreetEdgeStreetNodeTable(tag: Tag) extends Table[StreetEdgeStreetNode](tag, Some("sidewalk"), "street_edge_parent_edge") {
  def streetEdgeStreetNodeId = column[Int]("street_edge_street_node_id", O.PrimaryKey)
  def streetEdgeId = column[Int]("street_edge_id")
  def streetNodeId = column[Int]("street_node_id")

  def * = (streetEdgeStreetNodeId, streetEdgeId, streetNodeId) <> ((StreetEdgeStreetNode.apply _).tupled, StreetEdgeStreetNode.unapply)
}

object StreetEdgeStreetNodeTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val streetEdgeStreetNodes = TableQuery[StreetEdgeStreetNodeTable]
}
