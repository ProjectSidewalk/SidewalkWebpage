package models.label

import org.scalatestplus.play.PlaySpec

import java.io.File

/**
 * Pure unit tests for the label-type enum's derived and declared properties. No app boot or DB required.
 *
 * These pin domain facts that feature code depends on: the issue/feature split drives share copy and severity
 * interpretation (positive access features and problems read severity in opposite directions), `nameKey` must track
 * `descriptionKey`, and the icon files must exist on disk because share-image compositing loads them by convention.
 */
class LabelTypeEnumSpec extends PlaySpec {

  "isAccessProblem" should {
    "be true for exactly the accessibility-problem label types" in {
      val issueTypes = LabelTypeEnum.values.filter(_.isAccessProblem)
      issueTypes mustBe Set(
        LabelTypeEnum.NoCurbRamp, LabelTypeEnum.Obstacle, LabelTypeEnum.SurfaceProblem, LabelTypeEnum.NoSidewalk,
        LabelTypeEnum.Problem
      )
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
    "exist on disk in all three sizes for every valid label type" in {
      // Share-image compositing resolves public/images/icons/label_type_icons/<name>_small.png (the colored marker)
      // by convention, and the enum exposes paths for all three sizes; a missing file degrades silently to a
      // markerless preview, so pin the convention here. The internal-only Problem type (excluded from
      // validLabelTypes) ships no icons, matching its lack of a name message key.
      for (lt <- LabelTypeEnum.values if LabelTypeEnum.validLabelTypes.contains(lt.name)) {
        for (suffix <- Seq("", "_small", "_tiny")) {
          val icon = new File(s"public/images/icons/label_type_icons/${lt.name}$suffix.png")
          assert(icon.exists(), s"missing icon for ${lt.name}: ${icon.getPath}")
        }
      }
    }
  }
}
