package controllers.api

import models.utils.{LatLngBBox, MapParams}
import org.scalatestplus.play.PlaySpec

/**
 * Unit tests for the pure geo-filter helpers on the BaseApiController companion object.
 *
 * These functions contain the shared precedence logic used by LabelApiController,
 * LabelClustersApiController, and StreetsApiController. Testing them directly (without any DI or DB)
 * keeps the tests fast and makes regressions easy to pinpoint.
 */
class BaseApiControllerSpec extends PlaySpec {

  private val cityParams = MapParams(centerLat = 47.6, centerLng = -122.35, zoom = 12,
                                     lat1 = 47.5, lng1 = -122.45, lat2 = 47.7, lng2 = -122.25)
  private val explicitBox = LatLngBBox(minLng = -1.0, minLat = -1.0, maxLng = 1.0, maxLat = 1.0)

  "BaseApiController.validateBBoxParam" should {
    "return None when bbox is absent" in {
      BaseApiController.validateBBoxParam(None, None) mustBe None
    }
    "return None when bbox is present and successfully parsed" in {
      BaseApiController.validateBBoxParam(Some("0,0,1,1"), Some(explicitBox)) mustBe None
    }
    "return an ApiError(parameter=bbox) when bbox is present but failed to parse" in {
      val err = BaseApiController.validateBBoxParam(Some("not-a-bbox"), None)
      err mustBe defined
      err.get.parameter mustBe Some("bbox")
    }
  }

  "BaseApiController.validateRegionId" should {
    "return None when regionId is absent" in {
      BaseApiController.validateRegionId(None) mustBe None
    }
    "return None when regionId is a positive integer" in {
      BaseApiController.validateRegionId(Some(1)) mustBe None
      BaseApiController.validateRegionId(Some(99999)) mustBe None
    }
    "return an ApiError(parameter=regionId) when regionId is zero" in {
      val err = BaseApiController.validateRegionId(Some(0))
      err mustBe defined
      err.get.parameter mustBe Some("regionId")
    }
    "return an ApiError(parameter=regionId) when regionId is negative" in {
      val err = BaseApiController.validateRegionId(Some(-5))
      err mustBe defined
      err.get.parameter mustBe Some("regionId")
    }
  }

  "BaseApiController.resolveGeoFilters" should {
    "use the explicit bbox and ignore region filters when bbox is valid" in {
      val (bbox, rid, rname) = BaseApiController.resolveGeoFilters(
        Some("..."), Some(explicitBox), Some(1), Some("Seattle"), cityParams)
      bbox mustBe Some(explicitBox)
      rid mustBe None   // regionId discarded: bbox wins
      rname mustBe None // regionName discarded: bbox wins
    }

    "pass regionId through and clear regionName when only regionId is supplied" in {
      val (bbox, rid, rname) = BaseApiController.resolveGeoFilters(
        None, None, Some(5), Some("Seattle"), cityParams)
      bbox mustBe None
      rid mustBe Some(5)
      rname mustBe None // regionId takes precedence over regionName
    }

    "pass regionName through when only regionName is supplied" in {
      val (bbox, rid, rname) = BaseApiController.resolveGeoFilters(
        None, None, None, Some("Seattle"), cityParams)
      bbox mustBe None
      rid mustBe None
      rname mustBe Some("Seattle")
    }

    "fall back to the city-default bbox when no filter is provided" in {
      val (bbox, rid, rname) = BaseApiController.resolveGeoFilters(
        None, None, None, None, cityParams)
      rid mustBe None
      rname mustBe None
      bbox mustBe defined
      // Default box uses min/max of the two city corner params.
      bbox.get.minLng mustBe Math.min(cityParams.lng1, cityParams.lng2)
      bbox.get.maxLng mustBe Math.max(cityParams.lng1, cityParams.lng2)
      bbox.get.minLat mustBe Math.min(cityParams.lat1, cityParams.lat2)
      bbox.get.maxLat mustBe Math.max(cityParams.lat1, cityParams.lat2)
    }
  }

  "BaseApiController.parseCommaSeparated" should {
    "return None when the parameter is absent" in {
      BaseApiController.parseCommaSeparated(None) mustBe None
    }
    "split a single value into a one-element Seq" in {
      BaseApiController.parseCommaSeparated(Some("CurbRamp")) mustBe Some(Seq("CurbRamp"))
    }
    "split and trim a comma-separated list" in {
      BaseApiController.parseCommaSeparated(Some("CurbRamp, NoCurbRamp , Obstacle")) mustBe
        Some(Seq("CurbRamp", "NoCurbRamp", "Obstacle"))
    }
  }
}
