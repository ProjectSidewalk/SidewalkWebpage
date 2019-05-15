package models.labels


import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

import com.vividsolutions.jts.geom.{Coordinate, GeometryFactory}
import models.audit.{AuditTask, AuditTaskInteraction, AuditTaskInteractionTable, AuditTaskTable}
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.{Label, LabelTable, LabelType, LabelTypeTable}
import models.region.{Region, RegionTable, RegionType, RegionTypeTable}
import models.street.{StreetEdge, StreetEdgeTable}
import models.utils.MyPostgresDriver.simple._
import org.specs2.mutable._
import play.api.db.slick.DB
import play.api.Logger._
import play.api.test._
import play.api.test.Helpers._

import scala.slick.jdbc.{GetResult, StaticQuery => Q}


class LabelTableSpec extends Specification  {

  "LabelTable" should {

    "be able to fetch labels from the current mission" in new WithApplication(app = FakeApplication()) {
      play.api.db.slick.DB.withSession { implicit session =>

        Q.updateNA("""CREATE SCHEMA IF NOT EXISTS "sidewalk";""").execute
        lazy val auditTaskInteractions = TableQuery[AuditTaskInteractionTable]
        lazy val auditTasks = TableQuery[AuditTaskTable]
        lazy val streetEdges = TableQuery[StreetEdgeTable]
        lazy val regions = TableQuery[RegionTable]
        lazy val regionTypes = TableQuery[RegionTypeTable]
        lazy val users = TableQuery[UserTable]
        lazy val labelTypes = TableQuery[LabelTypeTable]
        lazy val labels = TableQuery[LabelTable]

        lazy val ddl = users.ddl ++
          regionTypes.ddl ++
          regions.ddl ++
          streetEdges.ddl ++
          auditTasks.ddl ++
          auditTaskInteractions.ddl ++
          labelTypes.ddl ++
          labels.ddl

        ddl.create

        try {
          // Prepare data to populate the database
          lazy val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

          lazy val gf: GeometryFactory = new GeometryFactory()
          lazy val coordinates_1: Array[Coordinate] = Array(new Coordinate(0, 0), new Coordinate(0.5, 0))
          lazy val coordinates_2: Array[Coordinate] = Array(new Coordinate(0.5, 0), new Coordinate(1, 0))
          lazy val streetGeom_1 = gf.createLineString(coordinates_1)
          lazy val streetGeom_2 = gf.createLineString(coordinates_2)

          lazy val polyCoordinates_1 = Array(new Coordinate(1, 1), new Coordinate(-1, 1), new Coordinate(-1, -1), new Coordinate(1, -1), new Coordinate(1, 1))
          lazy val polyCoordinates_2 = Array(new Coordinate(101, 1), new Coordinate(99, 1), new Coordinate(99, -1), new Coordinate(101, -1), new Coordinate(101, 1))
          lazy val regionGeom_1 = gf.createPolygon(polyCoordinates_1)
          lazy val regionGeom_2 = gf.createPolygon(polyCoordinates_2)


          lazy val uuid = UUID.fromString("123e4567-e89b-12d3-a456-426655440000")
          lazy val user = DBUser(uuid.toString, "TestUserName", "TestUser@email.com")
          lazy val streetEdge_1 = StreetEdge(1, streetGeom_1, 0, 1, 0.0f, 0.0f, 1.0f, 0.0f, "primary", deleted = false, Some(timestamp))
          lazy val streetEdge_2 = StreetEdge(2, streetGeom_2, 2, 3, 100.0f, 0.0f, 101.0f, 0.0f, "primary", deleted = false, Some(timestamp))

          lazy val task_1 = AuditTask(1, None, uuid.toString, 1, timestamp, Some(timestamp), completed = true)
          lazy val task_2 = AuditTask(2, None, uuid.toString, 2, timestamp, Some(timestamp), completed = true)

          lazy val auditTaskInteraction_1 = AuditTaskInteraction(1, 1, "LabelingCanvas_FinishLabeling", Some("TestPanoramaId1"),
            Some(0.0f), Some(0.0f), Some(0.0f), Some(0.0f), Some(1), Some("TestNote"), Some(1), timestamp)
          lazy val auditTaskInteraction_2 = AuditTaskInteraction(2, 1, "LabelingCanvas_FinishLabeling", Some("TestPanoramaId2"),
            Some(0.0f), Some(0.0f), Some(0.0f), Some(0.0f), Some(1), Some("TestNote"), Some(2), timestamp)
          lazy val auditTaskInteraction_3 = AuditTaskInteraction(3, 1, "MissionComplete", Some("TestPanoramaId2"),
            Some(0.0f), Some(0.0f), Some(0.0f), Some(0.0f), Some(1), Some("TestNote"), None, timestamp)
          lazy val auditTaskInteraction_4 = AuditTaskInteraction(4, 2, "LabelingCanvas_FinishLabeling", Some("TestPanoramaId2"),
            Some(0.0f), Some(0.0f), Some(0.0f), Some(0.0f), Some(1), Some("TestNote"), Some(3), timestamp)

          lazy val label1 = Label(1, 1, "TestPanoramaId1", 1, 0.0f, 0.0f, 0.0f, 0.0f, deleted = false, Some(1))
          lazy val label2 = Label(2, 1, "TestPanoramaId2", 2, 0.0f, 0.0f, 0.0f, 0.0f, deleted = false, Some(2))
          lazy val label3 = Label(3, 2, "TestPanoramaId3", 1, 0.0f, 0.0f, 0.0f, 0.0f, deleted = false, Some(3))

          // Insert data
          regionTypes ++= Seq(
            RegionType(1, "city"),
            RegionType(2, "neighborhood")
          )

          regions ++= Seq(
            Region(1, 2, "TestDataSource", "TestRegion1", regionGeom_1, deleted = false),
            Region(2, 2, "TestDataSource", "TestRegion2", regionGeom_2, deleted = false)
          )

          users += user
          streetEdges ++= Seq(streetEdge_1, streetEdge_2)
          auditTasks ++= Seq(task_1, task_2)

          labelTypes ++= Seq(
            LabelType(1, "CurbRamp", "Curb Ramp"),
            LabelType(2, "NoCurbRamp", "No Curb Ramp")
          )

          labels ++= Seq(label1, label2, label3)

          lazy val interactions = Seq(
            auditTaskInteraction_1,
            auditTaskInteraction_2,
            auditTaskInteraction_3,
            auditTaskInteraction_4
          )
          auditTaskInteractions ++= interactions

          lazy val fetchedLabels = LabelTable.getLabelsFromCurrentAuditMission(1, uuid)

          fetchedLabels.length shouldEqual 1
          fetchedLabels.head shouldEqual label3

        } finally {
          ddl.drop
        }
      }
    }
  }

