package models.street

import com.google.inject.ImplementedBy
import models.user.SidewalkUserTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.jdbc.GetResult

import java.time.{LocalDate, OffsetDateTime}
import javax.inject.{Inject, Singleton}

case class StreetEdgeIssue(
    streetEdgeIssueId: Int,
    streetEdgeId: Int,
    issue: StreetEdgeIssueType.Value,
    userId: String,
    ipAddress: String,
    timestamp: OffsetDateTime
)

/** Labeler reports of missing imagery during one week. */
case class NoImageryReportWeek(weekStart: LocalDate, reportCount: Int, streetCount: Int)

/** Labeler reports of missing imagery in one region over a window. */
case class NoImageryReportRegion(regionId: Int, regionName: String, reportCount: Int, streetCount: Int)

/**
 * A still-open street that several different labelers have reported as having no imagery.
 *
 * @param reporterCount  Distinct labelers who reported it, which is the number that makes a report corroborated
 *                       rather than one person's bad session.
 * @param lastReportedAt When it was most recently reported.
 */
case class CorroboratedNoImageryStreet(
    streetEdgeId: Int,
    regionId: Int,
    regionName: String,
    reporterCount: Int,
    reportCount: Int,
    lastReportedAt: OffsetDateTime
)

class StreetEdgeIssueTableDef(tag: Tag) extends Table[StreetEdgeIssue](tag, "street_edge_issue") {
  def streetEdgeIssueId: Rep[Int]           = column[Int]("street_edge_issue_id", O.PrimaryKey, O.AutoInc)
  def streetEdgeId: Rep[Int]                = column[Int]("street_edge_id")
  def issue: Rep[StreetEdgeIssueType.Value] = column[StreetEdgeIssueType.Value]("issue")
  def userId: Rep[String]                   = column[String]("user_id")
  def ipAddress: Rep[String]                = column[String]("ip_address")
  def timestamp: Rep[OffsetDateTime]        = column[OffsetDateTime]("timestamp")

  def * = (streetEdgeIssueId, streetEdgeId, issue, userId, ipAddress, timestamp) <> (
    (StreetEdgeIssue.apply _).tupled,
    StreetEdgeIssue.unapply
  )

  def streetEdge =
    foreignKey("street_edge_issue_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(_.streetEdgeId)
  def user = foreignKey("street_edge_issue_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
}

@ImplementedBy(classOf[StreetEdgeIssueTable])
trait StreetEdgeIssueTableRepository {}

@Singleton
class StreetEdgeIssueTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends StreetEdgeIssueTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  val streetEdgeIssues = TableQuery[StreetEdgeIssueTableDef]

  implicit private val getIssueWeek: GetResult[NoImageryReportWeek] =
    GetResult(r => NoImageryReportWeek(r.nextDate().toLocalDate, r.nextInt(), r.nextInt()))

  implicit private val getIssueRegion: GetResult[NoImageryReportRegion] =
    GetResult(r => NoImageryReportRegion(r.nextInt(), r.nextString(), r.nextInt(), r.nextInt()))

  implicit private val getCorroboratedStreet: GetResult[CorroboratedNoImageryStreet] = GetResult { r =>
    CorroboratedNoImageryStreet(r.nextInt(), r.nextInt(), r.nextString(), r.nextInt(), r.nextInt(),
      r.nextOffsetDateTime())
  }

  def insert(issue: StreetEdgeIssue): DBIO[Int] = {
    (streetEdgeIssues returning streetEdgeIssues.map(_.streetEdgeIssueId)) += issue
  }

  /**
   * Labeler reports of missing imagery, bucketed by ISO week (#4928).
   *
   * The leading indicator for streets about to be retired: a report is evidence for the offline imagery checker and
   * nothing else (#4922), so a region lighting up here is where the next `no_imagery` batch will come from. Distinct
   * streets is the number worth watching — the raw report count also moves when one street gets reported by several
   * labelers, which says more about traffic than about imagery.
   *
   * @param since Only reports at or after this instant.
   */
  def reportsByWeek(since: OffsetDateTime): DBIO[Seq[NoImageryReportWeek]] = {
    sql"""SELECT date_trunc('week', timestamp)::date, COUNT(*), COUNT(DISTINCT street_edge_id)
          FROM street_edge_issue
          WHERE issue = 'PanoNotAvailable'
              AND timestamp >= $since
          GROUP BY date_trunc('week', timestamp)::date
          ORDER BY date_trunc('week', timestamp)::date""".as[NoImageryReportWeek]
  }

  /**
   * The regions labelers are reporting missing imagery in most, worst first (#4928).
   *
   * @param since Only reports at or after this instant.
   * @param limit How many regions to return.
   */
  def topReportRegions(since: OffsetDateTime, limit: Int): DBIO[Seq[NoImageryReportRegion]] = {
    sql"""SELECT region.region_id, region.name, COUNT(*), COUNT(DISTINCT street_edge_issue.street_edge_id)
          FROM street_edge_issue
          JOIN street_edge_region ON street_edge_issue.street_edge_id = street_edge_region.street_edge_id
          JOIN region ON street_edge_region.region_id = region.region_id
          WHERE street_edge_issue.issue = 'PanoNotAvailable'
              AND street_edge_issue.timestamp >= $since
          GROUP BY region.region_id, region.name
          ORDER BY COUNT(DISTINCT street_edge_issue.street_edge_id) DESC, region.name
          LIMIT $limit""".as[NoImageryReportRegion]
  }

  /**
   * Still-open streets that several distinct labelers have reported as having no imagery (#4928).
   *
   * The queue the offline imagery checker should be pointed at: a report is evidence and never a verdict (#4922), so
   * a street only leaves the auditing pool once the checker confirms it — but a street several *different* people
   * independently found empty is the strongest evidence the app can offer without asking a provider, and it is
   * corroboration rather than volume that separates that from one labeler's bad session or a transient provider
   * outage. Restricted to `open` streets, since a street already retired needs no further evidence.
   *
   * @param since         Only reports at or after this instant.
   * @param minReporters  Distinct labelers a street needs before it appears.
   * @param limit         How many streets to return, worst first.
   */
  def corroboratedOpenStreets(
      since: OffsetDateTime,
      minReporters: Int,
      limit: Int
  ): DBIO[Seq[CorroboratedNoImageryStreet]] = {
    sql"""SELECT street_edge_issue.street_edge_id,
                 region.region_id,
                 region.name,
                 COUNT(DISTINCT street_edge_issue.user_id),
                 COUNT(*),
                 MAX(street_edge_issue.timestamp)
          FROM street_edge_issue
          JOIN street_edge ON street_edge_issue.street_edge_id = street_edge.street_edge_id
          JOIN street_edge_region ON street_edge_issue.street_edge_id = street_edge_region.street_edge_id
          JOIN region ON street_edge_region.region_id = region.region_id
          WHERE street_edge_issue.issue = 'PanoNotAvailable'
              AND street_edge_issue.timestamp >= $since
              AND street_edge.status = 'open'
          GROUP BY street_edge_issue.street_edge_id, region.region_id, region.name
          HAVING COUNT(DISTINCT street_edge_issue.user_id) >= $minReporters
          ORDER BY COUNT(DISTINCT street_edge_issue.user_id) DESC, MAX(street_edge_issue.timestamp) DESC
          LIMIT $limit""".as[CorroboratedNoImageryStreet]
  }
}
