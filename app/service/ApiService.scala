package service

import com.google.inject.ImplementedBy
import formats.json.ClusterFormats.{ClusterSubmission, ClusteredLabelSubmission}
import models.api._
import models.cluster._
import models.label._
import models.region.{Region, RegionTable}
import models.street.{StreetEdgeInfo, StreetEdgeTable}
import models.user.{UserStatApi, UserStatTable}
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
import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

@ImplementedBy(classOf[ApiServiceImpl])
trait ApiService {

  // Sets up streaming query to get clusters in a bounding box.
  def getClustersInBoundingBox(
      spatialQueryType: SpatialQueryType,
      bbox: LatLngBBox,
      severity: Option[String],
      batchSize: Int
  ): Source[ClusterForApi, _]

  def selectStreetsIntersecting(spatialQueryType: SpatialQueryType, bbox: LatLngBBox): Future[Seq[StreetEdgeInfo]]

  def getNeighborhoodsWithin(bbox: LatLngBBox): Future[Seq[Region]]

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
   * @return A Future containing a sequence of UserStatApi objects that match the filters.
   */
  def getUserStats(
      minLabels: Option[Int] = None,
      minMetersExplored: Option[Float] = None,
      highQualityOnly: Boolean = false,
      minAccuracy: Option[Float] = None
  ): Future[Seq[UserStatApi]]

  def getOverallStats(filterLowQuality: Boolean): Future[ProjectSidewalkStats]

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

  def getClustersInBoundingBox(
      spatialQueryType: SpatialQueryType,
      bbox: LatLngBBox,
      severity: Option[String],
      batchSize: Int
  ): Source[ClusterForApi, _] = {
    setUpStreamFromDb(clusterTable.getClustersInBoundingBox(spatialQueryType, bbox, severity), batchSize)
  }

  def selectStreetsIntersecting(spatialQueryType: SpatialQueryType, bbox: LatLngBBox): Future[Seq[StreetEdgeInfo]] =
    db.run(streetEdgeTable.selectStreetsIntersecting(spatialQueryType, bbox))

  def getNeighborhoodsWithin(bbox: LatLngBBox): Future[Seq[Region]] =
    db.run(regionTable.getNeighborhoodsWithin(bbox))

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
      minMetersExplored: Option[Float] = None,
      highQualityOnly: Boolean = false,
      minAccuracy: Option[Float] = None
  ): Future[Seq[UserStatApi]] = {
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
