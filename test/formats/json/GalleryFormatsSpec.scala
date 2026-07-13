package formats.json

import formats.json.GalleryFormats._
import formats.json.ValidateFormats.uiSourceReads
import models.utils.CommonUtils.UiSource
import org.scalatestplus.play.PlaySpec
import play.api.libs.json.{JsBoolean, JsError, JsString, JsSuccess, Json}

/**
 * Pure JSON-contract tests for the Gallery label-request reads and the UiSource wire format, covering the pieces the
 * landing-page validation grid (#1638) depends on: the optional `sort` field and the `LandingPage` source value.
 */
class GalleryFormatsSpec extends PlaySpec {

  // The two required fields; everything else in GalleryLabelsRequest is optional.
  private val baseRequest = Json.obj("n" -> 14, "loaded_labels" -> Json.arr())

  "galleryLabelsRequestReads" should {
    "parse sort when present" in {
      val result = (baseRequest + ("sort" -> JsString("recent"))).validate[GalleryLabelsRequest]
      result.map(_.sort) mustBe JsSuccess(Some("recent"))
    }

    "leave sort as None when absent" in {
      baseRequest.validate[GalleryLabelsRequest].map(_.sort) mustBe JsSuccess(None)
    }

    "reject a non-string sort" in {
      (baseRequest + ("sort" -> Json.obj())).validate[GalleryLabelsRequest] mustBe a[JsError]
    }

    "parse static_imagery_only when present" in {
      val result = (baseRequest + ("static_imagery_only" -> JsBoolean(true))).validate[GalleryLabelsRequest]
      result.map(_.staticImageryOnly) mustBe JsSuccess(Some(true))
    }

    "leave static_imagery_only as None when absent" in {
      baseRequest.validate[GalleryLabelsRequest].map(_.staticImageryOnly) mustBe JsSuccess(None)
    }
  }

  "uiSourceReads" should {
    "accept the landing-page validation grid's source" in {
      JsString("LandingPage").validate[UiSource.UiSource] mustBe JsSuccess(UiSource.LandingPage)
    }

    "reject an unknown source" in {
      JsString("NotARealSource").validate[UiSource.UiSource] mustBe a[JsError]
    }
  }
}
