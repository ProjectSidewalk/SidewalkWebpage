package models.street

import java.sql.Timestamp
import com.vividsolutions.jts.geom.LineString
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.api._
import play.api.Play.current
import slick.jdbc.{StaticQuery => Q, GetResult}

case class StreetEdgeIssue(streetEdgeIssueId: Int, streetEdgeId: Int, issue: String, userId: String, ipAddress: String, timestamp: Timestamp)

class StreetEdgeIssueTable(tag: Tag) extends Table[StreetEdgeIssue](tag, Some("sidewalk"), "street_edge_issue") {
  def streetEdgeIssueId = column[Int]("street_edge_issue_id", O.PrimaryKey, O.AutoInc)
  def streetEdgeId = column[Int]("street_edge_id")
  def issue = column[String]("issue")
  def userId = column[String]("user_id")
  def ipAddress = column[String]("ip_address")
  def timestamp = column[Timestamp]("timestamp")

  def * = (streetEdgeIssueId, streetEdgeId, issue, userId, ipAddress, timestamp) <> ((StreetEdgeIssue.apply _).tupled, StreetEdgeIssue.unapply)
}

object StreetEdgeIssueTable {
  val db = play.api.db.slick.DB
  val streetEdgeIssues = TableQuery[StreetEdgeIssueTable]

  /**
    * Save a StreetEdge into the street_edge table
    *
    * @param issue A StreetEdge object
    * @return
    */
  def save(issue: StreetEdgeIssue): Int = db.withTransaction { implicit session =>
    streetEdgeIssues += issue
    0
  }

}

