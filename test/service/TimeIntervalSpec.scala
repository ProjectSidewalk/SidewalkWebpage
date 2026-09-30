package service

import models.audit.{AuditTaskInteractionTable, AuditTaskTable}
import models.label.LabelTable
import models.user.UserStatTable
import models.utils.MyPostgresProfile.api._
import models.validation.LabelValidationTable
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

import java.time.OffsetDateTime
import java.time.temporal.ChronoUnit

/**
 * The admin page's today/week/all-time windows. [[TimeInterval.start]] and [[TimeInterval.sqlFilter]] say the same
 * thing in two places (Scala and SQL), so this checks they agree, and runs every query that uses them.
 */
class TimeIntervalSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val labelTable: LabelTable                               = app.injector.instanceOf[LabelTable]
  private lazy val labelValidationTable: LabelValidationTable           = app.injector.instanceOf[LabelValidationTable]
  private lazy val auditTaskTable: AuditTaskTable                       = app.injector.instanceOf[AuditTaskTable]
  private lazy val auditTaskInteractionTable: AuditTaskInteractionTable =
    app.injector.instanceOf[AuditTaskInteractionTable]
  private lazy val userStatTable: UserStatTable = app.injector.instanceOf[UserStatTable]

  private val narrowestFirst = Seq(TimeInterval.Today, TimeInterval.Week, TimeInterval.AllTime)

  "TimeInterval" should {
    "start each window at the same moment in Scala and in SQL" in {
      Seq(TimeInterval.Today, TimeInterval.Week).foreach { interval =>
        // A minute either side of the Scala start: the SQL filter must drop the first and keep the second.
        val start           = TimeInterval.start(interval).get.truncatedTo(ChronoUnit.SECONDS)
        val (before, after) = (start.minusMinutes(1), start.plusMinutes(1))
        val kept            = run(sql"""SELECT t FROM (VALUES ($before::timestamptz), ($after::timestamptz)) AS moments(t)
                               WHERE #${TimeInterval.sqlFilter(interval, "t")}""".as[OffsetDateTime])
        kept.map(_.toInstant) mustBe Seq(after.toInstant)
      }
      TimeInterval.start(TimeInterval.AllTime) mustBe None
      TimeInterval.sqlFilter(TimeInterval.AllTime, "t") mustBe "TRUE"
    }

    "never count more in a narrower window" in {
      val labels = narrowestFirst.map(i => run(labelTable.countLabelsByType(i)).map(_.count).sum)
      val votes  =
        narrowestFirst.map(i => run(labelValidationTable.countValidationsByResultAndLabelType(i)).map(_.count).sum)
      val audits = narrowestFirst.map(i => run(auditTaskTable.countCompletedAudits(i)))
      val hours  = narrowestFirst.map(i => run(auditTaskInteractionTable.calculateTimeValidating(i)).time.getOrElse(0d))
      Seq(labels, votes, audits).foreach(counts => counts mustBe counts.sorted)
      hours mustBe hours.sorted

      narrowestFirst.foreach { interval =>
        run(auditTaskInteractionTable.calculateTimeExploring(interval)).timeInterval mustBe interval
        run(auditTaskInteractionTable.calculateMedianExploringTime(interval)).timeInterval mustBe interval
      }
      run(userStatTable.countAllUsersContributed()).count must be >= 0
    }
  }
}
