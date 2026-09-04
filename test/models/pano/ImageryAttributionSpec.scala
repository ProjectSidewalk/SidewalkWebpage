package models.pano

import org.scalatestplus.play.PlaySpec
import play.api.libs.json.{JsNull, Json}

/** The attribution owed for imagery Project Sidewalk shows a copy of (#4865). Pure. */
class ImageryAttributionSpec extends PlaySpec {

  "ImageryAttribution.line" should {
    "credit a Mapillary contributor with the provider and the CC BY-SA licence" in {
      val line = ImageryAttribution.line(PanoSource.Mapillary, Some("jacobwhall")).value
      line.holder mustBe "© jacobwhall"
      line.provider mustBe Some("Mapillary")
      line.license mustBe Some(ImageryAttribution.MapillaryLicense)
      line.licenseUrl mustBe Some(ImageryAttribution.MapillaryLicenseUrl)
      line.text mustBe "© jacobwhall · Mapillary · CC BY-SA 4.0"
    }

    "pass a provider's own copyright string through unchanged" in {
      val line = ImageryAttribution.line(PanoSource.Gsv, Some("© 2025 Google")).value
      line mustBe ImageryAttribution.Line("© 2025 Google", None, None, None)
      line.text mustBe "© 2025 Google"
      ImageryAttribution.line(PanoSource.Infra3d, Some("City of Zurich and iNovitas AG")).value.text mustBe
        "City of Zurich and iNovitas AG"
    }

    "credit Mapillary under its licence when no contributor is recorded, since both follow from the source" in {
      val expected = ImageryAttribution.Line(
        "Mapillary",
        None,
        Some(ImageryAttribution.MapillaryLicense),
        Some(ImageryAttribution.MapillaryLicenseUrl)
      )
      ImageryAttribution.line(PanoSource.Mapillary, None).value mustBe expected
      ImageryAttribution.line(PanoSource.Mapillary, Some("  ")).value mustBe expected
      expected.text mustBe "Mapillary · CC BY-SA 4.0"
    }

    "attribute nothing when a provider's copyright string is all that could be shown and none is recorded" in {
      ImageryAttribution.line(PanoSource.Gsv, None) mustBe None
      ImageryAttribution.line(PanoSource.Gsv, Some(" ")) mustBe None
      ImageryAttribution.line(PanoSource.Infra3d, None) mustBe None
    }

    "serialize with the licence link the UI needs, and nulls where there is none" in {
      ImageryAttribution.line(PanoSource.Mapillary, Some("jacobwhall")).value.toJson mustBe Json.obj(
        "holder"      -> "© jacobwhall",
        "provider"    -> "Mapillary",
        "license"     -> "CC BY-SA 4.0",
        "license_url" -> "https://creativecommons.org/licenses/by-sa/4.0/"
      )
      ImageryAttribution.line(PanoSource.Gsv, Some("© 2025 Google")).value.toJson mustBe Json.obj(
        "holder"      -> "© 2025 Google",
        "provider"    -> JsNull,
        "license"     -> JsNull,
        "license_url" -> JsNull
      )
    }
  }
}
