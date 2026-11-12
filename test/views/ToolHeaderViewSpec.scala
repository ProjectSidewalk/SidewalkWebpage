package views

import play.api.i18n.{Lang, Messages, MessagesApi}
import util.SidewalkSpec

/**
 * The tool header (#5958). Its callers pass the tool as a string, so nothing at compile time says the string names
 * a tool or that the tool's mark exists; this is where both are held.
 */
class ToolHeaderViewSpec extends SidewalkSpec with ViewSpecFixtures {

  private val tools = Seq("accessscore", "gallery", "labelmap", "reports")

  private def render(tool: String, asHeading: Boolean = true)(using Messages): String =
    views.html.common.toolHeader(tool, asHeading).body

  /** The name as rendered, whichever element holds it. */
  private def nameIn(body: String): String =
    """class="ps-tool-header__name">([^<]*)<""".r.findFirstMatchIn(body) match {
      case Some(m) => m.group(1)
      case None    => fail(s"no tool name rendered in: $body")
    }

  "The tool header" should {
    "name each tool and point at a mark that exists" in {
      val names = tools.map(tool => tool -> nameIn(render(tool))).toMap
      names mustBe Map(
        "accessscore" -> "AccessScore",
        "gallery"     -> "Gallery",
        "labelmap"    -> "LabelMap",
        "reports"     -> "Reports"
      )

      val marks = Map(
        "accessscore" -> "access-score",
        "gallery"     -> "gallery",
        "labelmap"    -> "label-map",
        "reports"     -> "reports"
      )
      for ((tool, mark) <- marks) {
        render(tool) must include(s"images/logos/tools/$mark")
        app.environment.getExistingFile(s"public/images/logos/tools/$mark.svg") mustBe defined
      }
    }

    "leave the mark out of the accessibility tree, since the name sits beside it" in {
      for (tool <- tools) {
        val img = """<img[^>]*>""".r.findFirstIn(render(tool)).getOrElse(fail(s"no mark rendered for $tool"))
        img must include("""alt=""""")
      }
    }

    "make the name the page's h1 unless the page has one of its own" in {
      render("gallery") must include("<h1 class=\"ps-tool-header__name\">")
      val plain = render("reports", asHeading = false)
      plain must not include "<h1"
      plain must include("<p class=\"ps-tool-header__name\">")
    }

    "translate the ordinary words and keep the wordmarks as written" in {
      val spanish: Messages = app.injector.instanceOf[MessagesApi].preferred(Seq(Lang("es")))
      nameIn(render("gallery")(using spanish)) mustBe "Galería"
      nameIn(render("reports")(using spanish)) mustBe "Informes"
      nameIn(render("accessscore")(using spanish)) mustBe "AccessScore"
      nameIn(render("labelmap")(using spanish)) mustBe "LabelMap"
    }

    "refuse a tool it has no mark for" in {
      an[IllegalArgumentException] must be thrownBy render("validate")
      an[IllegalArgumentException] must be thrownBy ToolLockup.name("validate")
      an[IllegalArgumentException] must be thrownBy ToolLockup.mark("validate")
    }

    "give a map page's own h1 the name its lockup shows" in {
      for (tool <- tools) ToolLockup.name(tool) mustBe nameIn(render(tool, asHeading = false))
    }
  }
}
