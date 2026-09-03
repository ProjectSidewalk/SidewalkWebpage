package service

import controllers.AssetsFinder
import models.utils.AssetInventory
import play.twirl.api.Html
import views.ViewHelpers

import javax.inject.{Inject, Singleton}

/**
 * The content-fingerprint digests of the assets whose URLs frontend JS builds at runtime (#4893).
 *
 * Twirl gets fingerprinted URLs from `assets.path(...)`, which are cached `immutable` for a year; a plain
 * `/assets/...` string gets the one-hour default instead, costing a conditional GET per asset per hour and delaying a
 * swapped file's arrival by up to that hour. `main.scala.html` stamps this map onto every page as
 * `window.assetDigests`, and `util.assetPath` reconstructs the fingerprinted URL from it.
 *
 * Computed once per process: the digests are a property of the build, and the asset files never change under a
 * running instance.
 *
 * @param assets Play's resolver for fingerprinted asset URLs — the same one Twirl templates use.
 */
@Singleton
class AssetManifestService @Inject() (assets: AssetsFinder) {

  /**
   * Logical path -> md5, for every inventoried asset the build actually fingerprinted.
   *
   * Empty under dev-mode `sbt run`, which builds no digests: every lookup then misses and `util.assetPath` falls back
   * to the plain `/assets/<path>`, exactly what the hardcoded URLs did before.
   */
  val assetDigests: Map[String, String] = AssetInventory.paths.flatMap { logicalPath =>
    AssetManifestService.digestOf(logicalPath, assets.path(logicalPath)).map(logicalPath -> _)
  }.toMap

  /**
   * The same map serialized for `main.scala.html`'s inline `<script>`, so every HTML response reuses one string.
   *
   * Serializing is the only per-render work the stamp would otherwise cost, and it is pure repetition: several
   * hundred entries, identical on every page of every response, for a map that cannot change while the process runs.
   */
  val assetDigestsJson: Html = ViewHelpers.jsonForScript(assetDigests)
}

/** The pure half of [[AssetManifestService]], so the digest-extraction contract is testable without booting an app. */
object AssetManifestService {

  /** sbt-digest names a fingerprinted copy `<md5>-<original name>`, beside the original in the same directory. */
  private val Fingerprinted = """^([0-9a-f]{32})-(.+)$""".r

  /**
   * Extracts the content digest an asset's URL was fingerprinted with, if it was.
   *
   * @param logicalPath  The asset's path under `public/`, e.g. `images/icons/openhand.cur`.
   * @param resolvedPath What `AssetsFinder.path` returned for it, e.g. `/assets/images/icons/<md5>-openhand.cur`.
   * @return             The 32-character md5, or `None` when the resolution isn't a fingerprint of this exact file —
   *                     dev mode (no digests built), an asset the pipeline skipped, or a name that only looks
   *                     fingerprinted.
   */
  def digestOf(logicalPath: String, resolvedPath: String): Option[String] = {
    val basename = logicalPath.substring(logicalPath.lastIndexOf('/') + 1)
    resolvedPath.substring(resolvedPath.lastIndexOf('/') + 1) match {
      case Fingerprinted(digest, name) if name == basename => Some(digest)
      case _                                               => None
    }
  }
}
