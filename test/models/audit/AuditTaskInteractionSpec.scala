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

  "`AuditTaskInteractionTable.selectAuditTaskInteractionsOfAUser` method" should {
    "be able to fetch interactions of a given user" in new WithApplication(app = FakeApplication()) {
      play.api.db.slick.DB.withSession { implicit session =>

        // Create tables
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
          // Populate data
          lazy val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
          lazy val auditTaskInteraction = AuditTaskInteraction(1, 1, "TestAction", Some("TestPanoramaId"),
            Some(0.0f), Some(0.0f), Some(0.0f), Some(0.0f), Some(1), Some("TestNote"), Some(1), timestamp)

          lazy val gf: GeometryFactory = new GeometryFactory()
          lazy val coordinates: Array[Coordinate] = Array(new Coordinate(0, 0), new Coordinate(1, 0))
          lazy val streetGeom = gf.createLineString(coordinates)

          lazy val uuid = UUID.fromString("123e4567-e89b-12d3-a456-426655440000")
          lazy val user = DBUser(uuid.toString, "TestUserName", "TestUser@email.com")
          lazy val streetEdge = StreetEdge(1, streetGeom, 0, 1, 0.0f, 0.0f, 1.0f, 0.0f, "primary", deleted = false, Some(timestamp))
          lazy val task = AuditTask(1, None, uuid.toString, 1, timestamp, Some(timestamp), completed = true)

          users += user
          streetEdges += streetEdge
          auditTasks += task

          auditTaskInteractions += auditTaskInteraction

          lazy val fetched = AuditTaskInteractionTable.selectAuditTaskInteractionsOfAUser(uuid)

          fetched.length shouldEqual 1
          fetched.head shouldEqual auditTaskInteraction
        } finally {
          ddl.drop
        }
      }
    }
  }

  "`AuditTaskInteractionTable.selectAuditTaskInteractionsOfAUser` method" should {
    "be able to fetch interactions of a given user at the given region" in new WithApplication(
      app = FakeApplication()
//      app = FakeApplication(withoutPlugins = Seq("play.api.db.BoneCPPlugin"), additionalPlugins = Seq("model.audit.MyBoneCPPlugin"))
    ){
      // Variables have to be `lazy` to prevent "obtain a connection from a pool that has already been shutdown" error
      // https://github.com/playframework/playframework/issues/3867
      // https://groups.google.com/forum/#!msg/play-framework/znFuqeRz84w/k39KMfuNhcEJ
      // https://groups.google.com/forum/#!msg/play-framework/znFuqeRz84w/k39KMfuNhcEJ
      // Doesn't work.
      // TODO. Ok, doesn't work... Need to run test one by one. Otherwise the SQLException stops the tests

      lazy val database = play.api.db.slick.DB
//      implicit lazy val session = database.createSession()
      database.withSession { implicit session =>

        // Create tables
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
          // Populate data
          lazy val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

          lazy val gf: GeometryFactory = new GeometryFactory()
          lazy val coordinates_1: Array[Coordinate] = Array(new Coordinate(0, 0), new Coordinate(1, 0))
          lazy val coordinates_2: Array[Coordinate] = Array(new Coordinate(100, 0), new Coordinate(101, 0))
          lazy val streetGeom_1 = gf.createLineString(coordinates_1)
          lazy val streetGeom_2 = gf.createLineString(coordinates_2)

          lazy val polyCoordinates_1 = Array(new Coordinate(1, 1), new Coordinate(-1, 1), new Coordinate(-1, -1), new Coordinate(1, -1), new Coordinate(1, 1))
          lazy val polyCoordinates_2 = Array(new Coordinate(101, 1), new Coordinate(99, 1), new Coordinate(99, -1), new Coordinate(101, -1), new Coordinate(101, 1))
          lazy val regionGeom_1 = gf.createPolygon(polyCoordinates_1)
          lazy val regionGeom_2 = gf.createPolygon(polyCoordinates_2)

          regionTypes ++= Seq(
            RegionType(1, "city"),
            RegionType(2, "neighborhood")
          )

          regions ++= Seq(
            Region(1, 2, "TestDataSource", "TestRegion1", regionGeom_1, deleted = false),
            Region(2, 2, "TestDataSource", "TestRegion2", regionGeom_2, deleted = false)
          )

          lazy val uuid = UUID.fromString("123e4567-e89b-12d3-a456-426655440000")
          lazy val user = DBUser(uuid.toString, "TestUserName", "TestUser@email.com")
          lazy val streetEdge_1 = StreetEdge(1, streetGeom_1, 0, 1, 0.0f, 0.0f, 1.0f, 0.0f, "primary", deleted = false, Some(timestamp))
          lazy val streetEdge_2 = StreetEdge(2, streetGeom_2, 2, 3, 100.0f, 0.0f, 101.0f, 0.0f, "primary", deleted = false, Some(timestamp))

          lazy val task_1 = AuditTask(1, None, uuid.toString, 1, timestamp, Some(timestamp), completed = true)
          lazy val task_2 = AuditTask(2, None, uuid.toString, 2, timestamp, Some(timestamp), completed = true)

          lazy val auditTaskInteraction_1 = AuditTaskInteraction(1, 1, "LabelingCanvas_FinishLabeling", Some("TestPanoramaId1"),
            Some(0.0f), Some(0.0f), Some(0.0f), Some(0.0f), Some(1), Some("TestNote"), Some(1), timestamp)
          lazy val auditTaskInteraction_2 = AuditTaskInteraction(2, 2, "LabelingCanvas_FinishLabeling", Some("TestPanoramaId2"),
            Some(0.0f), Some(0.0f), Some(0.0f), Some(0.0f), Some(1), Some("TestNote"), Some(2), timestamp)

          users += user
          streetEdges ++= Seq(streetEdge_1, streetEdge_2)
          auditTasks ++= Seq(task_1, task_2)

          auditTaskInteractions ++= Seq(auditTaskInteraction_1, auditTaskInteraction_2)
        } finally {
          ddl.drop
        }
      }

    }
  }
}
