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
        val sqlStart = run(sql"""SELECT MIN(t) FROM (VALUES
                                   (NOW() - INTERVAL '30 days'), (date_trunc('day', NOW() AT TIME ZONE 'US/Pacific')
                                   AT TIME ZONE 'US/Pacific'), (NOW() - INTERVAL '7 days'), (NOW())
                                 ) AS moments(t)
                                 WHERE #${TimeInterval.sqlFilter(interval, "t")}""".as[OffsetDateTime].head)
        val scalaStart = TimeInterval.start(interval).get
        // The two clocks read a moment apart, so allow a few seconds.
        math.abs(java.time.Duration.between(sqlStart, scalaStart).getSeconds) must be <= 5L
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
