package service

import models.utils.AssetInventory
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder

/**
 * The asset-digest manifest behind `util.assetPath` (#4893): the pure digest extraction, and the inventory the build
 * generates from `assetManifestPrefixes` in build.sbt.
 *
 * `AssetsFinder.path` never throws on an asset that isn't there — it hands back the plain path — so a wrong logical
 * path can't fail loudly at runtime. Nothing catches it later either: `util.assetPath` falls back to that same plain
 * path, and the asset loads. The inventory is therefore the only place a renamed or moved asset family can be caught,
 * which is what the sorted/sentinel checks below are for.
 *
 * The app-booting half requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env,
 * as in dev/CI).
 */
class AssetManifestServiceSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .build()

  private val md5 = "0123456789abcdef0123456789abcdef"

  "digestOf" should {
    "read the digest off a fingerprinted resolution of the same file" in {
      AssetManifestService.digestOf("images/icons/openhand.cur", s"/assets/images/icons/$md5-openhand.cur") mustBe
        Some(md5)
    }

    "return None for an unfingerprinted resolution, which is what dev mode hands back" in {
      AssetManifestService.digestOf("images/icons/openhand.cur", "/assets/images/icons/openhand.cur") mustBe None
    }

    "return None when the digest-prefixed name is a different file" in {
      // Otherwise a coincidence in the pipeline's output would point util.assetPath at an asset that doesn't exist.
      AssetManifestService.digestOf("images/icons/openhand.cur", s"/assets/images/icons/$md5-closedhand.cur") mustBe
        None
    }

    "return None for a prefix that only looks like an md5" in {
      val short = md5.dropRight(1)
      val long  = s"${md5}f"
      AssetManifestService.digestOf("images/a.png", s"/assets/images/$short-a.png") mustBe None
      AssetManifestService.digestOf("images/a.png", s"/assets/images/$long-a.png") mustBe None
      AssetManifestService.digestOf("images/a.png", s"/assets/images/${md5.toUpperCase}-a.png") mustBe None
    }

    "handle a path with no directory component" in {
      AssetManifestService.digestOf("favicon.png", s"/assets/$md5-favicon.png") mustBe Some(md5)
    }
  }

  "The generated asset inventory" should {
    "be non-empty and sorted, so the generated source only changes when the asset tree does" in {
      AssetInventory.paths must not be empty
      AssetInventory.paths mustBe AssetInventory.paths.sorted
      AssetInventory.paths.distinct.size mustBe AssetInventory.paths.size
    }

    "carry the asset families JS builds URLs for" in {
      // One sentinel per family that would go un-fingerprinted, and unnoticed, if a prefix stopped matching.
      Seq(
        "audio/success.mp3", "images/icons/openhand.cur", "images/icons/label_type_icons/CurbRamp_small.svg",
        "images/badges/badge_labels_badge1.png", "images/examples/tags/placeholder.png",
        "images/explore/onboarding/TutorialMiniMap.jpg", "images/logos/google-logo.svg",
        "images/pano-tutorial/tutorial/1-0-0.jpg", "images/tutorials/explore-crosswalk-incorrect-1.png",
        "images/validate/ExpertValidateTooltips/CommonUnsure1.png"
      ).foreach(path => withClue(s"$path missing from the inventory: ")(AssetInventory.paths must contain(path)))
    }

    "hold only real assets — no dotfiles, and nothing already carrying a digest prefix" in {
      val basenames = AssetInventory.paths.map(path => path.substring(path.lastIndexOf('/') + 1))
      basenames.filter(_.startsWith(".")) mustBe empty
      // A file whose own name began `<32 hex>-` would make digestOf's match ambiguous, so pin that none does.
      basenames.filter(_.matches("^[0-9a-f]{32}-.*")) mustBe empty
    }
  }

  "The digest map the layout stamps" should {
    "only ever name assets the inventory knows about" in {
      val digests = app.injector.instanceOf[AssetManifestService].assetDigests
      digests.keySet.diff(AssetInventory.paths.toSet) mustBe empty
    }

    "be empty in dev/test mode, where the build produces no digests" in {
      // Pins the fallback path: with no stamp entries, every util.assetPath call returns the plain /assets/ URL, so
      // dev serves assets exactly as staging does minus the fingerprint, and no dev map can mask a broken digest.
      app.injector.instanceOf[AssetManifestService].assetDigests mustBe empty
    }
  }
}
