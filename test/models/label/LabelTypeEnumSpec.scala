package models.label

import models.label.LabelTypeEnum.{AccessImpact, RatingScale}
import org.scalatestplus.play.PlaySpec
import play.api.libs.json.{JsObject, Json}

import java.io.File

/**
 * Pure unit tests for the label-type enum's derived and declared properties. No app boot or DB required.
 *
 * These pin domain facts that feature code depends on: the access-impact bucketing drives share copy and severity
 * interpretation (positive access features and problems read severity in opposite directions), `nameKey` must track
 * `descriptionKey`, and the icon files must exist on disk because share-image compositing loads them by convention.
 */
class LabelTypeEnumSpec extends PlaySpec {

  "accessImpact" should {
    "put every label type in the right bucket" in {
      // A type in the wrong bucket silently inverts share copy and every severity interpretation built on this.
      LabelTypeEnum.values.filter(_.accessImpact == AccessImpact.Problem) mustBe Set(
        LabelTypeEnum.NoCurbRamp,
        LabelTypeEnum.Obstacle,
        LabelTypeEnum.SurfaceProblem,
        LabelTypeEnum.NoSidewalk
      )
      LabelTypeEnum.values.filter(_.accessImpact == AccessImpact.Feature) mustBe Set(
        LabelTypeEnum.CurbRamp,
        LabelTypeEnum.Crosswalk,
        LabelTypeEnum.Signal
      )
      LabelTypeEnum.values.filter(_.accessImpact == AccessImpact.Neutral) mustBe Set(
        LabelTypeEnum.Occlusion,
        LabelTypeEnum.Other
      )
    }

    "publish a distinct name per bucket, since clients match on those strings" in {
      val impacts = Seq(AccessImpact.Problem, AccessImpact.Feature, AccessImpact.Neutral)
      impacts.map(_.name) mustBe Seq("problem", "feature", "neutral")
    }
  }

  "ratingScale" should {
    "put every label type on the right scale" in {
      LabelTypeEnum.values.filter(_.ratingScale == RatingScale.Quality) mustBe Set(
        LabelTypeEnum.CurbRamp,
        LabelTypeEnum.Crosswalk
      )
      LabelTypeEnum.values.filter(_.ratingScale == RatingScale.Severity) mustBe Set(
        LabelTypeEnum.NoCurbRamp,
        LabelTypeEnum.Obstacle,
        LabelTypeEnum.SurfaceProblem,
        LabelTypeEnum.Other
      )
      LabelTypeEnum.values.filter(_.ratingScale == RatingScale.Unrated) mustBe Set(
        LabelTypeEnum.Signal,
        LabelTypeEnum.NoSidewalk,
        LabelTypeEnum.Occlusion
      )
    }

    "publish a distinct name per scale, since clients match on those strings" in {
      Seq(RatingScale.Quality, RatingScale.Severity, RatingScale.Unrated).map(_.name) mustBe
        Seq("quality", "severity", "unrated")
    }

    "only ever be Quality on an access feature" in {
      // The two axes are otherwise independent — Other is Neutral but rated, NoSidewalk a Problem but unrated — but
      // "1 is good" only makes sense for something whose presence helps. A Problem on the quality scale would read
      // its own severity backwards.
      for (lt <- LabelTypeEnum.values if lt.ratingScale == RatingScale.Quality) {
        withClue(s"${lt.name}: ") { lt.accessImpact mustBe AccessImpact.Feature }
      }
    }
  }

  "staticValidatableLabelTypes" should {
    "be the primary types minus Signal" in {
      // Signal is labeled at the base of its pole, so judging it needs a pan upward that a static image (the
      // landing-page validation grid, #1638) can't provide.
      LabelTypeEnum.staticValidatableLabelTypes mustBe LabelTypeEnum.primaryLabelTypes - LabelTypeEnum.Signal
      LabelTypeEnum.staticValidatableLabelTypes must not contain LabelTypeEnum.Signal
    }
  }

  "nameKey" should {
    "be the descriptionKey without its .description suffix for every label type" in {
      for (lt <- LabelTypeEnum.values) {
        lt.nameKey mustBe lt.descriptionKey.stripSuffix(".description")
        lt.descriptionKey mustBe s"${lt.nameKey}.description"
      }
    }
  }

  "label type icons" should {
    "exist on disk in every variant for every label type" in {
      // A missing file degrades silently — a markerless share preview, a broken chip — so pin every variant. The
      // paths are logical (under public/), which is what makes this check a plain file lookup.
      for (lt <- LabelTypeEnum.values) {
        for (path <- Seq(lt.iconPath, lt.smallIconPath, lt.tinyIconPath, lt.smallIconSvgPath)) {
          val icon = new File(s"public/$path")
          assert(icon.exists(), s"missing icon for ${lt.name}: ${icon.getPath}")
        }
      }
    }

    "publish API URLs that are the logical path under /assets/, un-fingerprinted" in {
      // A consumer that stores an icon_url expects it to survive our next deploy, so these deliberately skip the
      // content-hashed name our own pages use.
      LabelTypeEnum.CurbRamp.iconUrl mustBe "/assets/images/icons/label_type_icons/CurbRamp.png"
      LabelTypeEnum.CurbRamp.smallIconUrl mustBe "/assets/images/icons/label_type_icons/CurbRamp_small.png"
      LabelTypeEnum.CurbRamp.tinyIconUrl mustBe "/assets/images/icons/label_type_icons/CurbRamp_tiny.png"
    }
  }

  "the page stamp" should {
    "match the fixture the jsdom suite builds util.misc from" in {
      // test/js/loadGlobalScript.js stamps that fixture as window.labelTypes. If it stops matching what the pages
      // actually stamp, the JS suite is testing a table no browser ever sees — so fail here instead, with the diff.
      val fixture = Json.parse(new File("test/resources/label-types-stamp.json").toURI.toURL.openStream())
      Json.parse(LabelTypeEnum.pageStampJson) mustBe fixture
    }

    "carry every label type, in canonical order" in {
      Json.parse(LabelTypeEnum.pageStampJson).as[Seq[JsObject]].map(t => (t \ "name").as[String]) mustBe
        LabelTypeEnum.orderedNames
    }
  }
}
