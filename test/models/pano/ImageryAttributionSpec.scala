package models.pano

import org.scalatestplus.play.PlaySpec
import play.api.libs.json.{JsNull, JsObject, Json}

/** The attribution owed for imagery Project Sidewalk shows a copy of (#4865). Pure. */
class ImageryAttributionSpec extends PlaySpec {

  "ImageryAttribution.line" should {
    "credit a Mapillary contributor with the provider and the CC BY-SA licence" in {
      val line = ImageryAttribution.line(PanoSource.Mapillary, Some("jacobwhall"), None).value
      line.holder mustBe "© jacobwhall"
      line.provider mustBe Some("Mapillary")
      line.license mustBe Some(ImageryAttribution.MapillaryLicense)
      line.licenseUrl mustBe Some(ImageryAttribution.MapillaryLicenseUrl)
      line.text mustBe "© jacobwhall · Mapillary · CC BY-SA 4.0"
    }

    "pass a provider's own copyright string through unchanged" in {
      val line = ImageryAttribution.line(PanoSource.Gsv, Some("© 2025 Google"), None).value
      line mustBe ImageryAttribution.Line("© 2025 Google", None, None, None)
      line.text mustBe "© 2025 Google"
      ImageryAttribution.line(PanoSource.Infra3d, Some("City of Zurich and iNovitas AG"), None).value.text mustBe
        "City of Zurich and iNovitas AG"
    }

    "credit Mapillary under its licence when no contributor is recorded, since both follow from the source" in {
      val expected = ImageryAttribution.Line(
        "Mapillary",
        None,
        Some(ImageryAttribution.MapillaryLicense),
        Some(ImageryAttribution.MapillaryLicenseUrl)
      )
      ImageryAttribution.line(PanoSource.Mapillary, None, None).value mustBe expected
      ImageryAttribution.line(PanoSource.Mapillary, Some("  "), None).value mustBe expected
      expected.text mustBe "Mapillary · CC BY-SA 4.0"
    }

    "name a Panoramax picture's own licence, since its contributor picks one per picture (#5202)" in {
      val line = ImageryAttribution.line(PanoSource.Panoramax, Some("Arretche"), Some("CC-BY-SA-4.0")).value
      line mustBe ImageryAttribution.Line(
        "© Arretche",
        Some("Panoramax"),
        Some("CC BY-SA 4.0"),
        Some("https://creativecommons.org/licenses/by-sa/4.0/")
      )
      line.text mustBe "© Arretche · Panoramax · CC BY-SA 4.0"

      ImageryAttribution.line(PanoSource.Panoramax, None, Some("etalab-2.0")).value mustBe
        ImageryAttribution.Line(
          "Panoramax",
          None,
          Some("Licence Ouverte 2.0"),
          Some("https://www.etalab.gouv.fr/licence-ouverte-open-licence/")
        )
    }

    "name an unrecognized Panoramax licence verbatim rather than dropping it, since identifying it is the point" in {
      val line = ImageryAttribution.line(PanoSource.Panoramax, Some("Arretche"), Some("ODbL-1.0")).value
      line mustBe ImageryAttribution.Line("© Arretche", Some("Panoramax"), Some("ODbL-1.0"), None)
      line.text mustBe "© Arretche · Panoramax · ODbL-1.0"
    }

    "credit a Panoramax picture whose licence wasn't recorded, naming none" in {
      ImageryAttribution.line(PanoSource.Panoramax, Some("Arretche"), None).value mustBe
        ImageryAttribution.Line("© Arretche", Some("Panoramax"), None, None)
      ImageryAttribution.line(PanoSource.Panoramax, None, Some("  ")).value mustBe
        ImageryAttribution.Line("Panoramax", None, None, None)
    }

    // The AI labeler recorded the whole attribution as the copyright, so the sign, the provider and the licence each
    // appeared twice on a crop of its imagery (#5360).
    "credit a contributor once when the recorded copyright is already a whole attribution (#5360)" in {
      val wrapped = Some("© GIS_ISG / Mapillary (CC BY-SA 4.0)")
      ImageryAttribution.line(PanoSource.Mapillary, wrapped, None).value.text mustBe
        "© GIS_ISG · Mapillary · CC BY-SA 4.0"
      ImageryAttribution
        .line(PanoSource.Panoramax, Some("© Arretche / Panoramax (CC-BY-SA-4.0)"), Some("CC-BY-SA-4.0"))
        .value
        .text mustBe "© Arretche · Panoramax · CC BY-SA 4.0"
      // A wrapper naming only the provider recorded no contributor at all.
      ImageryAttribution.line(PanoSource.Mapillary, Some("© Mapillary (CC BY-SA 4.0)"), None).value.text mustBe
        "Mapillary · CC BY-SA 4.0"
    }

    "ignore a licence recorded against a source whose licence follows from the source itself" in {
      ImageryAttribution.line(PanoSource.Mapillary, Some("jacobwhall"), Some("CC-BY-4.0")).value.license mustBe
        Some(ImageryAttribution.MapillaryLicense)
      ImageryAttribution.line(PanoSource.Gsv, Some("© 2025 Google"), Some("CC-BY-4.0")).value.license mustBe None
    }

    "attribute nothing when a provider's copyright string is all that could be shown and none is recorded" in {
      ImageryAttribution.line(PanoSource.Gsv, None, None) mustBe None
      ImageryAttribution.line(PanoSource.Gsv, Some(" "), None) mustBe None
      ImageryAttribution.line(PanoSource.Infra3d, None, None) mustBe None
    }

    "serialize with the licence link the UI needs, and nulls where there is none" in {
      ImageryAttribution.line(PanoSource.Mapillary, Some("jacobwhall"), None).value.toJson mustBe Json.obj(
        "holder"      -> "© jacobwhall",
        "provider"    -> "Mapillary",
        "license"     -> "CC BY-SA 4.0",
        "license_url" -> "https://creativecommons.org/licenses/by-sa/4.0/"
      )
      ImageryAttribution.line(PanoSource.Gsv, Some("© 2025 Google"), None).value.toJson mustBe Json.obj(
        "holder"      -> "© 2025 Google",
        "provider"    -> JsNull,
        "license"     -> JsNull,
        "license_url" -> JsNull
      )
    }
  }

