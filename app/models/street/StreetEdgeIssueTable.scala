package models.street

import com.google.inject.ImplementedBy
import models.utils.MyPostgresDriver

import java.sql.Timestamp
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play.current

import javax.inject.{Inject, Singleton}

case class StreetEdgeIssue(streetEdgeIssueId: Int, streetEdgeId: Int, issue: String, userId: String, ipAddress: String, timestamp: Timestamp)

class StreetEdgeIssueTableDef(tag: Tag) extends Table[StreetEdgeIssue](tag, "street_edge_issue") {
  def streetEdgeIssueId: Rep[Int] = column[Int]("street_edge_issue_id", O.PrimaryKey, O.AutoInc)
  def streetEdgeId: Rep[Int] = column[Int]("street_edge_id")
  def issue: Rep[String] = column[String]("issue")
  def userId: Rep[String] = column[String]("user_id")
  def ipAddress: Rep[String] = column[String]("ip_address")
  def timestamp: Rep[Timestamp] = column[Timestamp]("timestamp")

  def * = (streetEdgeIssueId, streetEdgeId, issue, userId, ipAddress, timestamp) <> ((StreetEdgeIssue.apply _).tupled, StreetEdgeIssue.unapply)
}

@ImplementedBy(classOf[StreetEdgeIssueTable])
trait StreetEdgeIssueTableRepository {
  def insert(issue: StreetEdgeIssue): DBIO[Int]
}

@Singleton
class StreetEdgeIssueTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends StreetEdgeIssueTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val streetEdgeIssues = TableQuery[StreetEdgeIssueTableDef]

  def insert(issue: StreetEdgeIssue): DBIO[Int] = {
    (streetEdgeIssues returning streetEdgeIssues.map(_.streetEdgeIssueId)) += issue
  }
}
