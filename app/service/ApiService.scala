package service

import com.google.inject.ImplementedBy
import formats.json.ClusterFormats.{ClusterSubmission, ClusteredLabelSubmission}
import models.api._
import models.attribute._
import models.label._
import models.region.{Region, RegionTable}
import models.street.{StreetEdgeInfo, StreetEdgeTable}
import models.user.{UserStatApi, UserStatTable}
import models.utils.MyPostgresProfile.api._
import models.utils.SpatialQueryType.SpatialQueryType
import models.utils.{LatLngBBox, MyPostgresProfile}
import models.validation.LabelValidationTable
import org.apache.pekko.stream.scaladsl.Source
import play.api.Configuration
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.i18n.{Lang, MessagesApi}
import slick.sql.SqlStreamingAction

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

@ImplementedBy(classOf[ApiServiceImpl])
trait ApiService {

  def getAttributesInBoundingBox(
      spatialQueryType: SpatialQueryType,
      bbox: LatLngBBox,
      severity: Option[String],
      batchSize: Int
  ): Source[GlobalAttributeForApi, _]

  def getGlobalAttributesWithLabelsInBoundingBox(
      bbox: LatLngBBox,
      severity: Option[String],
      batchSize: Int
  ): Source[GlobalAttributeWithLabelForApi, _]

  def selectStreetsIntersecting(spatialQueryType: SpatialQueryType, bbox: LatLngBBox): Future[Seq[StreetEdgeInfo]]

  def getNeighborhoodsWithin(bbox: LatLngBBox): Future[Seq[Region]]

  def getLabelCVMetadata(batchSize: Int): Source[LabelCVMetadata, _]

  def getUserLabelsToCluster(userId: String): Future[Seq[LabelToCluster]]
  def getClusteredLabelsInRegion(regionId: Int): Future[Seq[LabelToCluster]]
  def getUsersToClusterAndWipeOldData: Future[Seq[String]]
  def getRegionsToClusterAndWipeOldData: Future[Seq[Int]]
  def submitSingleUserClusteringResults(
      userId: String,
      clusters: Seq[ClusterSubmission],
      labels: Seq[ClusteredLabelSubmission],
      thresholds: Map[String, Float]
  ): Future[Int]
  def submitMultiUserClusteringResults(
      regionId: Int,
      clusters: Seq[ClusterSubmission],
      userAttributes: Seq[ClusteredLabelSubmission],
      thresholds: Map[String, Float]
  ): Future[Int]
  def getClusteringInfo: Future[(Int, Int, Int)]

  /** The v3 APIs * */
  def getStreetTypes(lang: Lang): Future[Seq[StreetTypeForApi]]
  def getStreets(filters: StreetFiltersForApi, batchSize: Int): Source[StreetDataForApi, _]

  def getRegionWithMostLabels: Future[Option[Region]]

  def getLabelClusters(filters: LabelClusterFiltersForApi, batchSize: Int): Source[LabelClusterForApi, _]

  def getRawLabels(filters: RawLabelFiltersForApi, batchSize: Int): Source[LabelDataForApi, _]

  /**
   * Gets all label types and transforms them into LabelTypeForApi objects, including icon paths and colors.
   *
   * @param lang The language to use for localized descriptions
   * @return A future containing a set of label type details
   */
  def getLabelTypes(lang: Lang): Set[LabelTypeForApi]

  def getUserStats(
      minLabels: Option[Int] = None,
      minMetersExplored: Option[Float] = None,
      highQualityOnly: Option[Boolean] = None,
      minLabelAccuracy: Option[Float] = None
  ): Future[Seq[UserStatApi]]

  def getOverallStats(filterLowQuality: Boolean): Future[ProjectSidewalkStats]

  def getValidations(filters: ValidationFiltersForApi, batchSize: Int): Source[ValidationDataForApi, _]
  def getValidationResultTypes: Future[Seq[ValidationResultTypeForApi]]
}

