package service

import com.google.inject.ImplementedBy

import formats.json.ClusterFormats.{ClusterSubmission, ClusteredLabelSubmission}
import models.utils.SpatialQueryType
import models.utils.SpatialQueryType.SpatialQueryType
import models.utils.LatLngBBox
import models.attribute._
import models.validation.LabelValidationTable
import models.label._
import models.region.{Region, RegionTable}
import models.street.{StreetEdgeInfo, StreetEdgeTable}
import models.user.{UserStatApi, UserStatTable}
import models.api.{
  LabelDataForApi,
  RawLabelFiltersForApi,
  LabelTypeForApi,
  LabelTagForApi,
  LabelClusterForApi,
  LabelClusterFiltersForApi,
  StreetDataForApi,
  StreetFiltersForApi,
  StreetTypeForApi,
  ValidationDataForApi,
  ValidationFiltersForApi,
  ValidationResultTypeForApi
}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._

import org.apache.pekko.stream.scaladsl.Source
import play.api.Configuration
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

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
  
  def selectStreetsIntersecting(
      spatialQueryType: SpatialQueryType,
      bbox: LatLngBBox
  ): Future[Seq[StreetEdgeInfo]]
  
  def getNeighborhoodsWithin(bbox: LatLngBBox): Future[Seq[Region]]
  
  def getLabelCVMetadata(batchSize: Int): Source[LabelCVMetadata, _]

  def getUserLabelsToCluster(userId: String): Future[Seq[LabelToCluster]]
  def getClusteredLabelsInRegion(regionId: Int): Future[Seq[LabelToCluster]]
  def getUsersToCluster: Future[Seq[String]]
  def getRegionsToCluster: Future[Seq[Int]]
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
  def getAllLabelMetadata(
      bbox: LatLngBBox,
      batchSize: Int
  ): Source[LabelAllMetadata, _]
  
  /** The v3 APIs **/
  def getStreetTypes(): Future[Seq[StreetTypeForApi]]
  def getStreets(filters: StreetFiltersForApi, batchSize: Int): Source[StreetDataForApi, _]

  def getRegionWithMostLabels: Future[Option[Region]]

  def getLabelClusters(
      filters: LabelClusterFiltersForApi,
      batchSize: Int
  ): Source[LabelClusterForApi, _]

  def getRawLabels(
      filters: RawLabelFiltersForApi,
      batchSize: Int
  ): Source[LabelDataForApi, _]

  def getLabelTypes(): Future[Set[LabelTypeForApi]]
  
  def getLabelTags(): Future[Seq[LabelTagForApi]]
  
  def getUserStats(
      minLabels: Option[Int] = None,
      minMetersExplored: Option[Float] = None,
      highQualityOnly: Option[Boolean] = None,
      minLabelAccuracy: Option[Float] = None
  ): Future[Seq[UserStatApi]]

  def getOverallStats(
      filterLowQuality: Boolean
  ): Future[ProjectSidewalkStats]

  def getValidations(
      filters: ValidationFiltersForApi,
      batchSize: Int
  ): Source[ValidationDataForApi, _]

  def getValidationResultTypes(): Future[Seq[ValidationResultTypeForApi]]

}

