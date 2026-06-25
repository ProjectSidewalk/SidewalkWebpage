package service

import com.google.inject.ImplementedBy
import formats.json.ClusterFormats.{ClusterSubmission, ClusteredLabelSubmission}
import models.api.{DailyStatRecord, _}
import models.cluster._
import models.label._
import models.region.{Region, RegionTable}
import models.street.{StreetEdgeInfo, StreetEdgeTable}
import models.user.UserStatTable
import models.utils.MyPostgresProfile.api._
import models.utils.SpatialQueryType.SpatialQueryType
import models.utils.{ClusteringThreshold, LatLngBBox, MyPostgresProfile}
import models.validation.LabelValidationTable
import org.apache.pekko.stream.scaladsl.Source
import org.geotools.geometry.jts.JTSFactoryFinder
import org.locationtech.jts.geom.{Coordinate, GeometryFactory}
import play.api.Configuration
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.i18n.{Lang, MessagesApi}
import slick.sql.SqlStreamingAction

import java.time.{LocalDate, OffsetDateTime}
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

@ImplementedBy(classOf[ApiServiceImpl])
trait ApiService {

  def selectStreetsIntersecting(spatialQueryType: SpatialQueryType, bbox: LatLngBBox): Future[Seq[StreetEdgeInfo]]

  def getNeighborhoodsWithin(bbox: LatLngBBox): Future[Seq[Region]]

  /** Streams lean per-cluster scoring inputs for the v3 AccessScore endpoints (#3855). */
  def getClusterScoreRows(
      spatialQueryType: SpatialQueryType,
      bbox: LatLngBBox,
      labelTypes: Set[String],
      batchSize: Int
  ): Source[ClusterScoreRow, _]

  /** Returns the length in meters of each given street edge, used to length-weight region AccessScores (#3855). */
  def getStreetLengths(streetEdgeIds: Seq[Int]): Future[Map[Int, Double]]

  /** Resolves a region id to its bounding box, or None if no such (non-deleted) region exists. */
  def getRegionBBox(regionId: Int): Future[Option[LatLngBBox]]

  /** Resolves a region name to its (region id, bounding box), or None if no such (non-deleted) region exists. */
  def resolveRegionByName(regionName: String): Future[Option[(Int, LatLngBBox)]]

  def getLabelCVMetadata(batchSize: Int): Source[LabelCVMetadata, _]

  def getLabelsToClusterInRegion(regionId: Int): Future[Seq[LabelToCluster]]
  def getRegionsToClusterAndWipeOldData: Future[Seq[Int]]

  /**
   * Submits clustering results for a region.
   *
   * @param regionId The region ID of the region whose clustering results are being submitted.
   * @param clusters The clusters created.
   * @param labels The labels used to create the clusters.
   * @param thresholds Cutoff points used to determine max distance between points in a cluster for each label type.
   * @return The ID of the clustering session created.
   */
  def submitClusteringResults(
      regionId: Int,
      clusters: Seq[ClusterSubmission],
      labels: Seq[ClusteredLabelSubmission],
      thresholds: Seq[ClusteringThreshold]
  ): Future[Int]

  /**
   * Gets the count of labels used in clustering and number of clusters created.
   */
  def getClusteringInfo: Future[(Int, Int)]

  /** The v3 APIs * */
  /**
   * Gets all street types with their counts from the database.
   *
   * @return A future containing a sequence of StreetTypeForApi objects
   */
  def getStreetTypes(lang: Lang): Future[Seq[StreetTypeForApi]]

  /**
   * Retrieves streets based on the provided filters and returns them as a reactive stream source.
   *
   * @param filters   The filters to apply when retrieving streets.
   * @param batchSize The number of records to fetch in each batch from the database.
   * @return          A reactive stream source that emits StreetDataForApi objects.
   */
  def getStreets(filters: StreetFiltersForApi, batchSize: Int): Source[StreetDataForApi, _]

  /**
   * Retrieves regions (neighborhoods) based on the provided filters and returns them as a reactive stream source.
   *
   * @param filters   The filters to apply when retrieving regions.
   * @param batchSize The number of records to fetch in each batch from the database.
   * @return          A reactive stream source that emits RegionDataForApi objects.
   */
  def getRegions(filters: RegionFiltersForApi, batchSize: Int): Source[RegionDataForApi, _]

  /**
   * Retrieves the region with the most labels from the database.
   *
   * @return A `Future` containing an `Option` of `Region`. The `Option` will be:
   *         - `Some(region)` if a region with the most labels exists.
   *         - `None` if no regions are found.
   */
  def getRegionWithMostLabels: Future[Option[Region]]

