package service

import com.google.inject.ImplementedBy
import controllers.ApiBBox
import controllers.ApiType.ApiType
import formats.json.ClusterFormats.{ClusterSubmission, ClusteredLabelSubmission}
import models.attribute._
import models.label._
import models.region.{Region, RegionTable}
import models.street.{StreetEdgeInfo, StreetEdgeTable}
import models.user.{UserStatApi, UserStatTable}
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
  def getAttributesInBoundingBox(apiType: ApiType, bbox: ApiBBox, severity: Option[String], batchSize: Int): Source[GlobalAttributeForApi, _]
  def getGlobalAttributesWithLabelsInBoundingBox(bbox: ApiBBox, severity: Option[String], batchSize: Int): Source[GlobalAttributeWithLabelForApi, _]
  def selectStreetsIntersecting(apiType: ApiType, bbox: ApiBBox): Future[Seq[StreetEdgeInfo]]
  def getNeighborhoodsWithin(bbox: ApiBBox): Future[Seq[Region]]
  def getAllLabelMetadata(bbox: ApiBBox, batchSize: Int): Source[LabelAllMetadata, _]
  def getLabelCVMetadata(batchSize: Int): Source[LabelCVMetadata, _]
  def getStatsForApi: Future[Seq[UserStatApi]]
  def getOverallStatsForApi(filterLowQuality: Boolean): Future[ProjectSidewalkStats]

  def getUserLabelsToCluster(userId: String): Future[Seq[LabelToCluster]]
  def getClusteredLabelsInRegion(regionId: Int): Future[Seq[LabelToCluster]]
  def getUsersToCluster: Future[Seq[String]]
  def getRegionsToCluster: Future[Seq[Int]]
  def submitSingleUserClusteringResults(userId: String, clusters: Seq[ClusterSubmission], labels: Seq[ClusteredLabelSubmission], thresholds: Map[String, Float]): Future[Int]
  def submitMultiUserClusteringResults(regionId: Int, clusters: Seq[ClusterSubmission], userAttributes: Seq[ClusteredLabelSubmission], thresholds: Map[String, Float]): Future[Int]
  def getClusteringInfo: Future[(Int, Int, Int)]
}

@Singleton
class ApiServiceImpl @Inject()(protected val dbConfigProvider: DatabaseConfigProvider,
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
                               implicit val ec: ExecutionContext
                              ) extends ApiService with HasDatabaseConfigProvider[MyPostgresProfile] {

  // Sets up streaming query to get global attributes in a bounding box.
  def getAttributesInBoundingBox(apiType: ApiType, bbox: ApiBBox, severity: Option[String], batchSize: Int): Source[GlobalAttributeForApi, _] = {
    Source.fromPublisher(db.stream(
      globalAttributeTable.getAttributesInBoundingBox(apiType, bbox, severity)
        .transactionally.withStatementParameters(fetchSize = batchSize)
    ))
  }

  // Sets up streaming query to get global attributes with their associated labels in a bounding box.
  def getGlobalAttributesWithLabelsInBoundingBox(bbox: ApiBBox, severity: Option[String], batchSize: Int): Source[GlobalAttributeWithLabelForApi, _] = {
    Source.fromPublisher(db.stream(
      globalAttributeTable.getGlobalAttributesWithLabelsInBoundingBox(bbox, severity)
        .transactionally.withStatementParameters(fetchSize = batchSize)
    ))
  }

  def selectStreetsIntersecting(apiType: ApiType, bbox: ApiBBox): Future[Seq[StreetEdgeInfo]] =
    db.run(streetEdgeTable.selectStreetsIntersecting(apiType, bbox))

  def getNeighborhoodsWithin(bbox: ApiBBox): Future[Seq[Region]] =
    db.run(regionTable.getNeighborhoodsWithin(bbox))

  def getAllLabelMetadata(bbox: ApiBBox, batchSize: Int): Source[LabelAllMetadata, _] = {
    Source.fromPublisher(db.stream(
      labelTable.getAllLabelMetadata(bbox)
        .transactionally.withStatementParameters(fetchSize = batchSize)
    ))
  }

  def getLabelCVMetadata(batchSize: Int): Source[LabelCVMetadata, _] = {
    Source.fromPublisher(db.stream(
      labelTable.getLabelCVMetadata
        .transactionally.withStatementParameters(fetchSize = batchSize)
    ).mapResult(LabelCVMetadata.tupled))
  }

  def getStatsForApi: Future[Seq[UserStatApi]] = db.run(userStatTable.getStatsForApi)

  def getOverallStatsForApi(filterLowQuality: Boolean): Future[ProjectSidewalkStats] = {
    // Get city launch date and avg timestamp from last 100 labels to include in the query results.
    val cityId: String = config.get[String]("city-id")
    val launchDate: String = config.get[String](s"city-params.launch-date.$cityId")
    db.run(labelTable.recentLabelsAvgLabelDate(100)).map { avgLabelDate =>
      db.run(labelTable.getOverallStatsForApi(filterLowQuality, launchDate, avgLabelDate))
    }.flatten
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
      _ <- userClusteringSessionTable.deleteUserClusteringSessions(usersToUpdate)
    } yield usersToUpdate).transactionally)
  }

  def getRegionsToCluster: Future[Seq[Int]] = {
    db.run(for {
      // Get the list of neighborhoods that need to be updated because the underlying users' clusters changed.
      regionIds: Seq[Int] <- globalClusteringSessionTable.getNeighborhoodsToReCluster
      // Delete the data for those regions.
      _ <- globalClusteringSessionTable.deleteGlobalClusteringSessions(regionIds)
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
  def submitSingleUserClusteringResults(userId: String, clusters: Seq[ClusterSubmission], labels: Seq[ClusteredLabelSubmission], thresholds: Map[String, Float]): Future[Int] = {
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
      userAttrIdsMap: Map[Int, Int] = clusters.zip(userAttrIds).map { case (c, attrId) => (c.clusterNum, attrId) }.toMap

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
  def submitMultiUserClusteringResults(regionId: Int, clusters: Seq[ClusterSubmission], userAttributes: Seq[ClusteredLabelSubmission], thresholds: Map[String, Float]): Future[Int] = {
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
      globalAttrIds: Seq[Int] <- globalAttributeTable.saveMultiple(globalAttributes)

      // Map clusters to their new globalAttributeId.
      globalAttrIdsMap: Map[Int, Int] = clusters.zip(globalAttrIds).map { case (c, attrId) => (c.clusterNum, attrId) }.toMap

      // Add all the associated labels to the global_attribute_user_attribute table.
      globalAttrUserAttrs: Seq[GlobalAttributeUserAttribute] = userAttributes.map { userAttribute =>
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
}