@Singleton
class ApiServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    globalAttributeTable: GlobalAttributeTable,
    streetEdgeTable: StreetEdgeTable,
    regionTable: RegionTable,
    labelTable: LabelTable,
    labelTypeTableRepository: models.label.LabelTypeTableRepository,
    tagTable: TagTable,
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
   * Retrieves streets based on the provided filters and returns them as a reactive stream source.
   *
   * @param filters   The filters to apply when retrieving streets. These filters determine
   *                  which streets are included in the result.
   * @param batchSize The number of records to fetch in each batch from the database.
   * @return          A reactive stream source that emits StreetDataForApi objects.
   */
  def getStreets(filters: StreetFiltersForApi, batchSize: Int): Source[StreetDataForApi, _] = {
    Source.fromPublisher(db.stream(
      streetEdgeTable.getStreetsForApi(filters)
        .transactionally.withStatementParameters(fetchSize = batchSize)
    ))
  }
  
  /**
   * Retrieves label clusters based on the provided filters and returns them as a reactive stream source.
   *
   * @param filters   The filters to apply when retrieving label clusters. These filters determine
   *                  which label clusters are included in the result.
   * @param batchSize The number of records to fetch in each batch from the database.
   * @return          A reactive stream source (`akka.stream.scaladsl.Source`) that emits
   *                  `LabelClusterForApi` objects representing the label clusters.
   */
  def getLabelClusters(
      filters: LabelClusterFiltersForApi,
      batchSize: Int
  ): Source[LabelClusterForApi, _] = {
    Source.fromPublisher(
      db.stream(
        globalAttributeTable
          .getLabelClustersV3(filters)
          .transactionally
          .withStatementParameters(fetchSize = batchSize)
      )
    )
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
   * *
   * Sets up streaming query to get raw labels with filters.
   * @param filters The filters to apply to the label data.
   * @param batchSize The size of each batch of data to fetch.
   * @return A source of label data.
   */
  def getRawLabels(
      filters: RawLabelFiltersForApi,
      batchSize: Int
  ): Source[LabelDataForApi, _] = {
    Source.fromPublisher(
      db.stream(
        labelTable
          .getLabelDataWithFilters(filters)
          .transactionally
          .withStatementParameters(fetchSize = batchSize)
      )
    )
  }

  /**
   * Gets the label types for the API.
   * @return A future containing a set of label type details.
   */
  def getLabelTypes(): Future[Set[LabelTypeForApi]] = {
    db.run(labelTypeTableRepository.getLabelTypesForApi)
  }

  /**
   * Gets all label tags with their metadata for the API.
   * @return A future containing a sequence of label tag details.
   */
  def getLabelTags(): Future[Seq[LabelTagForApi]] = {
    db.run(
      for {
        tags <- tagTable.selectAllTags
        labelTypes <- labelTypeTableRepository.getAllLabelTypes
      } yield {
        tags.map { tag =>
          // Find the matching label type for this tag
          val labelType = labelTypes
            .find(_.labelTypeId == tag.labelTypeId)
            .map(_.labelType)
            .getOrElse("Unknown")

          // Convert the mutuallyExclusiveWith Option[String] to Seq[String]
          val mutuallyExclusiveList = tag.mutuallyExclusiveWith
            .map(_.split(",").map(_.trim).filter(_.nonEmpty).toSeq)
            .getOrElse(Seq.empty[String])

          LabelTagForApi(
            id = tag.tagId,
            labelType = labelType,
            tag = tag.tag,
            mutuallyExclusiveWith = mutuallyExclusiveList
          )
        }
      }
    )
  }

  // Sets up streaming query to get global attributes in a bounding box.
  def getAttributesInBoundingBox(
      spatialQueryType: SpatialQueryType,
      bbox: LatLngBBox,
      severity: Option[String],
      batchSize: Int
  ): Source[GlobalAttributeForApi, _] = {
    Source.fromPublisher(
      db.stream(
        globalAttributeTable
          .getAttributesInBoundingBox(spatialQueryType, bbox, severity)
          .transactionally
          .withStatementParameters(fetchSize = batchSize)
      )
    )
  }

  // Sets up streaming query to get global attributes with their associated labels in a bounding box.
  def getGlobalAttributesWithLabelsInBoundingBox(
      bbox: LatLngBBox,
      severity: Option[String],
      batchSize: Int
  ): Source[GlobalAttributeWithLabelForApi, _] = {
    Source.fromPublisher(
      db.stream(
        globalAttributeTable
          .getGlobalAttributesWithLabelsInBoundingBox(bbox, severity)
          .transactionally
          .withStatementParameters(fetchSize = batchSize)
      )
    )
  }

  def selectStreetsIntersecting(
      spatialQueryType: SpatialQueryType,
      bbox: LatLngBBox
  ): Future[Seq[StreetEdgeInfo]] =
    db.run(streetEdgeTable.selectStreetsIntersecting(spatialQueryType, bbox))

  def getNeighborhoodsWithin(bbox: LatLngBBox): Future[Seq[Region]] =
    db.run(regionTable.getNeighborhoodsWithin(bbox))

  def getAllLabelMetadata(
      bbox: LatLngBBox,
      batchSize: Int
  ): Source[LabelAllMetadata, _] = {
    Source.fromPublisher(
      db.stream(
        labelTable
          .getAllLabelMetadata(bbox)
          .transactionally
          .withStatementParameters(fetchSize = batchSize)
      )
    )
  }

  def getLabelCVMetadata(batchSize: Int): Source[LabelCVMetadata, _] = {
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
   * @param minLabels Optional minimum number of labels a user must have
   * @param minMetersExplored Optional minimum meters explored a user must have
   * @param highQualityOnly Optional filter to include only high quality users if Some(true)
   * @param minLabelAccuracy Optional minimum label accuracy a user must have
   * @return A Future containing a sequence of UserStatApi objects that match the filters
   */
  def getUserStats(
      minLabels: Option[Int] = None,
      minMetersExplored: Option[Float] = None,
      highQualityOnly: Option[Boolean] = None,
      minLabelAccuracy: Option[Float] = None
  ): Future[Seq[UserStatApi]] = {
    // Uses the database-level filtering method for improved performance
    db.run(
      userStatTable.getStatsForApiWithFilters(
        minLabels,
        minMetersExplored,
        highQualityOnly,
        minLabelAccuracy
      )
    )
  }

  def getOverallStats(
      filterLowQuality: Boolean
  ): Future[ProjectSidewalkStats] = {
    // Get city launch date and avg timestamp from last 100 labels to include in the query results.
    val cityId: String = config.get[String]("city-id")
    val launchDate: String =
      config.get[String](s"city-params.launch-date.$cityId")
    db.run(labelTable.recentLabelsAvgLabelDate(100))
      .map { avgLabelDate =>
        db.run(
          labelTable
            .getOverallStatsForApi(filterLowQuality, launchDate, avgLabelDate)
        )
      }
      .flatten
  }

  def getUserLabelsToCluster(userId: String): Future[Seq[LabelToCluster]] =
    db.run(userClusteringSessionTable.getUserLabelsToCluster(userId))

  def getClusteredLabelsInRegion(regionId: Int): Future[Seq[LabelToCluster]] =
    db.run(userClusteringSessionTable.getClusteredLabelsInRegion(regionId))

  def getUsersToCluster: Future[Seq[String]] = {
    db.run((for {
      // Get the list of users whose data we want to delete or re-cluster (or cluster for the first time).
      usersToUpdate: Seq[String] <- userStatTable.usersToUpdateInApi
      // Delete data from users we want to re-cluster.
      _ <- userClusteringSessionTable.deleteUserClusteringSessions(
        usersToUpdate
      )
    } yield usersToUpdate).transactionally)
  }

  def getRegionsToCluster: Future[Seq[Int]] = {
    db.run(for {
      // Get the list of neighborhoods that need to be updated because the underlying users' clusters changed.
      regionIds: Seq[Int] <-
        globalClusteringSessionTable.getNeighborhoodsToReCluster
      // Delete the data for those regions.
      _ <- globalClusteringSessionTable.deleteGlobalClusteringSessions(
        regionIds
      )
    } yield regionIds)
  }

  /**
   * Submits clustering results for a single user.
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
      userSessionId: Int <- userClusteringSessionTable.insert(
        UserClusteringSession(0, userId, timestamp)
      )

      // Query the db for the closest region for each cluster. This runs batched under the hood.
      regionIds: Seq[Int] <- regionTable.getRegionIdClosestToLatLngs(
        clusters.map(c => (c.lat, c.lng))
      )

      // Turn each cluster into a UserAttribute object.
      userAttributes: Seq[UserAttribute] =
        clusters.zip(regionIds).map { case (cluster, regionId) =>
          UserAttribute(
            userAttributeId = 0,
            userClusteringSessionId = userSessionId,
            clusteringThreshold = thresholds(cluster.labelType),
            labelTypeId = LabelTypeTable.labelTypeToId(cluster.labelType),
            regionId = regionId,
            lat = cluster.lat,
            lng = cluster.lng,
            severity = cluster.severity,
            temporary = cluster.temporary
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
        UserAttributeLabel(
          userAttributeLabelId = 0,
          userAttributeId = userAttrIdsMap(label.clusterNum),
          labelId = label.labelId
        )
      }

      // Bulk insert user_attribute_labels.
      _ <- userAttributeLabelTable.insertMultiple(userAttrLabels)
    } yield userSessionId).transactionally)
  }

  /**
   * Submits clustering results for a region.
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
      globalSessionId: Int <- globalClusteringSessionTable.insert(
        GlobalClusteringSession(0, regionId, timestamp)
      )

      // Query the db for the closest street and region for each cluster. These run batched under the hood.
      streetIds: Seq[Int] <- labelTable.getStreetEdgeIdClosestToLatLngs(
        clusters.map(c => (c.lat, c.lng))
      )
      regionIds: Seq[Int] <- regionTable.getRegionIdClosestToLatLngs(
        clusters.map(c => (c.lat, c.lng))
      )

      // Turn each cluster into a GlobalAttribute object.
      globalAttributes: Seq[GlobalAttribute] =
        clusters.zip(streetIds).zip(regionIds).map {
          case ((cluster, streetId), regionId) =>
            GlobalAttribute(
              globalAttributeId = 0,
              globalClusteringSessionId = globalSessionId,
              clusteringThreshold = thresholds(cluster.labelType),
              labelTypeId = LabelTypeTable.labelTypeToId(cluster.labelType),
              streetEdgeId = streetId,
              regionId = regionId,
              lat = cluster.lat,
              lng = cluster.lng,
              severity = cluster.severity,
              temporary = cluster.temporary
            )
        }

      // Bulk insert global attributes and return their newly created IDs in the same order.
      globalAttrIds: Seq[Int] <- globalAttributeTable.saveMultiple(
        globalAttributes
      )

      // Map clusters to their new globalAttributeId.
      globalAttrIdsMap: Map[Int, Int] = clusters
        .zip(globalAttrIds)
        .map { case (c, attrId) => (c.clusterNum, attrId) }
        .toMap

      // Add all the associated labels to the global_attribute_user_attribute table.
      globalAttrUserAttrs: Seq[GlobalAttributeUserAttribute] = userAttributes
        .map { userAttribute =>
          GlobalAttributeUserAttribute(
            globalAttributeUserAttributeId = 0,
            globalAttributeId = globalAttrIdsMap(userAttribute.clusterNum),
            userAttributeId = userAttribute.labelId
          )
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
      labelCount <- userAttributeLabelTable.countUserAttributeLabels
      userAttributeCount <- userAttributeTable.countUserAttributes
      globalAttributeCount <- globalAttributeTable.countGlobalAttributes
    } yield (labelCount, userAttributeCount, globalAttributeCount))
  }

  /**
   * Gets all street types with their counts from the database.
   *
   * @return A future containing a sequence of StreetTypeForApi objects
   */
  def getStreetTypes(): Future[Seq[StreetTypeForApi]] = {
    // Define accurate descriptions for way types according to OpenStreetMap standards
    // See: https://wiki.openstreetmap.org/wiki/Key:highway#Roads
    val wayTypeDescriptions = Map(
      "motorway" -> "The highest-grade highways in a road network, designed for high-speed, long-distance travel. These roads have controlled access with grade-separated interchanges (no at-grade crossings), multiple lanes in each direction, and are normally divided with a median. In many countries, they have specific legal designations and restrictions on certain vehicle classes.",
      
      "trunk" -> "Important roads that form a strategic part of a road network, connecting major population centers. While typically high-capacity roads with high traffic volume, they may not have all the motorway features such as full grade separation or access control. Quality can vary significantly by region while maintaining the same classification based on network importance.",
      
      "primary" -> "Major highways forming a key part of a regional road network, connecting larger towns and cities. In urban areas, these often function as arterial roads with significant traffic volume. In less developed areas, road surface quality may vary considerably, as the classification is based on the road's importance in the network hierarchy rather than its physical characteristics.",
      
      "secondary" -> "Roads connecting smaller towns and villages, or significant districts within larger urban areas. These roads form an important part of the regional network but have less importance than primary roads. They typically carry moderate traffic volumes and connect to the primary road network.",
      
      "tertiary" -> "Roads connecting smaller settlements (villages, hamlets) to each other or linking local neighborhoods to the wider road network. Within urban areas, they often function as collector roads, moving traffic from residential areas to more major routes. They serve a vital role in the network hierarchy despite carrying lower traffic volumes.",
      
      "unclassified" -> "The lowest classification in the interconnecting road network, typically serving local traffic needs. Despite the confusing name, these ARE classified roads (not 'roads that couldn't be classified'). They're often narrower rural roads connecting farms and small communities, or urban roads of local importance that aren't primarily residential in nature.",
      
      "residential" -> "Roads that primarily provide access to residential properties and housing developments. These are generally low-speed with traffic calming measures, designed for local access rather than through traffic. In urban areas, they typically form the bulk of the street network within neighborhoods.",
      
      "service" -> "Roads providing access to specific services or facilities rather than serving as through routes. Examples include access to parking lots, gas stations, loading docks, businesses, or maintenance areas. They're generally lower-speed, narrower, and used only for accessing the specific service.",
      
      "motorway_link" -> "Connecting roads (slip roads, ramps, etc.) that provide access to or from motorways, or between two motorways. These typically inherit the same access restrictions as the motorways they connect to and are designed for smooth transitions between high-speed roads and other parts of the network.",
      
      "trunk_link" -> "Connecting roads that provide access to or from trunk roads. These are transition roads that allow traffic to safely enter or exit the trunk road network, often with design characteristics intermediate between trunk roads and connecting roads.",
      
      "primary_link" -> "Connecting roads that provide access to or from primary roads. These are transition segments designed to move traffic between primary roads and roads of the same or lower classification.",
      
      "secondary_link" -> "Connecting roads that provide access to or from secondary roads. These transition segments facilitate traffic flow between the secondary road network and other roads.",
      
      "tertiary_link" -> "Connecting roads that provide access to or from tertiary roads. These are less common than other link types but serve the same purpose of connecting roads of different classifications to the tertiary network.",
      
      "footway" -> "Paths primarily or exclusively for pedestrian use. These include sidewalks (when mapped separately from roads), walking paths through parks, urban walkways, and similar pedestrian infrastructure. May sometimes allow limited usage by other non-motorized users depending on local regulations.",
      
      "cycleway" -> "Paths designated primarily or exclusively for bicycle traffic. Includes dedicated cycle tracks separate from roads, bicycle lanes, and shared paths specifically designed for cycling. Physical characteristics and regulations vary by region, but all are primarily intended to serve bicycle traffic.",
      
      "path" -> "A generic non-specific path for non-motorized users. Used for ways that serve pedestrians, cyclists, horse riders, or similar users when more specific classifications don't apply. Generally not suitable for motor vehicles due to width restrictions, surface conditions, or legal prohibitions.",
      
      "pedestrian" -> "Areas or roads primarily or exclusively for pedestrian use, typically with motor vehicle access heavily restricted or prohibited. Commonly used for pedestrianized streets, plazas, or malls in commercial districts where pedestrian traffic dominates.",
      
      "track" -> "Roads primarily for agricultural, forestry, or similar access to undeveloped land. Often unpaved with varying surface quality (dirt, gravel, grass). While sometimes accessible to regular vehicles, their primary purpose is for access to natural or agricultural areas rather than general transportation.",
      
      "steps" -> "A path consisting of one or more flights of steps to facilitate pedestrian movement, often in areas with steep gradients. Not navigable by wheeled vehicles and generally requiring explicit tagging of step count or incline for accessibility routing."
    )
    
    // Default description for way types not in the map
    val defaultDescription = "Road or path type not specifically categorized in the common OpenStreetMap classification scheme."
    
    db.run(streetEdgeTable.getStreetTypes()).map { wayTypeCounts =>
      // Transform to StreetTypeForApi objects with descriptions
      wayTypeCounts.map { case (wayType, count) =>
        StreetTypeForApi(
          name = wayType,
          description = wayTypeDescriptions.getOrElse(wayType, defaultDescription),
          count = count
        )
      }
    }
  }

  /**
   * Retrieves validation data based on the provided filters and returns them as a reactive stream source.
   *
   * @param filters   The filters to apply when retrieving validations. These filters determine
   *                  which validations are included in the result.
   * @param batchSize The number of records to fetch in each batch from the database.
   * @return          A reactive stream source that emits ValidationDataForApi objects.
   */
  def getValidations(
      filters: ValidationFiltersForApi,
      batchSize: Int
  ): Source[ValidationDataForApi, _] = {
    Source.fromPublisher(db.stream(
      labelValidationTable.getValidationsForApi(filters)
        .result
        .transactionally.withStatementParameters(fetchSize = batchSize)
    )).map(labelValidationTable.tupleToValidationDataForApi)
  }

  /**
   * Retrieves all validation result types with their counts.
   * 
   * @return A future containing a sequence of ValidationResultTypeForApi objects
   */
  def getValidationResultTypes(): Future[Seq[ValidationResultTypeForApi]] = {
    db.run(labelValidationTable.getValidationResultTypes)
  }
}
