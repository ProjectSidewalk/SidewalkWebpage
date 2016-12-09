package models.labels


import java.sql.Timestamp
import java.util.{Calendar, Date}

import models.audit.{AuditTaskInteraction, AuditTaskInteractionTable, AuditTaskTable}
import models.daos.slick.DBTableDefinitions.UserTable
import models.label.{Label, LabelTable, LabelTypeTable}
import models.region.{RegionTable, RegionTypeTable}
import models.street.StreetEdgeTable
import models.utils.MyPostgresDriver.simple._
import org.joda.time.{DateTime, DateTimeZone}
import org.specs2.mutable._
import play.api.db.slick.DB
import play.api.test._
import play.api.test._
import play.api.test.Helpers._

import scala.slick.jdbc.{GetResult, StaticQuery => Q}


class LabelTableSpec extends Specification  {

  "LabelTable" should {
    val appWithMemoryDatabase = FakeApplication(additionalConfiguration = inMemoryDatabase(options = Map("MODE" -> "PostgreSQL")))

    "be able to insert" in new WithApplication(app = appWithMemoryDatabase){
      play.api.db.slick.DB.withSession { implicit session =>

        Q.updateNA("""CREATE SCHEMA IF NOT EXISTS "sidewalk";""").execute
        val users = TableQuery[UserTable]
        val streetEdges = TableQuery[StreetEdgeTable]
        val auditTasks = TableQuery[AuditTaskTable]
        val labelTypes = TableQuery[LabelTypeTable]
        val labels = TableQuery[LabelTable]

        (users.ddl ++ streetEdges.ddl ++ auditTasks.ddl ++ labelTypes.ddl ++ labels.ddl).create

        //labels += Label(1, 1, "TestPanoramaId1", 1, 0.0f, 0.0f, 0.0f, 0.0f, deleted=false, Some(1))
        //labels += Label(2, 1, "TestPanoramaId2", 2, 0.0f, 0.0f, 0.0f, 0.0f, deleted=false, Some(2))
        //labels += Label(3, 1, "TestPanoramaId3", 1, 0.0f, 0.0f, 0.0f, 0.0f, deleted=false, Some(3))

        //val length = labels.list.size

        //length shouldEqual 3
        labels.delete
      }
    }

    "be able to retrieve labels from the first mission " in new WithApplication(app = appWithMemoryDatabase) {
//      play.api.db.slick.DB.withSession { implicit session =>
//
//        Q.updateNA("""CREATE SCHEMA IF NOT EXISTS "sidewalk";""").execute
//        val users = TableQuery[UserTable]
//        val streetEdges = TableQuery[StreetEdgeTable]
//        val auditTasks = TableQuery[AuditTaskTable]
//        val labelTypes = TableQuery[LabelTypeTable]
//        val labels = TableQuery[LabelTable]
//        (users.ddl ++ streetEdges.ddl ++ auditTasks.ddl ++ labelTypes.ddl ++ labels.ddl).create
//
//        labels += Label(1, 1, "TestPanoramaId1", 1, 0.0f, 0.0f, 0.0f, 0.0f, deleted=false, Some(1))
//        labels += Label(2, 1, "TestPanoramaId2", 2, 0.0f, 0.0f, 0.0f, 0.0f, deleted=false, Some(2))
//        labels += Label(3, 1, "TestPanoramaId3", 1, 0.0f, 0.0f, 0.0f, 0.0f, deleted=false, Some(3))
//
//        val length = labels.list.size
//
//        length shouldEqual 3
//        labels.delete
//      }
    }
  }

}
