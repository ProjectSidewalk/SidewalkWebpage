package models.audit

import java.sql.Timestamp
import java.util.{Calendar, Date}

import models.daos.slick.DBTableDefinitions.UserTable
import models.region.{RegionTable, RegionTypeTable}
import models.street.StreetEdgeTable
import models.utils.MyPostgresDriver.simple._
import org.joda.time.{DateTime, DateTimeZone}
import org.specs2.mutable._
import play.api.db.slick.DB
import play.api.test._
import play.api.test._
import play.api.test.Helpers._

import scala.slick.driver.JdbcDriver.backend.Database
import scala.slick.jdbc.{GetResult, StaticQuery => Q}


class AuditTaskInteractionSpec extends Specification  {

//  val appWithMemoryDatabase = FakeApplication(additionalConfiguration = inMemoryDatabase())



  "AuditTaskInteractionTable" should {
    val appWithMemoryDatabase = FakeApplication(additionalConfiguration = inMemoryDatabase(options = Map(
      "MODE" -> "PostgreSQL"
    )))

    "be able to insert" in new WithApplication(app = appWithMemoryDatabase){
      play.api.db.slick.DB.withSession { implicit session =>

        Q.updateNA("""CREATE SCHEMA IF NOT EXISTS "sidewalk";""").execute
        val auditTaskInteractions = TableQuery[AuditTaskInteractionTable]
        auditTaskInteractions.ddl.create

        val timestamp: Timestamp = new Timestamp(new DateTime(DateTimeZone.UTC).getMillis)
        val auditTaskInteraction = AuditTaskInteraction(1, 1, "TestAction", Some("TestPanoramaId"),
          Some(0.0f), Some(0.0f), Some(0.0f), Some(0.0f), Some(1), Some("TestNote"), Some(1), timestamp)

        auditTaskInteractions += auditTaskInteraction

        val length = auditTaskInteractions.list.size

        length shouldEqual 1
        auditTaskInteractions.delete
      }
    }
  }

  "`AuditTaskInteractionTable.selectAuditTaskInteractionsOfAUser` method" should {
    val appWithMemoryDatabase = FakeApplication(additionalConfiguration = inMemoryDatabase(options = Map(
      "MODE" -> "PostgreSQL"
    )))
    "be able to fetch interactions of a given user" in new WithApplication(app = appWithMemoryDatabase){
      play.api.db.slick.DB.withSession { implicit session =>

        Q.updateNA("""CREATE SCHEMA IF NOT EXISTS "sidewalk";""").execute
        val auditTaskInteractions = TableQuery[AuditTaskInteractionTable]
        val auditTasks = TableQuery[AuditTaskTable]
        val streetEdges = TableQuery[StreetEdgeTable]
        val regions = TableQuery[RegionTable]
        val regionTypes = TableQuery[RegionTypeTable]
        val users = TableQuery[UserTable]


        (users.ddl ++ regionTypes.ddl ++ regions.ddl ++ streetEdges.ddl ++ auditTasks.ddl ++ auditTaskInteractions.ddl).create

        val timestamp: Timestamp = new Timestamp(new DateTime(DateTimeZone.UTC).getMillis)
        val auditTaskInteraction = AuditTaskInteraction(1, 1, "TestAction", Some("TestPanoramaId"),
          Some(0.0f), Some(0.0f), Some(0.0f), Some(0.0f), Some(1), Some("TestNote"), Some(1), timestamp)

        // TODO. Complete if I have time. Not necessary for testing the logic for counting the number of labels in the last mission.
      }
    }
  }
}
