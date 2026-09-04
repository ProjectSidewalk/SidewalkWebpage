import java.security.MessageDigest

import scala.collection.mutable
import scala.util.matching.Regex

import com.typesafe.sbt.web.PathMapping
import sbt._

/**
 * An asset-pipeline stage that points every `url(...)` in a CSS asset at sbt-digest's fingerprinted copy (#5094).
 *
 * A stylesheet offers no interpolation point for either mechanism that fingerprints everything else — `assets.path`
 * needs a Twirl template, `util.assetPath` the digest map stamped onto the page — so the rewrite happens at build
 * time. The name comes from the file's own bytes (`<md5>-<name>`, all sbt-digest does), so nothing here coordinates
 * with the plugin, and a relative URL stays relative because the digested copy sits in the original's directory.
 *
 * '''Order matters: this belongs before `digest` in `pipelineStages`.''' Running first folds each referenced asset's
 * digest into the referring stylesheet's own, so a change to either gives the stylesheet a new URL. Reversed, a
 * stylesheet's fingerprint covers only its pre-rewrite text, so swapping a font leaves the CSS naming it at an
 * unchanged, year-cached URL pointing at a path the new build lacks.
 *
 * Reference-driven rather than digest-everything-then-look-up: it hashes only the ~17 assets the CSS names, not the
 * ~976 files and 273MB `digest` walks.
 */
object CssAssetUrls {

  /** The URL prefix `conf/routes` serves `public/` under, and so the root an absolute asset URL is relative to. */
  private val AssetsPrefix = "/assets/"

  /** A `url(...)` token. Exactly one group is non-null per match, and which one says how to requote the rewrite. */
  private val UrlToken: Regex = """url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s][^)]*?))\s*\)""".r

  /**
   * A URL naming something other than a file under `public/`: a `data:` payload, another origin, or an element in the
   * same document — which a minifier may write percent-escaped, as mapbox-gl's `url(%23clip)` does.
   */
  private val NotAFileReference: Regex = """(?i)^(?:[a-z][a-z0-9+.\-]*:|//|#|%23)""".r

  /**
   * @param mappings  The pipeline's mappings so far, as (file, path-relative-to-the-asset-root) pairs.
   * @param targetDir Directory to write the rewritten stylesheets into.
   * @param log       Where to report what was rewritten.
   * @return The same mappings, with each rewritten stylesheet's file replaced by its rewritten copy.
   */
  def apply(mappings: Seq[PathMapping], targetDir: File, log: Logger): Seq[PathMapping] = {
    IO.delete(targetDir) // No incremental state to preserve, and this way a renamed stylesheet leaves nothing stale.

    val filesByPath: Map[String, File] = mappings.map { case (file, path) => logicalPath(path) -> file }.toMap
    val digests                        = mutable.Map.empty[String, String] // Memoized: openhand.cur alone is named 4x.
    val problems                       = mutable.ListBuffer.empty[String]
    var references                     = 0
    var stylesheets                    = 0

    val rewritten = mappings.map {
      case mapping @ (file, path) if logicalPath(path).endsWith(".css") =>
        val cssPath = logicalPath(path)
        val source  = IO.read(file, IO.utf8)
        val out     = new StringBuilder
        var copied  = 0

        for (token <- UrlToken.findAllMatchIn(source)) {
          val quote = if (token.group(1) != null) "\"" else if (token.group(2) != null) "'" else ""
          val raw   = Option(token.group(1)).orElse(Option(token.group(2))).getOrElse(token.group(3)).trim
          out.append(source.substring(copied, token.start))
          fingerprinted(raw, cssPath, filesByPath, digests) match {
            case Right(Some(url)) => references += 1; out.append(s"url($quote$url$quote)")
            case Right(None)      => out.append(token.matched)
            case Left(reason)     =>
              problems += s"$cssPath: url($raw) $reason"
              out.append(token.matched)
          }
          copied = token.end
        }
        out.append(source.substring(copied))

        if (out.result() == source) mapping
        else {
          stylesheets += 1
          val rewrittenFile = targetDir / cssPath
          IO.createDirectory(rewrittenFile.getParentFile)
          IO.write(rewrittenFile, out.result(), IO.utf8)
          rewrittenFile -> path
        }
      case mapping => mapping
    }

    // Passing an unresolvable reference through would mean either a broken URL or an asset silently left on the
    // one-hour cache, and neither shows up at runtime. Same reasoning as build.sbt's asset-manifest generator.
    if (problems.nonEmpty) {
      sys.error(s"Unresolvable CSS asset URL(s):\n${problems.map("  " + _).mkString("\n")}")
    }
    log.info(s"Fingerprinted $references CSS url() reference(s) across $stylesheets stylesheet(s).")
    rewritten
  }

