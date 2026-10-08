package views

import java.net.URL

import scala.collection.mutable

import controllers.AssetsFinder
import play.api.libs.json.{JsObject, Json}
import play.twirl.api.Html

/**
 * The Play half of Vite's backend integration (#5651): the stylesheet tags a page needs, from the build's manifest.
 *
 * Vite writes stylesheets split by chunk, so a component shared by several pages is one file they all load, and which
 * files an entry needs is only known after the build. The JS side needs no manifest: an entry is built to
 * `build/js/<name>.js` and imports its chunks itself.
 */
object ViteAssets {

  /** On the classpath, which is where Play serves `public/` from in every mode. */
  private val ManifestPath = "public/build/manifest.json"

  /** One chunk of the manifest: the file it was written to, and what it depends on. */
  private[views] case class Chunk(file: String, css: Seq[String], imports: Seq[String])

  /** Keyed by modification time, so a rebuild under `vite build --watch` shows without a restart. */
  @volatile private var cached: Option[(Long, Map[String, Chunk])] = None

  /**
   * @param entry The page's entry name: its path under `frontend/js/pages/` without the `.js` (`about`, `admin/shell`).
   * @return A `<link rel="stylesheet">` per stylesheet the entry needs, each once, in load order: what its imported
   *         chunks bring first, then its own, so a page's rules come after the components' it imports.
   */
  def stylesheets(entry: String)(using assets: AssetsFinder): Html =
    Html(
      stylesheetsOf(load(), entry)
        .map(file => s"""<link rel="stylesheet" href="${assets.path(s"build/$file")}">""")
        .mkString("\n")
    )

  /**
   * @param manifest The parsed manifest, keyed as Vite writes it.
   * @param entry    The page's entry name.
   * @return The entry's stylesheets, as paths under `public/build/`, each once, imported chunks' before its own.
   */
  private[views] def stylesheetsOf(manifest: Map[String, Chunk], entry: String): Seq[String] = {
    val key  = s"frontend/js/pages/$entry.js"
    val root = manifest.getOrElse(key, throw new NoSuchElementException(s"$ManifestPath has no entry '$key'"))
    val seen = mutable.LinkedHashSet.empty[String]

    def visit(chunk: Chunk, visited: Set[String]): Unit = {
      chunk.imports.filterNot(visited).foreach(name => manifest.get(name).foreach(visit(_, visited + name)))
      seen ++= chunk.css
    }
    visit(root, Set(key))
    seen.toSeq
  }

  /** @return The manifest, re-read when the file has changed. */
  private def load(): Map[String, Chunk] = {
    val url: URL = Option(getClass.getClassLoader.getResource(ManifestPath)).getOrElse(
      throw new IllegalStateException(s"$ManifestPath is missing: the frontend has not been built (`npm run build`)")
    )
    val connection = url.openConnection()
    connection.setUseCaches(false)
    val modified = connection.getLastModified
    cached match {
      case Some((at, manifest)) if at == modified => manifest
      case _                                      =>
        val stream = connection.getInputStream
        val parsed =
          try Json.parse(stream).as[JsObject]
          finally stream.close()
        val manifest = parsed.fields.map { case (name, chunk) =>
          name -> Chunk(
            (chunk \ "file").as[String],
            (chunk \ "css").asOpt[Seq[String]].getOrElse(Nil),
            (chunk \ "imports").asOpt[Seq[String]].getOrElse(Nil)
          )
        }.toMap
        cached = Some((modified, manifest))
        manifest
    }
  }
}
