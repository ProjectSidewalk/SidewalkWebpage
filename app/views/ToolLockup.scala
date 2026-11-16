package views

import play.api.i18n.Messages

/**
 * Which mark and which name stand for each tool that has a logo (#5958).
 *
 * One table, because a page states its tool's name twice: in the visible lockup (`common.toolHeader`) and, where that
 * lockup sits in a panel that can be collapsed, in an `<h1>` outside the panel. Both read it from here.
 */
object ToolLockup {

  /**
   * The tool's name as the user reads it. "AccessScore" is a wordmark, the same in every language; the rest are
   * translated, Label Map through the navbar's key so the header matches the link that led there.
   *
   * @param tool "accessscore", "gallery", "labelmap" or "reports".
   * @return The name in the request's language.
   * @throws IllegalArgumentException for any other tool, so a typo fails the render rather than shipping a header
   *                                  with no name.
   */
  def name(tool: String)(using messages: Messages): String = tool match {
    case "accessscore" => "AccessScore"
    case "gallery"     => messages("gallery")
    case "labelmap"    => messages("navbar.labelmap")
    case "reports"     => messages("report.tool.name")
    case unknown       => throw noSuchTool(unknown)
  }

  /**
   * @param tool "accessscore", "gallery", "labelmap" or "reports".
   * @return The mark's file name, without extension, under `public/images/logos/tools/`.
   * @throws IllegalArgumentException for any other tool.
   */
  def mark(tool: String): String = tool match {
    case "accessscore" => "access-score"
    case "gallery"     => "gallery"
    case "labelmap"    => "label-map"
    case "reports"     => "reports"
    case unknown       => throw noSuchTool(unknown)
  }

  /** @return The error both lookups raise for a tool that has no logo. */
  private def noSuchTool(tool: String) = new IllegalArgumentException(s"No tool logo for '$tool'")
}
