package models.street

import java.sql.Timestamp
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class StreetEdgeIssue(streetEdgeIssueId: Int, streetEdgeId: Int, issue: String, userId: String, ipAddress: String, timestamp: Timestamp)

class StreetEdgeIssueTable(tag: Tag) extends Table[StreetEdgeIssue](tag, Some("sidewalk"), "street_edge_issue") {
  def streetEdgeIssueId = column[Int]("street_edge_issue_id", O.PrimaryKey, O.AutoInc)
  def streetEdgeId = column[Int]("street_edge_id", O.NotNull)
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
    * Save a StreetEdgeIssue into the street_edge_issue table.
    *
    * @param issue A StreetEdgeIssue object
    * @return
    */
  def save(issue: StreetEdgeIssue): Int = db.withTransaction { implicit session =>
    streetEdgeIssues += issue
    0
  }
}