  /**
   * @param raw         The URL exactly as it appears in the stylesheet, unquoted.
   * @param cssPath     Logical path of the stylesheet naming it, which a relative URL resolves against.
   * @param filesByPath Every asset in the pipeline, by logical path.
   * @param digests     Memoized md5s, added to as files are hashed.
   * @return Right(Some(url)) to rewrite, Right(None) to leave the token alone, or Left(reason) if it names no asset.
   */
  private def fingerprinted(
      raw: String,
      cssPath: String,
      filesByPath: Map[String, File],
      digests: mutable.Map[String, String]
  ): Either[String, Option[String]] = {
    if (raw.isEmpty || NotAFileReference.findPrefixOf(raw).isDefined) return Right(None)

    // A query string or fragment is part of the URL but not of the filename, so it rides along untouched — Bootstrap's
    // glyphicons carry both (`...eot?#iefix`, `...svg#glyphicons_halflingsregular`).
    val cut                = raw.indexWhere(c => c == '?' || c == '#')
    val (pathPart, suffix) = if (cut < 0) (raw, "") else raw.splitAt(cut)

    val target: Option[String] =
      if (pathPart.startsWith(AssetsPrefix)) Some(pathPart.drop(AssetsPrefix.length))
      else if (pathPart.startsWith("/")) None // Absolute, but outside the tree the assets route serves.
      else resolve(cssPath.split('/').dropRight(1).toSeq, pathPart.split('/').toSeq)

    target.flatMap(path => filesByPath.get(path).map(path -> _)) match {
      case Some((path, file)) =>
        val digest = digests.getOrElseUpdate(path, md5(file))
        val slash  = pathPart.lastIndexOf('/')
        Right(Some(s"${pathPart.take(slash + 1)}$digest-${pathPart.drop(slash + 1)}$suffix"))
      case None =>
        Left("names no file under public/ — check the path, or drop the reference if the asset is gone")
    }
  }

  /**
   * @param base Segments of the stylesheet's own directory.
   * @param rel  Segments of the relative URL.
   * @return The logical path, or None if the URL climbs above the asset root.
   */
  private def resolve(base: Seq[String], rel: Seq[String]): Option[String] = {
    rel
      .foldLeft(Option(base.filter(_.nonEmpty))) {
        case (None, _)             => None
        case (Some(acc), "" | ".") => Some(acc)
        case (Some(acc), "..")     => if (acc.isEmpty) None else Some(acc.init)
        case (Some(acc), segment)  => Some(acc :+ segment)
      }
      .map(_.mkString("/"))
  }

  /** @return `path` with the platform's separators normalized to the '/' that both mappings and URLs use. */
  private def logicalPath(path: String): String = path.replace('\\', '/')

  /** @return The lowercase hex md5 of the file's bytes, which is the digest sbt-digest names its copy after. */
  private def md5(file: File): String = {
    val digest = MessageDigest.getInstance("MD5")
    val buffer = new Array[Byte](64 * 1024)
    val in     = new java.io.FileInputStream(file)
    try {
      var read = in.read(buffer)
      while (read > 0) {
        digest.update(buffer, 0, read)
        read = in.read(buffer)
      }
    } finally in.close()
    digest.digest().map(byte => f"$byte%02x").mkString
  }
}
