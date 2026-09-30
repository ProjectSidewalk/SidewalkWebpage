package models.api

import models.audit.AuditTaskInteractionTable
import models.cluster.ClusterTable
import models.label.LabelTable
import models.place.PlaceTable
import models.region.RegionTable
import models.street.{SidewalkPresenceTable, StreetEdgeTable}
import models.user.UserStatTable
import models.validation.LabelValidationTable
import models.utils.{LatLngBBox, SpatialQueryType}
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

import java.time.{LocalDate, OffsetDateTime}

/**
 * The public API's raw-SQL queries run with their filters set, and keep only what they ask for (#2756). Also covers
 * the other raw queries that take a value from outside the SQL, such as label metadata for a validator.
 *
 * The filter values are sent to Postgres as bound values, so a wrong cast or a miscounted value only shows up when a
 * query runs; compiling can't catch it. On a database with no matching rows (CI's) the row checks pass trivially, but
 * each query still has to run.
 */
class ApiFilterQueriesSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val labelTable: LabelTable                       = app.injector.instanceOf[LabelTable]
  private lazy val clusterTable: ClusterTable                   = app.injector.instanceOf[ClusterTable]
  private lazy val streetEdgeTable: StreetEdgeTable             = app.injector.instanceOf[StreetEdgeTable]
  private lazy val regionTable: RegionTable                     = app.injector.instanceOf[RegionTable]
  private lazy val placeTable: PlaceTable                       = app.injector.instanceOf[PlaceTable]
  private lazy val sidewalkPresenceTable: SidewalkPresenceTable = app.injector.instanceOf[SidewalkPresenceTable]
  private lazy val labelValidationTable: LabelValidationTable   = app.injector.instanceOf[LabelValidationTable]
  private lazy val userStatTable: UserStatTable                 = app.injector.instanceOf[UserStatTable]
  private lazy val interactionTable: AuditTaskInteractionTable  = app.injector.instanceOf[AuditTaskInteractionTable]

  // A name with a quote in it, which the queries once had to escape by hand.
  private val quotedName = "O'Brien Park"

  // The least-labeled region that has labels, so the filters have something to keep without the queries running long.
  private lazy val regionName: String = run(
    sql"""SELECT region.name
          FROM region
          INNER JOIN street_edge_region ON region.region_id = street_edge_region.region_id
          INNER JOIN label ON street_edge_region.street_edge_id = label.street_edge_id
          WHERE NOT region.deleted
          GROUP BY region.region_id, region.name
          ORDER BY COUNT(*), region.region_id
          LIMIT 1""".as[String].headOption
  ).getOrElse(quotedName)

  private val since: OffsetDateTime = OffsetDateTime.parse("2000-01-01T00:00:00Z")
  private val until: OffsetDateTime = OffsetDateTime.now()
  private val world: LatLngBBox     = LatLngBBox(minLat = -90, minLng = -180, maxLat = 90, maxLng = 180)

  "The rawLabels query" should {
    "keep only labels matching every filter" in {
      val labelTypes = Seq("CurbRamp", "Obstacle", "SurfaceProblem")
      val filters    = RawLabelFiltersForApi(
        labelTypes = Some(labelTypes),
        regionName = Some(regionName),
        severity = Some(SeverityFilterForApi(Set(1, 2, 3), includeNullSeverity = true)),
        validationStatuses = Some(RawLabelValidationStatus.values.toSet),
        startDate = Some(since),
        endDate = Some(until)
      )
      val labels = run(labelTable.getLabelDataWithFilters(filters))

      labels.foreach { label =>
        labelTypes must contain(label.labelType)
        label.regionName mustBe regionName
      }
    }

    "take a bounding box and severity range" in {
      val filters = RawLabelFiltersForApi(
        bbox = Some(world),
        minSeverity = Some(2),
        maxSeverity = Some(3),
        labelTypes = Some(Seq("Signal"))
      )
      run(labelTable.getLabelDataWithFilters(filters)).foreach(_.severity.forall(s => s >= 2 && s <= 3) mustBe true)
    }

    "find nothing for a region name with a quote in it" in {
      run(labelTable.getLabelDataWithFilters(RawLabelFiltersForApi(regionName = Some(quotedName)))) mustBe empty
    }

    "ignore a severity filter with nothing in it" in {
      val noSeverities = SeverityFilterForApi(Set.empty, includeNullSeverity = false)
      val filters      = RawLabelFiltersForApi(labelTypes = Some(Seq("Signal")), severity = Some(noSeverities))
      run(labelTable.getLabelDataWithFilters(filters)).size mustBe
        run(labelTable.getLabelDataWithFilters(RawLabelFiltersForApi(labelTypes = Some(Seq("Signal"))))).size
    }
  }

  "The labelClusters query" should {
    "keep only clusters matching every filter" in {
      val filters = LabelClusterFiltersForApi(
        labelTypes = Some(Seq("CurbRamp", "NoCurbRamp")),
        regionName = Some(regionName),
        minClusterSize = Some(2),
        minAvgImageCaptureDate = Some(since),
        minAvgLabelDate = Some(since),
        minSeverity = Some(1),
        maxSeverity = Some(3)
      )
      val clusters = run(clusterTable.getLabelClustersV3(filters))

      clusters.foreach { cluster =>
        Seq("CurbRamp", "NoCurbRamp") must contain(cluster.labelType)
        cluster.regionName mustBe regionName
        cluster.clusterSize must be >= 2
      }
    }

    "carry the same filters when it includes the raw labels" in {
      val filters =
        LabelClusterFiltersForApi(bbox = Some(world), labelTypes = Some(Seq("Signal")), includeRawLabels = true)
      run(clusterTable.getLabelClustersV3(filters)).foreach(_.labelType mustBe "Signal")
    }

    "find nothing for a region name with a quote in it" in {
      run(clusterTable.getLabelClustersV3(LabelClusterFiltersForApi(regionName = Some(quotedName)))) mustBe empty
    }
  }

  "The streets query" should {
    "keep only streets matching every filter" in {
      val filters = StreetFiltersForApi(regionName = Some(regionName.toUpperCase), wayTypes = Some(Seq("residential")),
        statuses = Some(Seq("open")), minLabelCount = Some(1), minAuditCount = Some(1), minUserCount = Some(1))
      val streets = run(streetEdgeTable.getStreetsForApi(filters))

      streets.foreach { street =>
        street.regionName mustBe regionName
        street.wayType mustBe "residential"
        street.status mustBe "open"
        street.labelCount must be >= 1
      }
    }

    "find nothing for a region name with a quote in it" in {
      run(streetEdgeTable.getStreetsForApi(StreetFiltersForApi(regionName = Some(quotedName)))) mustBe empty
    }
  }

  "The regions query" should {
    "keep only the region asked for" in {
      val filters = RegionFiltersForApi(bbox = Some(world), regionName = Some(regionName), minLabelCount = Some(1))
      run(regionTable.getRegionsForApi(filters)).foreach(_.name mustBe regionName)
    }

    "find nothing for a region name with a quote in it" in {
      run(regionTable.getRegionsForApi(RegionFiltersForApi(regionName = Some(quotedName)))) mustBe empty
    }
  }

  "The places query" should {
    "keep only places matching every filter" in {
      val filters =
        PlaceFiltersForApi(bbox = Some(world), regionName = Some(regionName), categories = Some(Seq("school")))
      run(placeTable.getPlacesForApi(filters)).foreach { place =>
        place.category mustBe "school"
        place.regionName mustBe Some(regionName)
      }
    }

    "find nothing for a region name with a quote in it" in {
      run(placeTable.getPlacesForApi(PlaceFiltersForApi(regionName = Some(quotedName)))) mustBe empty
    }
  }

  "The sidewalkPresence query" should {
    "keep only block faces matching every filter" in {
      val filters = SidewalkPresenceFiltersForApi(
        bbox = Some(world),
        regionName = Some(regionName),
        presence = Some(Seq("absent", "present")),
        statuses = Some(Seq("open")),
        wayTypes = Some(Seq("residential")),
        minNoSidewalkLabels = Some(0),
        minValidatedNoSidewalkLabels = Some(0),
        minAuditCount = Some(1)
      )
      run(sidewalkPresenceTable.getSidewalkPresenceForApi(filters)).foreach { face =>
        face.regionName mustBe regionName
        Seq("absent", "present") must contain(face.presence)
        face.status mustBe "open"
        face.wayType mustBe "residential"
        face.auditCount must be >= 1
      }
    }

    "find nothing for a region name with a quote in it" in {
      run(
        sidewalkPresenceTable.getSidewalkPresenceForApi(SidewalkPresenceFiltersForApi(regionName = Some(quotedName)))
      ) mustBe empty
    }
  }

  "The label metadata query" should {
    "show a validator their own vote and whether they placed the label" in {
      // A vote on a label the query returns, cast under the label's current type (a vote under an old type is hidden).
      val shownLabelIds: Seq[Int] = run(labelTable.getRecentLabelsMetadata(200)).map(_.labelId)
      val vote                    = run(sql"""SELECT label_validation.label_id, label_validation.user_id, label.user_id
                           FROM label_validation
                           INNER JOIN label ON label_validation.label_id = label.label_id
                           WHERE label_validation.label_id = ANY($shownLabelIds)
                               AND label_validation.label_type = label.label_type
                           ORDER BY label_validation.label_validation_id
                           LIMIT 1""".as[(Int, String, String)].headOption)
      vote.foreach { case (labelId, validatorId, labelerId) =>
        val asValidator = run(labelTable.getRecentLabelsMetadata(1, Some(validatorId), Some(labelId))).head
        asValidator.userValidation mustBe defined
        asValidator.fromCurrentUser mustBe (validatorId == labelerId)

        val asLabeler = run(labelTable.getRecentLabelsMetadata(1, Some(labelerId), Some(labelId))).head
        asLabeler.fromCurrentUser mustBe true
      }
    }

    "show no vote and no ownership without a validator" in {
      run(labelTable.getRecentLabelsMetadata(5)).foreach { label =>
        label.userValidation mustBe None
        label.fromCurrentUser mustBe false
      }
    }
  }

  "The daily stats queries" should {
    "keep only the days asked for" in {
      // Days are bucketed in Pacific time but the bounds compare in the database's time zone, so allow a day each side.
      val (from, to)              = (LocalDate.parse("2020-01-01"), LocalDate.now())
      def inRange(day: LocalDate) = !day.isBefore(from.minusDays(1)) && !day.isAfter(to.plusDays(1))
      run(labelTable.getDailyLabelStats(Some(from), Some(to), filterLowQuality = false)).foreach(row =>
        inRange(row._1) mustBe true
      )
      run(labelValidationTable.getDailyValidationStats(Some(from), Some(to), filterLowQuality = true)).foreach(row =>
        inRange(row._1) mustBe true
      )
    }
  }

  "The per-user recounts" should {
    "take a list of user ids, including one with a quote in it" in {
      val someUser = run(sql"SELECT user_id FROM user_stat ORDER BY user_id LIMIT 1".as[String].headOption)
      runRolledBack(userStatTable.updateAccuracy(someUser.toSeq :+ quotedName)) mustBe (())
      someUser.foreach(user => run(interactionTable.secondsSpentAuditing(user, 1, until)) must be >= 0d)
    }
  }

  "The access-score cluster query" should {
    "keep only the scored label types" in {
      val rows = run(clusterTable.getClusterScoreRows(SpatialQueryType.Street, world, Set("CurbRamp", "Obstacle")))
      rows.foreach(row => Seq("CurbRamp", "Obstacle") must contain(row.labelType))
    }

    "find nothing when no label type is scored" in {
      run(clusterTable.getClusterScoreRows(SpatialQueryType.Street, world, Set.empty)) mustBe empty
    }
  }
}