@Singleton
class ApiServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    messagesApi: MessagesApi,
    config: Configuration,
    globalAttributeTable: GlobalAttributeTable,
    streetEdgeTable: StreetEdgeTable,
    regionTable: RegionTable,
    labelTable: LabelTable,
    userStatTable: UserStatTable,
    userClusteringSessionTable: UserClusteringSessionTable,
    userAttributeTable: UserAttributeTable,
    userAttributeLabelTable: UserAttributeLabelTable,
    globalClusteringSessionTable: GlobalClusteringSessionTable,
    globalAttributeUserAttributeTable: GlobalAttributeUserAttributeTable,
    labelValidationTable: LabelValidationTable,
    implicit val ec: ExecutionContext
) extends ApiService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

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

  /**
   * Retrieves streets based on the provided filters and returns them as a reactive stream source.
   *
   * @param filters   The filters to apply when retrieving streets.
   * @param batchSize The number of records to fetch in each batch from the database.
   * @return          A reactive stream source that emits StreetDataForApi objects.
   */
  def getStreets(filters: StreetFiltersForApi, batchSize: Int): Source[StreetDataForApi, _] = {
    setUpStreamFromDb(streetEdgeTable.getStreetsForApi(filters), batchSize)
  }

  /**
   * Retrieves label clusters based on the provided filters and returns them as a reactive stream source.
   *
   * @param filters   The filters to apply when retrieving label clusters. These filters determine which label clusters
   *                  are included in the result.
   * @param batchSize The number of records to fetch in each batch from the database.
   * @return          A reactive stream source (`pekko.stream.scaladsl.Source`) that emits. `LabelClusterForApi` objects
   *                  representing the label clusters.
   */
  def getLabelClusters(filters: LabelClusterFiltersForApi, batchSize: Int): Source[LabelClusterForApi, _] = {
    setUpStreamFromDb(globalAttributeTable.getLabelClustersV3(filters), batchSize)
  }

  /**
   * Retrieves the region with the most labels from the database.
   *
   * @return A `Future` containing an `Option` of `Region`. The `Option` will be:
   *         - `Some(region)` if a region with the most labels exists.
   *         - `None` if no regions are found.
   */
  def getRegionWithMostLabels: Future[Option[Region]] =
    db.run(regionTable.getRegionWithMostLabels)

  /**
   * Sets up streaming query to get raw labels with filters.
   *
   * @param filters The filters to apply to the label data.
   * @param batchSize The size of each batch of data to fetch.
   * @return A source of label data.
   */
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
        isPrimary = LabelTypeEnum.primaryLabelTypes.contains(labelType.name),
        isPrimaryValidate = LabelTypeEnum.primaryValidateLabelTypes.contains(labelType.name)
      )
    }
  }

  // Sets up streaming query to get global attributes in a bounding box.
  def getAttributesInBoundingBox(
      spatialQueryType: SpatialQueryType,
      bbox: LatLngBBox,
      severity: Option[String],
      batchSize: Int
  ): Source[GlobalAttributeForApi, _] = {
    setUpStreamFromDb(globalAttributeTable.getAttributesInBoundingBox(spatialQueryType, bbox, severity), batchSize)
  }

  // Sets up streaming query to get global attributes with their associated labels in a bounding box.
  def getGlobalAttributesWithLabelsInBoundingBox(
      bbox: LatLngBBox,
      severity: Option[String],
      batchSize: Int
  ): Source[GlobalAttributeWithLabelForApi, _] = {
    setUpStreamFromDb(globalAttributeTable.getGlobalAttributesWithLabelsInBoundingBox(bbox, severity), batchSize)
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

  /**
   * Gets user statistics with optional filtering parameters applied at the database level.
   *
   * @param minLabels Optional minimum number of labels a user must have.
   * @param minMetersExplored Optional minimum meters explored a user must have.
   * @param highQualityOnly Optional filter to include only high quality users if Some(true).
   * @param minLabelAccuracy Optional minimum label accuracy a user must have.
   * @return A Future containing a sequence of UserStatApi objects that match the filters.
   */
  def getUserStats(
      minLabels: Option[Int] = None,
      minMetersExplored: Option[Float] = None,
      highQualityOnly: Option[Boolean] = None,
      minLabelAccuracy: Option[Float] = None
  ): Future[Seq[UserStatApi]] = {
    // Uses the database-level filtering method for improved performance.
    db.run(userStatTable.getStatsForApiWithFilters(minLabels, minMetersExplored, highQualityOnly, minLabelAccuracy))
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

  def getUserLabelsToCluster(userId: String): Future[Seq[LabelToCluster]] =
    db.run(userClusteringSessionTable.getUserLabelsToCluster(userId))

  def getClusteredLabelsInRegion(regionId: Int): Future[Seq[LabelToCluster]] =
    db.run(userClusteringSessionTable.getClusteredLabelsInRegion(regionId))

  def getUsersToClusterAndWipeOldData: Future[Seq[String]] = {
    db.run((for {
      // Get the list of users whose data we want to delete or re-cluster (or cluster for the first time).
      usersToUpdate: Seq[String] <- userStatTable.usersToUpdateInApi
      // Delete data from users we want to re-cluster.
      _ <- userClusteringSessionTable.deleteUserClusteringSessions(usersToUpdate)
    } yield usersToUpdate).transactionally)
  }

  def getRegionsToClusterAndWipeOldData: Future[Seq[Int]] = {
    db.run(for {
      // Get the list of neighborhoods that need to be updated because the underlying users' clusters changed.
      regionIds: Seq[Int] <- globalClusteringSessionTable.getNeighborhoodsToReCluster
      // Delete the data for those regions.
      _ <- globalClusteringSessionTable.deleteGlobalClusteringSessions(regionIds)
    } yield regionIds)
  }

  /**
   * Submits clustering results for a single user.
   *
   * @param userId The user ID of the user whose clustering results are being submitted.
   * @param clusters The clusters created.
   * @param labels The labels used to create the clusters.
   * @param thresholds Cutoff points used to determine max distance between points in a cluster for each label type.
   * @return The ID of the user clustering session created.
   */
  def submitSingleUserClusteringResults(
      userId: String,
      clusters: Seq[ClusterSubmission],
      labels: Seq[ClusteredLabelSubmission],
      thresholds: Map[String, Float]
  ): Future[Int] = {
    val timestamp = OffsetDateTime.now
    db.run((for {
      // Add the corresponding entry to the user_clustering_session table.
      userSessionId: Int <- userClusteringSessionTable.insert(UserClusteringSession(0, userId, timestamp))

      // Query the db for the closest region for each cluster. This runs batched under the hood.
      regionIds: Seq[Int] <- regionTable.getRegionIdClosestToLatLngs(clusters.map(c => (c.lat, c.lng)))

      // Turn each cluster into a UserAttribute object.
      userAttributes: Seq[UserAttribute] =
        clusters.zip(regionIds).map { case (cluster, regionId) =>
          UserAttribute(
            userAttributeId = 0, userClusteringSessionId = userSessionId,
            clusteringThreshold = thresholds(cluster.labelType),
            labelTypeId = LabelTypeEnum.labelTypeToId(cluster.labelType), regionId = regionId, lat = cluster.lat,
            lng = cluster.lng, severity = cluster.severity
          )
        }

      // Bulk insert user attributes and return their newly created IDs in the same order.
      userAttrIds: Seq[Int] <- userAttributeTable.saveMultiple(userAttributes)

      // Map clusters to their new userAttributeId.
      userAttrIdsMap: Map[Int, Int] = clusters
        .zip(userAttrIds)
        .map { case (c, attrId) => (c.clusterNum, attrId) }
        .toMap

      // Add all the associated labels to the user_attribute_label table.
      userAttrLabels: Seq[UserAttributeLabel] = labels.map { label =>
        UserAttributeLabel(0, userAttrIdsMap(label.clusterNum), label.labelId)
      }

      // Bulk insert user_attribute_labels.
      _ <- userAttributeLabelTable.insertMultiple(userAttrLabels)
    } yield userSessionId).transactionally)
  }

  /**
   * Submits clustering results for a region.
   *
   * @param regionId The region ID of the region whose clustering results are being submitted.
   * @param clusters The clusters created.
   * @param userAttributes The user_attributes used to create the clusters.
   * @param thresholds Cutoff points used to determine max distance between points in a cluster for each label type.
   * @return The ID of the global clustering session created.
   */
  def submitMultiUserClusteringResults(
      regionId: Int,
      clusters: Seq[ClusterSubmission],
      userAttributes: Seq[ClusteredLabelSubmission],
      thresholds: Map[String, Float]
  ): Future[Int] = {
    val timestamp = OffsetDateTime.now
    db.run((for {
      // Add the corresponding entry to the global_clustering_session table.
      globalSessionId: Int <- globalClusteringSessionTable.insert(GlobalClusteringSession(0, regionId, timestamp))

      // Query the db for the closest street and region for each cluster. These run batched under the hood.
      streetIds: Seq[Int] <- labelTable.getStreetEdgeIdClosestToLatLngs(clusters.map(c => (c.lat, c.lng)))
      regionIds: Seq[Int] <- regionTable.getRegionIdClosestToLatLngs(clusters.map(c => (c.lat, c.lng)))

      // Turn each cluster into a GlobalAttribute object.
      globalAttributes: Seq[GlobalAttribute] =
        clusters.zip(streetIds).zip(regionIds).map { case ((cluster, streetId), regionId) =>
          GlobalAttribute(
            globalAttributeId = 0, globalClusteringSessionId = globalSessionId,
            clusteringThreshold = thresholds(cluster.labelType),
            labelTypeId = LabelTypeEnum.labelTypeToId(cluster.labelType), streetEdgeId = streetId, regionId = regionId,
            lat = cluster.lat, lng = cluster.lng, severity = cluster.severity
          )
        }

      // Bulk insert global attributes and return their newly created IDs in the same order.
      globalAttrIds: Seq[Int] <- globalAttributeTable.saveMultiple(globalAttributes)

      // Map clusters to their new globalAttributeId.
      globalAttrIdsMap: Map[Int, Int] = clusters
        .zip(globalAttrIds)
        .map { case (c, attrId) => (c.clusterNum, attrId) }
        .toMap

      // Add all the associated labels to the global_attribute_user_attribute table.
      globalAttrUserAttrs: Seq[GlobalAttributeUserAttribute] = userAttributes
        .map { userAttribute =>
          GlobalAttributeUserAttribute(0, globalAttrIdsMap(userAttribute.clusterNum), userAttribute.labelId)
        }

      // Bulk insert global_attribute_user_attributes.
      _ <- globalAttributeUserAttributeTable.insertMultiple(globalAttrUserAttrs)
    } yield globalSessionId).transactionally)
  }

  /**
   * Gets the count of labels used in clustering, and the user attributes and global attributes created from clustering.
   */
  def getClusteringInfo: Future[(Int, Int, Int)] = {
    db.run(for {
      labelCount           <- userAttributeLabelTable.countUserAttributeLabels
      userAttributeCount   <- userAttributeTable.countUserAttributes
      globalAttributeCount <- globalAttributeTable.countGlobalAttributes
    } yield (labelCount, userAttributeCount, globalAttributeCount))
  }

  /**
   * Gets all street types with their counts from the database.
   *
   * @return A future containing a sequence of StreetTypeForApi objects
   */
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

  /**
   * Retrieves validation data based on the provided filters and returns them as a reactive stream source.
   *
   * @param filters   The filters to apply when retrieving validations. These filters determine which validations are
   *                  included in the result.
   * @param batchSize The number of records to fetch in each batch from the database.
   * @return          A reactive stream source that emits ValidationDataForApi objects.
   */
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

  /**
   * Retrieves all validation result types with their counts.
   *
   * @return A future containing a sequence of ValidationResultTypeForApi objects
   */
  def getValidationResultTypes: Future[Seq[ValidationResultTypeForApi]] = {
    db.run(labelValidationTable.getValidationResultTypes)
  }
}
