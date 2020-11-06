package models.audit

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

import com.vividsolutions.jts.geom.{Coordinate, GeometryFactory, LineString, Polygon}
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.{Label, LabelTable, LabelType, LabelTypeTable}
import models.region.{Region, RegionTable, RegionType, RegionTypeTable}
import models.street.{StreetEdge, StreetEdgeTable}
import models.utils.MyPostgresDriver.simple._
import org.specs2.mutable._
import play.api.db.slick.DB
import play.api.test._
import play.api.test._
import play.api.test.Helpers._
import play.api.Play.current
import play.api.db.BoneCPPlugin

import scala.slick.driver.JdbcDriver.backend.Database
import scala.slick.jdbc.{GetResult, StaticQuery => Q}

class AuditTaskInteractionSpec extends Specification  {

//  val appWithMemoryDatabase = FakeApplication(additionalConfiguration = inMemoryDatabase())



  "AuditTaskInteractionTable" should {
    "be able to insert" in new WithApplication(app = FakeApplication()){
      play.api.db.slick.DB.withSession { implicit session =>

        Q.updateNA("""CREATE SCHEMA IF NOT EXISTS "sidewalk";""").execute
        lazy val auditTaskInteractions = TableQuery[AuditTaskInteractionTable]
        lazy val ddl = auditTaskInteractions.ddl
        ddl.create

        try {
          lazy val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
          lazy val auditTaskInteraction = AuditTaskInteraction(1, 1, "TestAction", Some("TestPanoramaId"),
            Some(0.0f), Some(0.0f), Some(0.0f), Some(0.0f), Some(1), Some("TestNote"), Some(1), timestamp)

          auditTaskInteractions += auditTaskInteraction

          lazy val length = auditTaskInteractions.length.run

          length shouldEqual 1
        } finally {
          ddl.drop
        }
      }
    }
  }
}