  /**
   * Retrieves label clusters based on the provided filters and returns them as a reactive stream source.
   *
   * @param filters   The filters to apply when retrieving label clusters
   * @param batchSize The number of records to fetch in each batch from the database
   * @return          A reactive stream source that emits `LabelClusterForApi` objects
   */
  def getLabelClusters(filters: LabelClusterFiltersForApi, batchSize: Int): Source[LabelClusterForApi, _]

  /**
   * Sets up streaming query to get raw labels with filters.
   *
   * @param filters The filters to apply to the label data.
   * @param batchSize The size of each batch of data to fetch.
   * @return A source of label data.
   */
  def getRawLabels(filters: RawLabelFiltersForApi, batchSize: Int): Source[LabelDataForApi, _]

  /**
   * Gets all label types and transforms them into LabelTypeForApi objects, including icon paths and colors.
   *
   * @param lang The language to use for localized descriptions
   * @return A future containing a set of label type details
   */
  def getLabelTypes(lang: Lang): Set[LabelTypeForApi]

  /**
   * Gets user statistics with optional filtering parameters applied at the database level.
   *
   * @param minLabels Optional minimum number of labels a user must have.
   * @param minMetersExplored Optional minimum meters explored a user must have.
   * @param highQualityOnly Optional filter to include only high quality users if true.
   * @param minAccuracy Optional minimum label accuracy a user must have.
   * @return A Future containing a sequence of UserStatForApi objects that match the filters.
   */
  def getUserStats(
      minLabels: Option[Int] = None,
      minMetersExplored: Option[Double] = None,
      highQualityOnly: Boolean = false,
      minAccuracy: Option[Double] = None
  ): Future[Seq[UserStatForApi]]

  def getOverallStats(filterLowQuality: Boolean): Future[ProjectSidewalkStats]

  /**
   * Returns daily label and validation counts for the current city, split by human vs AI and label type.
   *
   * Runs two DB queries concurrently (labels by time_created, validations by end_timestamp) then merges
   * them into one sequence keyed by (date, labelType).
   *
   * @param startDate        Inclusive start date (Pacific time); no lower bound if None.
   * @param endDate          Inclusive end date; no upper bound if None.
   * @param filterLowQuality If true, restrict to high-quality users (mirrors overallStats).
   * @return                 Merged sequence of DailyStatRecord, sorted by date then label type.
   */
  def getOverallStatsByDay(
      startDate: Option[LocalDate],
      endDate: Option[LocalDate],
      filterLowQuality: Boolean
  ): Future[Seq[DailyStatRecord]]

  /**
   * Retrieves validation data based on the provided filters and returns them as a reactive stream source.
   *
   * @param filters   The filters to apply when retrieving validations.
   * @param batchSize The number of records to fetch in each batch from the database.
   * @return          A reactive stream source that emits ValidationDataForApi objects.
   */
  def getValidations(filters: ValidationFiltersForApi, batchSize: Int): Source[ValidationDataForApi, _]

  /**
   * Retrieves all validation result types with their counts.
   * @return A future containing a sequence of ValidationResultTypeForApi objects
   */
  def getValidationResultTypes: Future[Seq[ValidationResultTypeForApi]]
}

