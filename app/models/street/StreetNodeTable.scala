package models.street

import com.vividsolutions.jts.geom.Point
import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

case class StreetNode(streetNodeId: Int, geom: Point, lat: Double, lng: Double)

class StreetNodeTable(tag: Tag) extends Table[StreetNode](tag, Some("sidewalk"),  "street_node") {
  def streetNodeId = column[Int]("street_edge_street_node_id", O.PrimaryKey)
  def geom = column[Point]("geom")
  def lat = column[Double]("lat")
  def lng = column[Double]("lng")

  def * = (streetNodeId, geom, lat, lng) <> ((StreetNode.apply _).tupled, StreetNode.unapply)
}

object StreetNodeTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val streetNodes = TableQuery[StreetNodeTable]
}
