package views

import util.SidewalkSpec
import views.ViteAssets.{Chunk, Manifest}

/** The manifest walk behind `@ViteAssets.stylesheets` (#5651): the order is the cascade, a page's own sheet last. */
class ViteAssetsSpec extends SidewalkSpec {

  // Toast is a component chunk with a sheet of its own. kpi is a sheet two entries import with no JS between them,
  // which Vite lists under each of them after the entry's own sheet.
  private val manifest = Manifest(
    Map(
      "frontend/js/pages/main.js"  -> Chunk("js/main.js", Seq("css/main-1.css"), Seq("_utilities-1.js")),
      "frontend/js/pages/about.js" ->
        Chunk("js/about.js", Seq("css/about-1.css"), Seq("_utilities-1.js", "_Toast-1.js")),
      "frontend/js/pages/admin/shell.js"  -> Chunk("js/admin/shell.js", Seq("css/shell-1.css", "css/kpi-1.css"), Nil),
      "frontend/js/pages/admin/health.js" ->
        Chunk("js/admin/health.js", Seq("css/health-1.css", "css/kpi-1.css"), Seq("_Toast-1.js")),
      "_utilities-1.js" -> Chunk("js/chunks/utilities-1.js", Nil, Nil),
      "_Toast-1.js"     ->
        Chunk("js/chunks/Toast-1.js", Seq("css/Toast-1.css"), Seq("_utilities-1.js", "_Shared-1.js")),
      "_Shared-1.js" -> Chunk("js/chunks/Shared-1.js", Seq("css/Shared-1.css"), Seq("_Toast-1.js"))
    )
  )

  "stylesheetsOf" should {
    "list the imported chunks' stylesheets before the entry's own, skipping chunks with none" in {
      ViteAssets.stylesheetsOf(manifest, "about") mustBe Seq("css/Shared-1.css", "css/Toast-1.css", "css/about-1.css")
    }

    "put a sheet shared with another chunk before the entry's own, whatever order the manifest lists them in" in {
      ViteAssets.stylesheetsOf(manifest, "admin/shell") mustBe Seq("css/kpi-1.css", "css/shell-1.css")
      ViteAssets.stylesheetsOf(manifest, "admin/health") mustBe
        Seq("css/Shared-1.css", "css/Toast-1.css", "css/kpi-1.css", "css/health-1.css")
    }

    "leave out what the enclosing layout's entry already linked" in {
      ViteAssets.stylesheetsOf(manifest, "admin/health", Seq("admin/shell")) mustBe
        Seq("css/Shared-1.css", "css/Toast-1.css", "css/health-1.css")
    }

    "survive an import cycle and list each stylesheet once" in {
      ViteAssets.stylesheetsOf(manifest, "main") mustBe Seq("css/main-1.css")
      ViteAssets.stylesheetsOf(manifest, "about").distinct.size mustBe 3
    }

    "name the missing entry when a view asks for one the build does not know" in {
      val error = intercept[NoSuchElementException](ViteAssets.stylesheetsOf(manifest, "nope"))
      error.getMessage must include("frontend/js/pages/nope.js")
    }
  }
}
