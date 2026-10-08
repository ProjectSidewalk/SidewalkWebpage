package views

import util.SidewalkSpec
import views.ViteAssets.Chunk

/** The manifest walk behind `@ViteAssets.stylesheets` (#5651): the order is the cascade, so a page's own sheet comes last. */
class ViteAssetsSpec extends SidewalkSpec {

  private val manifest = Map(
    "frontend/js/pages/main.js"  -> Chunk("js/main.js", Seq("css/main-1.css"), Seq("_utilities-1.js")),
    "frontend/js/pages/about.js" -> Chunk("js/about.js", Seq("css/about-1.css"), Seq("_utilities-1.js", "_Toast-1.js")),
    "_utilities-1.js"            -> Chunk("js/chunks/utilities-1.js", Nil, Nil),
    "_Toast-1.js"  -> Chunk("js/chunks/Toast-1.js", Seq("css/Toast-1.css"), Seq("_utilities-1.js", "_Shared-1.js")),
    "_Shared-1.js" -> Chunk("js/chunks/Shared-1.js", Seq("css/Shared-1.css"), Seq("_Toast-1.js"))
  )

  "stylesheetsOf" should {
    "list the imported chunks' stylesheets before the entry's own, skipping chunks with none" in {
      ViteAssets.stylesheetsOf(manifest, "about") mustBe Seq("css/Shared-1.css", "css/Toast-1.css", "css/about-1.css")
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