@Singleton
class ApiServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    messagesApi: MessagesApi,
    config: Configuration,
    clusterTable: ClusterTable,
    streetEdgeTable: StreetEdgeTable,
    regionTable: RegionTable,
    labelTable: LabelTable,
    userStatTable: UserStatTable,
    clusteringSessionTable: ClusteringSessionTable,
    clusterLabelTable: ClusterLabelTable,
    labelValidationTable: LabelValidationTable,
    implicit val ec: ExecutionContext
) extends ApiService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  val gf: GeometryFactory = JTSFactoryFinder.getGeometryFactory

  /**
   * Sets up a streaming query to fetch data from the database in batches.
   *
   * @param query The SQL streaming action to execute.
   * @param batchSize The number of records to fetch in each batch from the database.
   * @tparam A The type of records being fetched.
   * @return A reactive stream source that emits records of type A.
   */
  private def setUpStreamFromDb[A](
      query: SqlStreamingAction[Vector[A], A, Effect.Read],
      batchSize: Int
  ): Source[A, _] = {
    Source.fromPublisher(db.stream(query.transactionally.withStatementParameters(fetchSize = batchSize)))
  }

  def getStreets(filters: StreetFiltersForApi, batchSize: Int): Source[StreetDataForApi, _] = {
    setUpStreamFromDb(streetEdgeTable.getStreetsForApi(filters), batchSize)
  }

  def getRegions(filters: RegionFiltersForApi, batchSize: Int): Source[RegionDataForApi, _] = {
    setUpStreamFromDb(regionTable.getRegionsForApi(filters), batchSize)
  }

  def getLabelClusters(filters: LabelClusterFiltersForApi, batchSize: Int): Source[LabelClusterForApi, _] = {
    setUpStreamFromDb(clusterTable.getLabelClustersV3(filters), batchSize)
  }

  def getRegionWithMostLabels: Future[Option[Region]] =
    db.run(regionTable.getRegionWithMostLabels)

  def getRawLabels(filters: RawLabelFiltersForApi, batchSize: Int): Source[LabelDataForApi, _] = {
    setUpStreamFromDb(labelTable.getLabelDataWithFilters(filters), batchSize)
  }

  def getLabelTypes(lang: Lang): Set[LabelTypeForApi] = {
    LabelTypeEnum.values.map { labelType =>
      // Get the localized description for the label type.
      val description = messagesApi(labelType.descriptionKey)(lang)

      // Create a LabelTypeForApi object with the necessary details.
      LabelTypeForApi(
        id = labelType.id, name = labelType.name, description = description, iconUrl = labelType.iconPath,
        smallIconUrl = labelType.smallIconPath, tinyIconUrl = labelType.tinyIconPath, color = labelType.color,
        isPrimary = LabelTypeEnum.primaryLabelTypes.contains(labelType),
        isPrimaryValidate = LabelTypeEnum.primaryValidateLabelTypes.contains(labelType)
      )
    }
  }

  def selectStreetsIntersecting(spatialQueryType: SpatialQueryType, bbox: LatLngBBox): Future[Seq[StreetEdgeInfo]] =
    db.run(streetEdgeTable.selectStreetsIntersecting(spatialQueryType, bbox))

  def getNeighborhoodsWithin(bbox: LatLngBBox): Future[Seq[Region]] =
    db.run(regionTable.getNeighborhoodsWithin(bbox))

  def getClusterScoreRows(
      spatialQueryType: SpatialQueryType,
      bbox: LatLngBBox,
      labelTypes: Set[String],
      batchSize: Int
  ): Source[ClusterScoreRow, _] = {
    setUpStreamFromDb(clusterTable.getClusterScoreRows(spatialQueryType, bbox, labelTypes), batchSize)
  }

  def getStreetLengths(streetEdgeIds: Seq[Int]): Future[Map[Int, Double]] =
    db.run(streetEdgeTable.getStreetLengths(streetEdgeIds))

  /** Derives a lat/lng bounding box from a region's MultiPolygon envelope (geometry is stored in EPSG:4326). */
  private def regionToBBox(region: Region): LatLngBBox = {
    val env = region.geom.getEnvelopeInternal
    LatLngBBox(minLat = env.getMinY, minLng = env.getMinX, maxLat = env.getMaxY, maxLng = env.getMaxX)
  }

  def getRegionBBox(regionId: Int): Future[Option[LatLngBBox]] =
    db.run(regionTable.getRegion(regionId)).map(_.map(regionToBBox))

  def resolveRegionByName(regionName: String): Future[Option[(Int, LatLngBBox)]] =
    db.run(regionTable.getRegionByName(regionName)).map(_.map(r => (r.regionId, regionToBBox(r))))

  def getLabelCVMetadata(batchSize: Int): Source[LabelCVMetadata, _] = {
    // NOTE can't use `setUpStreamFromDb` here bc we need to call `mapResult` to convert tuples to `LabelCVMetadata`.
    Source.fromPublisher(
      db.stream(
        labelTable.getLabelCVMetadata.transactionally
          .withStatementParameters(fetchSize = batchSize)
      ).mapResult((LabelCVMetadata.apply _).tupled)
    )
  }

  def getUserStats(
      minLabels: Option[Int] = None,
      minMetersExplored: Option[Double] = None,
      highQualityOnly: Boolean = false,
      minAccuracy: Option[Double] = None
  ): Future[Seq[UserStatForApi]] = {
    // Uses the database-level filtering method for improved performance.
    db.run(userStatTable.getStatsForApiWithFilters(minLabels, minMetersExplored, highQualityOnly, minAccuracy))
  }

  def getOverallStats(filterLowQuality: Boolean): Future[ProjectSidewalkStats] = {
    // Get city launch date and avg timestamp from last 100 labels to include in the query results.
    val cityId: String     = config.get[String]("city-id")
    val launchDate: String = config.get[String](s"city-params.launch-date.$cityId")
    db.run(for {
      avgLabelDate <- labelTable.recentLabelsAvgLabelDate(100)
      overallStats <- labelTable.getOverallStatsForApi(filterLowQuality, launchDate, avgLabelDate)
    } yield overallStats)
  }

  def getLabelsToClusterInRegion(regionId: Int): Future[Seq[LabelToCluster]] =
    db.run(clusteringSessionTable.getLabelsToClusterInRegion(regionId))

  def getRegionsToClusterAndWipeOldData: Future[Seq[Int]] = {
    db.run(for {
      // Get the list of region that need to be updated because the underlying labels have changed.
      regionIds: Seq[Int] <- clusteringSessionTable.getRegionsToCluster
      // Delete the data for those regions.
      _ <- clusteringSessionTable.deleteClusteringSessions(regionIds)
    } yield regionIds)
  }

  def submitClusteringResults(
      regionId: Int,
      clusters: Seq[ClusterSubmission],
      labels: Seq[ClusteredLabelSubmission],
      thresholds: Seq[ClusteringThreshold]
  ): Future[Int] = {
    val timestamp = OffsetDateTime.now
    db.run((for {
      // Add the corresponding entry to the clustering_session table.
      sessionId: Int <- clusteringSessionTable.insert(ClusteringSession(0, regionId, thresholds, timestamp))

      // Query the db for the closest street for each cluster. These run batched under the hood.
      streetIds: Seq[Int] <- labelTable.getStreetEdgeIdClosestToLatLngs(clusters.map(c => (c.lat, c.lng)))

      // Turn each cluster into a Cluster object.
      clusterObjs: Seq[Cluster] =
        clusters.zip(streetIds).map { case (cluster, streetId) =>
          val labelTypeId: Int = LabelTypeEnum.labelTypeToId(cluster.labelType)
          val geom             = gf.createPoint(new Coordinate(cluster.lng, cluster.lat))
          Cluster(0, sessionId, labelTypeId, streetId, geom, cluster.severity)
        }

      // Bulk insert clusters and return their newly created IDs in the same order.
      clusterIds: Seq[Int] <- clusterTable.saveMultiple(clusterObjs)

      // Map input clusters to their new clusterId.
      clusterIdsMap: Map[Int, Int] = clusters
        .zip(clusterIds)
        .map { case (c, clusterId) => (c.clusterNum, clusterId) }
        .toMap

      // Add all the associated labels to the cluster_label table.
      clusterLabels = labels.map { label => ClusterLabel(0, clusterIdsMap(label.clusterNum), label.labelId) }
      _ <- clusterLabelTable.insertMultiple(clusterLabels)
    } yield sessionId).transactionally)
  }

  def getClusteringInfo: Future[(Int, Int)] = {
    db.run(for {
      labelCount   <- clusterLabelTable.countClusterLabels
      clusterCount <- clusterTable.countClusters
    } yield (labelCount, clusterCount))
  }

  def getStreetTypes(lang: Lang): Future[Seq[StreetTypeForApi]] = {
    db.run(streetEdgeTable.getStreetTypes).map { wayTypeCounts =>
      // Transform to StreetTypeForApi objects with descriptions.
      wayTypeCounts
        .sortBy(_._1) // Sort by name.
        .map { case (wayType, count) =>
          val description: String = messagesApi(s"way.type.${wayType.replace("_", ".")}")(lang)
          StreetTypeForApi(wayType, description, count)
        }
    }
  }

  def getOverallStatsByDay(
      startDate: Option[LocalDate],
      endDate: Option[LocalDate],
      filterLowQuality: Boolean
  ): Future[Seq[DailyStatRecord]] = {
    val labelsFuture      = db.run(labelTable.getDailyLabelStats(startDate, endDate, filterLowQuality))
    val validationsFuture = db.run(labelValidationTable.getDailyValidationStats(startDate, endDate, filterLowQuality))
    for {
      labels      <- labelsFuture
      validations <- validationsFuture
    } yield DailyStatRecord.merge(labels, validations)
  }

  def getValidations(filters: ValidationFiltersForApi, batchSize: Int): Source[ValidationDataForApi, _] = {
    // NOTE can't use `setUpStreamFromDb` here bc we need to call `mapResult` to convert to `ValidationFiltersForApi`.
    Source.fromPublisher(
      db.stream(
        labelValidationTable
          .getValidationsForApi(filters)
          .result
          .transactionally
          .withStatementParameters(fetchSize = batchSize)
      ).mapResult(labelValidationTable.tupleToValidationDataForApi)
    )
  }

  def getValidationResultTypes: Future[Seq[ValidationResultTypeForApi]] = {
    db.run(labelValidationTable.getValidationResultTypes)
  }
}
