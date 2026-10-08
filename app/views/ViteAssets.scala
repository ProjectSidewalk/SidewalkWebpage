package views

import java.net.URL
import java.nio.file.{Files, Paths}
import java.util.concurrent.ConcurrentHashMap

import scala.collection.mutable
import scala.util.control.NonFatal

import controllers.AssetsFinder
import play.api.Logger
import play.api.libs.json.{JsObject, Json}
import play.twirl.api.Html

/**
 * The stylesheet tags a page needs, read from the build's manifest (Vite's backend integration, #5651).
 *
 * Vite splits stylesheets by chunk, so which files a page needs is only known after the build. JS needs no manifest:
 * an entry is built to `build/js/<name>.js` and imports its own chunks.
 */
object ViteAssets {

  private val logger = Logger(getClass)

  /** On the classpath, which is where Play serves `public/` from in every mode. */
  private val ManifestPath = "public/build/manifest.json"

  /** One chunk of the manifest: the file it was written to, and what it depends on. */
  private[views] case class Chunk(file: String, css: Seq[String], imports: Seq[String])

  /**
   * The parsed manifest, with each entry's answer kept once computed.
   *
   * Vite lists a stylesheet that several chunks import under each of them, after that chunk's own sheet. So a sheet
   * listed by more than one chunk is a shared one, and goes before the chunk's own so the page's rules win.
   */
  private[views] class Manifest(chunks: Map[String, Chunk]) {
    private val shared: Set[String] =
      chunks.values.toSeq.flatMap(_.css).groupBy(identity).collect { case (file, uses) if uses.size > 1 => file }.toSet
    private val byEntry = new ConcurrentHashMap[String, Seq[String]]()

    /** @return The entry's stylesheets, as paths under `public/build/`, each once, in cascade order. */
    def stylesheets(entry: String): Seq[String] = byEntry.computeIfAbsent(entry, walk)

    /** @return The entry's stylesheets in cascade order: each imported chunk's before its importer's. */
    private def walk(entry: String): Seq[String] = {
      val key  = s"frontend/js/pages/$entry.js"
      val root = chunks.getOrElse(key, throw new NoSuchElementException(s"$ManifestPath has no entry '$key'"))
      val seen = mutable.LinkedHashSet.empty[String]

      def visit(chunk: Chunk, visited: Set[String]): Unit = {
        chunk.imports.filterNot(visited).foreach(name => chunks.get(name).foreach(visit(_, visited + name)))
        val (folded, own) = chunk.css.partition(shared)
        seen ++= folded
        seen ++= own
      }
      visit(root, Set(key))
      seen.toSeq
    }
  }

  /** Keyed by modification time, so a rebuild under `vite build --watch` shows without a restart. */
  @volatile private var cached: Option[(Long, Manifest)] = None

  /**
   * @param entry         The page's entry name: its path under `frontend/js/pages/` without `.js` (`admin/shell`).
   * @param alreadyLinked Entries the enclosing layout already emitted tags for (`admin/shell` inside the admin layout),
   *                      so a sheet both need is linked once.
   * @return A `<link rel="stylesheet">` per stylesheet the entry still needs, in load order: imported chunks' sheets
   *         first, and shared sheets before a chunk's own.
   */
  def stylesheets(entry: String, alreadyLinked: String*)(using assets: AssetsFinder): Html =
    Html(
      stylesheetsOf(load(), entry, alreadyLinked)
        .map(file => s"""<link rel="stylesheet" href="${assets.path(s"build/$file")}">""")
        .mkString("\n")
    )

  /** @return The entry's stylesheets less those the `alreadyLinked` entries bring, in the manifest's cascade order. */
  private[views] def stylesheetsOf(manifest: Manifest, entry: String, alreadyLinked: Seq[String] = Nil): Seq[String] = {
    val linked = alreadyLinked.flatMap(manifest.stylesheets).toSet
    manifest.stylesheets(entry).filterNot(linked)
  }

  /** @return The manifest, re-read when the file has changed; the last good one if the new read fails mid-rebuild. */
  private def load(): Manifest = {
    val url: URL = Option(getClass.getClassLoader.getResource(ManifestPath)).getOrElse(
      throw new IllegalStateException(s"$ManifestPath is missing: the frontend has not been built (`npm run build`)")
    )
    // Only a file on disk can change under a running app; a jar's contents cannot. Asking the URL connection for the
    // time instead would open the file, or the jar, and leave it open.
    val modified = if (url.getProtocol == "file") Files.getLastModifiedTime(Paths.get(url.toURI)).toMillis else 0L
    cached match {
      case Some((at, manifest)) if at == modified => manifest
      case previous                               =>
        try {
          val manifest = parse(url)
          cached = Some((modified, manifest))
          manifest
        } catch {
          case NonFatal(e) if previous.isDefined =>
            logger.warn(s"$ManifestPath could not be read (${e.getMessage}); serving the previous build's")
            previous.get._2
        }
    }
  }

  /** @return The manifest at `url`, keeping only the fields the stylesheet walk reads. */
  private def parse(url: URL): Manifest = {
    val stream = url.openStream()
    val parsed =
      try Json.parse(stream).as[JsObject]
      finally stream.close()
    Manifest(parsed.fields.map { case (name, chunk) =>
      name -> Chunk(
        (chunk \ "file").as[String],
        (chunk \ "css").asOpt[Seq[String]].getOrElse(Nil),
        (chunk \ "imports").asOpt[Seq[String]].getOrElse(Nil)
      )
    }.toMap)
  }
}
