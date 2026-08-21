package formats.json

import formats.json.LabelFormats.labelForLabelMapToGeoJson
import models.label.LabelForLabelMap
import models.validation.ValidationOption
import org.scalatestplus.play.PlaySpec
import play.api.libs.json.{JsNull, JsObject}

/**
 * Pure JSON-contract tests for `LabelFormats.labelForLabelMapToGeoJson`, the per-feature serializer behind both label
 * map feeds (#3932). The two feeds publish different property sets from the same function, so each set is asserted
 * exactly: adding, dropping, or misspelling a key silently breaks the paint expressions and sidebar filters that
 * `/labelMap` and `/admin/label-map` render from.
 *
 * Needs no database — `RouteAuthPostureSpec` covers the public set end to end over HTTP where one is available.
 */
class LabelFormatsSpec extends PlaySpec {

  /** Every property key `/labels/all` publishes per feature. */
  private val PublicProperties: Set[String] = Set("label_id", "label_type", "severity", "correct", "has_validations",
    "ai_validation", "expired", "has_backup", "high_quality_user", "ai_generated", "tags")

  /** `/adminapi/labels/all` publishes the public set plus these two. */
  private val AdminOnlyProperties: Set[String] = Set("audit_task_id", "has_admin_validation")

  private val label = LabelForLabelMap(
    labelId = 42, auditTaskId = 7, labelType = "CurbRamp", lat = 47.6062, lng = -122.3321, correct = Some(true),
    hasValidations = true, hasAdminValidation = true, aiValidation = Some(ValidationOption.Agree), expired = false,
    hasBackup = true, highQualityUser = true, severity = Some(3), tags = List("missing tactile warning"),
    aiGenerated = false
  )

  private def propertiesOf(feature: JsObject): JsObject = (feature \ "properties").as[JsObject]

  "labelForLabelMapToGeoJson" should {
    "publish exactly the public property set when admin is false" in {
      propertiesOf(labelForLabelMapToGeoJson(label, admin = false)).keys mustBe PublicProperties
    }

    "publish exactly the public set plus the admin-only properties when admin is true" in {
      propertiesOf(labelForLabelMapToGeoJson(label, admin = true)).keys mustBe
        (PublicProperties ++ AdminOnlyProperties)
    }

    "carry identical shared property values in both variants" in {
      val public = propertiesOf(labelForLabelMapToGeoJson(label, admin = false))
      val admin  = propertiesOf(labelForLabelMapToGeoJson(label, admin = true))
      PublicProperties.foreach(key => (admin \ key).get mustBe (public \ key).get)
      succeed
    }

    "populate the admin-only properties from the label" in {
      val properties = propertiesOf(labelForLabelMapToGeoJson(label, admin = true))
      (properties \ "audit_task_id").as[Int] mustBe 7
      (properties \ "has_admin_validation").as[Boolean] mustBe true
    }

    // GeoJSON orders coordinates lng-then-lat, the opposite of how the label carries them, so it is easy to flip.
    "emit a Point geometry with lng before lat" in {
      val feature = labelForLabelMapToGeoJson(label, admin = false)
      (feature \ "type").as[String] mustBe "Feature"
      (feature \ "geometry" \ "type").as[String] mustBe "Point"
      (feature \ "geometry" \ "coordinates").as[Seq[Double]] mustBe Seq(-122.3321, 47.6062)
    }

    // The sidebar filter reads ai_validation as a string; the raw Enumeration value would serialize as its numeric id.
    "render ai_validation as its name" in {
      (propertiesOf(labelForLabelMapToGeoJson(label, admin = false)) \ "ai_validation").as[String] mustBe
        ValidationOption.Agree.toString
    }

    // MapSidebarFilter distinguishes "no AI validation" from "not validated correct", so the key must survive as null
    // rather than vanishing from the feature.
    "keep nullable properties present as null rather than omitting them" in {
      val bare       = label.copy(aiValidation = None, severity = None, correct = None)
      val properties = propertiesOf(labelForLabelMapToGeoJson(bare, admin = false))
      properties.keys mustBe PublicProperties
      (properties \ "ai_validation").get mustBe JsNull
      (properties \ "severity").get mustBe JsNull
      (properties \ "correct").get mustBe JsNull
    }

    "render tags as an array, empty when the label has none" in {
      (propertiesOf(labelForLabelMapToGeoJson(label, admin = false)) \ "tags").as[Seq[String]] mustBe
        Seq("missing tactile warning")
      (propertiesOf(labelForLabelMapToGeoJson(label.copy(tags = List()), admin = false)) \ "tags")
        .as[Seq[String]] mustBe empty
    }
  }
}