  "`LabelTable.selectLabelsByInteractions`" should {
    "be able to retrieve labels" in new WithApplication(app = FakeApplication()) {

      play.api.db.slick.DB.withSession { implicit session =>

        Q.updateNA("""CREATE SCHEMA IF NOT EXISTS "sidewalk";""").execute
        lazy val auditTaskInteractions = TableQuery[AuditTaskInteractionTable]
        lazy val auditTasks = TableQuery[AuditTaskTable]
        lazy val streetEdges = TableQuery[StreetEdgeTable]
        lazy val regions = TableQuery[RegionTable]
        lazy val regionTypes = TableQuery[RegionTypeTable]
        lazy val users = TableQuery[UserTable]
        lazy val labelTypes = TableQuery[LabelTypeTable]
        lazy val labels = TableQuery[LabelTable]

        lazy val ddl = users.ddl ++
          regionTypes.ddl ++
          regions.ddl ++
          streetEdges.ddl ++
          auditTasks.ddl ++
          auditTaskInteractions.ddl ++
          labelTypes.ddl ++
          labels.ddl

        ddl.create

        try {
          // Prepare data to populate the database
          lazy val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

          lazy val gf: GeometryFactory = new GeometryFactory()
          lazy val coordinates_1: Array[Coordinate] = Array(new Coordinate(0, 0), new Coordinate(0.5, 0))
          lazy val coordinates_2: Array[Coordinate] = Array(new Coordinate(0.5, 0), new Coordinate(1, 0))
          lazy val streetGeom_1 = gf.createLineString(coordinates_1)
          lazy val streetGeom_2 = gf.createLineString(coordinates_2)

          lazy val polyCoordinates_1 = Array(new Coordinate(1, 1), new Coordinate(-1, 1), new Coordinate(-1, -1), new Coordinate(1, -1), new Coordinate(1, 1))
          lazy val polyCoordinates_2 = Array(new Coordinate(101, 1), new Coordinate(99, 1), new Coordinate(99, -1), new Coordinate(101, -1), new Coordinate(101, 1))
          lazy val regionGeom_1 = gf.createPolygon(polyCoordinates_1)
          lazy val regionGeom_2 = gf.createPolygon(polyCoordinates_2)


          lazy val uuid = UUID.fromString("123e4567-e89b-12d3-a456-426655440000")
          lazy val user = DBUser(uuid.toString, "TestUserName", "TestUser@email.com")
          lazy val streetEdge_1 = StreetEdge(1, streetGeom_1, 0, 1, 0.0f, 0.0f, 1.0f, 0.0f, "primary", deleted = false, Some(timestamp))
          lazy val streetEdge_2 = StreetEdge(2, streetGeom_2, 2, 3, 100.0f, 0.0f, 101.0f, 0.0f, "primary", deleted = false, Some(timestamp))

          lazy val task_1 = AuditTask(1, None, uuid.toString, 1, timestamp, Some(timestamp), completed = true)
          lazy val task_2 = AuditTask(2, None, uuid.toString, 2, timestamp, Some(timestamp), completed = true)

          lazy val auditTaskInteraction_1 = AuditTaskInteraction(1, 1, "LabelingCanvas_FinishLabeling", Some("TestPanoramaId1"),
            Some(0.0f), Some(0.0f), Some(0.0f), Some(0.0f), Some(1), Some("TestNote"), Some(1), timestamp)
          lazy val auditTaskInteraction_2 = AuditTaskInteraction(2, 1, "LabelingCanvas_FinishLabeling", Some("TestPanoramaId2"),
            Some(0.0f), Some(0.0f), Some(0.0f), Some(0.0f), Some(1), Some("TestNote"), Some(2), timestamp)
//          lazy val auditTaskInteraction_3 = AuditTaskInteraction(3, 1, "MissionComplete", Some("TestPanoramaId2"),
//            Some(0.0f), Some(0.0f), Some(0.0f), Some(0.0f), Some(1), Some("TestNote"), None, timestamp)
          lazy val auditTaskInteraction_4 = AuditTaskInteraction(4, 2, "LabelingCanvas_FinishLabeling", Some("TestPanoramaId2"),
            Some(0.0f), Some(0.0f), Some(0.0f), Some(0.0f), Some(1), Some("TestNote"), Some(3), timestamp)

          lazy val label1 = Label(1, 1, "TestPanoramaId1", 1, 0.0f, 0.0f, 0.0f, 0.0f, deleted = false, Some(1))
          lazy val label2 = Label(2, 1, "TestPanoramaId2", 2, 0.0f, 0.0f, 0.0f, 0.0f, deleted = false, Some(2))
          lazy val label3 = Label(3, 2, "TestPanoramaId3", 1, 0.0f, 0.0f, 0.0f, 0.0f, deleted = false, Some(3))

          // Insert data
          regionTypes ++= Seq(
            RegionType(1, "city"),
            RegionType(2, "neighborhood")
          )

          regions ++= Seq(
            Region(1, 2, "TestDataSource", "TestRegion1", regionGeom_1, deleted = false),
            Region(2, 2, "TestDataSource", "TestRegion2", regionGeom_2, deleted = false)
          )

          users += user
          streetEdges ++= Seq(streetEdge_1, streetEdge_2)
          auditTasks ++= Seq(task_1, task_2)

          labelTypes ++= Seq(
            LabelType(1, "CurbRamp", "Curb Ramp"),
            LabelType(2, "NoCurbRamp", "No Curb Ramp")
          )

          labels ++= Seq(label1, label2, label3)

          lazy val interactions = Seq(
            auditTaskInteraction_1,
            auditTaskInteraction_2,
//            auditTaskInteraction_3,
            auditTaskInteraction_4
          )
          auditTaskInteractions ++= interactions

          lazy val fetchedLabels = LabelControllerHelper._helpGetLabelsFromCurrentMission(1, uuid)

          fetchedLabels.length shouldEqual 3
          fetchedLabels.head shouldEqual label1

        } finally {
          ddl.drop
        }
      }
    }
  }

}