  "ImageryAttribution.normalizeCopyright" should {
    "reduce a Mapillary or Panoramax copyright to the contributor's bare name, however it was wrapped" in {
      val mapillary = Seq(
        "jacobwhall", "© jacobwhall", "©jacobwhall", "jacobwhall / Mapillary",
        "© jacobwhall / Mapillary (CC BY-SA 4.0)", "  © jacobwhall / Mapillary (CC BY-SA 4.0)  "
      )
      mapillary.foreach { recorded =>
        withClue(recorded) {
          ImageryAttribution.normalizeCopyright(PanoSource.Mapillary, Some(recorded)) mustBe Some("jacobwhall")
        }
      }
      ImageryAttribution.normalizeCopyright(PanoSource.Panoramax, Some("© Arretche / Panoramax (CC-BY-SA-4.0)")) mustBe
        Some("Arretche")
    }

    "read a wrapper that names only the provider, or nothing, as no contributor recorded" in {
      Seq("© Mapillary (CC BY-SA 4.0)", "Mapillary", "©", "   ").foreach { recorded =>
        withClue(recorded) {
          ImageryAttribution.normalizeCopyright(PanoSource.Mapillary, Some(recorded)) mustBe None
        }
      }
      ImageryAttribution.normalizeCopyright(PanoSource.Panoramax, Some("© Panoramax (etalab-2.0)")) mustBe None
      ImageryAttribution.normalizeCopyright(PanoSource.Mapillary, None) mustBe None
    }

    "leave a name that merely contains the provider's, or another provider's wrapper, alone" in {
      ImageryAttribution.normalizeCopyright(PanoSource.Mapillary, Some("NotMapillary")) mustBe Some("NotMapillary")
      ImageryAttribution.normalizeCopyright(PanoSource.Mapillary, Some("Ville de Paris / DSIN")) mustBe
        Some("Ville de Paris / DSIN")
      ImageryAttribution.normalizeCopyright(PanoSource.Panoramax, Some("© x / Mapillary (CC BY-SA 4.0)")) mustBe
        Some("x / Mapillary (CC BY-SA 4.0)")
    }

    "pass a provider's own copyright string through, trimmed, since the sign is part of it" in {
      ImageryAttribution.normalizeCopyright(PanoSource.Gsv, Some(" © 2025 Google ")) mustBe Some("© 2025 Google")
      ImageryAttribution.normalizeCopyright(PanoSource.Infra3d, Some("City of Zurich and iNovitas AG")) mustBe
        Some("City of Zurich and iNovitas AG")
      ImageryAttribution.normalizeCopyright(PanoSource.Gsv, Some("  ")) mustBe None
    }
  }

  "ImageryAttribution.panoramaxLicensesJson" should {
    // main.scala.html stamps this as window.panoramaxLicenses and PanoramaxViewer indexes it by identifier, so the
    // shape is a contract between the two halves of what is deliberately one table (#5202).
    "carry the whole table in the shape PanoramaxViewer looks an identifier up in" in {
      val stamped = Json.parse(ImageryAttribution.panoramaxLicensesJson)
      stamped.as[JsObject].keys mustBe ImageryAttribution.PanoramaxLicenses.keySet
      ImageryAttribution.PanoramaxLicenses.foreach { case (id, license) =>
        (stamped \ id).get mustBe Json.obj("name" -> license.name, "url" -> license.url)
      }
    }
  }
}
