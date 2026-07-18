package models.utils

import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.io.File
import java.nio.file.{Files, StandardCopyOption}
import javax.imageio.stream.FileImageOutputStream
import javax.imageio.{IIOImage, ImageIO, ImageWriteParam}
import scala.util.Using

/**
 * Shared AWT/ImageIO helpers for the image-producing endpoints (share previews, story photos).
 */
object ImageUtils {

  /**
   * Scales `src` so its longest edge is at most `maxEdge`, repainting onto RGB (ImageIO's JPEG writer can't handle
   * alpha channels). Never upscales.
   *
   * Downscaling halves the image repeatedly before the final bilinear draw: a single bilinear pass from a much
   * larger source drops most of its samples and aliases, while `getScaledInstance(SCALE_SMOOTH)` — the usual
   * area-averaging alternative — is dramatically slower.
   */
  def scaleToMaxEdge(src: BufferedImage, maxEdge: Int): BufferedImage = {
    val scale     = math.min(1.0, maxEdge.toDouble / math.max(src.getWidth, src.getHeight))
    val outWidth  = math.max(1, math.round(src.getWidth * scale).toInt)
    val outHeight = math.max(1, math.round(src.getHeight * scale).toInt)

    var current = src
    while (math.max(current.getWidth, current.getHeight) >= 2 * math.max(outWidth, outHeight)) {
      current =
        drawScaled(current, math.max(outWidth, current.getWidth / 2), math.max(outHeight, current.getHeight / 2))
    }
    drawScaled(current, outWidth, outHeight)
  }

  private def drawScaled(src: BufferedImage, width: Int, height: Int): BufferedImage = {
    val out = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB)
    val g2d = out.createGraphics()
    g2d.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR)
    g2d.drawImage(src, 0, 0, width, height, null)
    g2d.dispose()
    out
  }

  /**
   * Writes the image to the given file as a quality-controlled JPEG (ImageIO's default writer quality is lower).
   *
   * The write is atomic: bytes go to a temp file in the same directory, which is then moved over the target.
   * Concurrent writers may build in parallel (harmless duplicate work; last mover wins), but a reader can never be
   * served a half-written file.
   */
  def writeJpeg(img: BufferedImage, file: File, quality: Float): Unit = {
    val tmp    = File.createTempFile(s"${file.getName}.", ".tmp", file.getParentFile)
    val writer = ImageIO.getImageWritersByFormatName("jpg").next()
    try {
      val params = writer.getDefaultWriteParam
      params.setCompressionMode(ImageWriteParam.MODE_EXPLICIT)
      params.setCompressionQuality(quality)
      Using.resource(new FileImageOutputStream(tmp)) { out =>
        writer.setOutput(out)
        writer.write(null, new IIOImage(img, null, null), params)
      }
      val _ = Files.move(tmp.toPath, file.toPath, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    } finally {
      writer.dispose()
      val _ = tmp.delete() // No-op after a successful move; cleans up the temp file if the write failed midway.
    }
  }
}
