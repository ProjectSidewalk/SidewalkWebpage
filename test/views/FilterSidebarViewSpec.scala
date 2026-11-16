package views

import util.SidewalkSpec

/** The shared filter sidebar's section headings, whose level each host page picks to fit its own outline (#5964). */
class FilterSidebarViewSpec extends SidewalkSpec with ViewSpecFixtures {

  /** The heading tags the sidebar renders at a level, in order. */
  private def headingTags(level: Int): Seq[String] = {
    val body =
      views.html.common.filterSidebar(headingLevel = level, sections = Seq("severity", "admin", "streets")).body
    """<(h\d)[^>]*class="filter-sidebar__heading"""".r.findAllMatchIn(body).map(_.group(1)).toSeq
  }

  "The filter sidebar" should {
    "render every section heading at the level its host asks for" in {
      headingTags(2) mustBe Seq("h2", "h2", "h2")
      headingTags(3) mustBe Seq("h3", "h3", "h3")
    }

    "keep each heading's id and translation key" in {
      val body = views.html.common.filterSidebar(headingLevel = 2).body
      body must include(
        """<h2 class="filter-sidebar__heading" id="filter-sidebar-severity-heading" data-i18n="common:severity">"""
      )
      body must include("""<h2 class="filter-sidebar__heading" data-i18n="labelmap:streets">Streets</h2>""")
    }
  }
}
