package models.utils

import java.awt.image.BufferedImage
import java.awt.{Rectangle, RenderingHints}
import java.io.{ByteArrayOutputStream, File}
import java.nio.file.{Files, StandardCopyOption}
import javax.imageio.stream.{
  FileImageInputStream,
  FileImageOutputStream,
  ImageOutputStream,
  MemoryCacheImageOutputStream
}
import javax.imageio.{IIOImage, ImageIO, ImageReader, ImageWriteParam}
import scala.jdk.CollectionConverters._
import scala.util.{Try, Using}

/**
 * Shared AWT/ImageIO helpers for the image-producing endpoints (share previews, story photos) and the crop job.
 */
object ImageUtils {

  /**
   * Opens an image for region reads, handing `f` the reader plus the dimensions from the header alone.
   *
   * This is how a panorama is read without ever decoding it whole: a 16384x8192 pano is ~512 MB as a BufferedImage,
   * so every consumer of one reads windows through [[readRegion]] instead. The reader is reused for as many windows
   * as the caller wants — the stream is opened seekable, so each read starts over from the image's first byte — and
   * is disposed with the stream on the way out.
   *
   * @param file The image file.
   * @param f    Receives the reader, the image width and the image height.
   * @return     Whatever `f` returns.
   * @throws IllegalArgumentException when no ImageIO reader claims the file.
   */
  def withReader[T](file: File)(f: (ImageReader, Int, Int) => T): T = {
    Using.resource(new FileImageInputStream(file)) { stream =>
      val reader = ImageIO
        .getImageReaders(stream)
        .asScala
        .nextOption()
        .getOrElse(throw new IllegalArgumentException(s"No image reader for ${file.getPath}"))
      try {
        reader.setInput(stream, false, true)
        f(reader, reader.getWidth(0), reader.getHeight(0))
      } finally reader.dispose()
    }
  }

  /**
   * Decodes one rectangular window of the reader's image. Memory is bounded by the window, not the image — decoding
   * is not: the reader walks the compressed stream from the start on every call, so N windows cost N passes over the
   * file. Cheap to bound the raster, not free to ask for another window.
   *
   * @param reader A reader from [[withReader]].
   * @param x      Leftmost source column.
   * @param y      Topmost source row.
   * @param width  Window width; must fit inside the image.
   * @param height Window height; must fit inside the image.
   * @return       The window, exactly `width` x `height`.
   */
  def readRegion(reader: ImageReader, x: Int, y: Int, width: Int, height: Int): BufferedImage = {
    val param = reader.getDefaultReadParam
    param.setSourceRegion(new Rectangle(x, y, width, height))
    reader.read(0, param)
  }

  /** Writes the image to the given file as PNG. Atomic, per [[atomically]]. */
  def writePng(img: BufferedImage, file: File): Unit = atomically(file) { tmp =>
    if (!ImageIO.write(img, "png", tmp)) throw new IllegalStateException("No PNG writer available")
  }

  /**
   * Builds `file`'s contents in a temp file in its own directory, then moves that over it, so a reader can never be
   * served a half-written file. Same directory because only a move within one filesystem is atomic.
   *
   * Concurrent writers may build in parallel (harmless duplicate work; last mover wins). A failed write leaves the
   * previous contents in place, which for derived imagery is the outcome to want: the next run tries again.
   *
   * @param file  The file to end up with.
   * @param write Receives the temp file to write into.
   */
  private def atomically(file: File)(write: File => Unit): Unit = {
    val tmp = File.createTempFile(s"${file.getName}.", ".tmp", file.getParentFile)
    try {
      write(tmp)
      val _ = Files.move(tmp.toPath, file.toPath, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    } finally {
      val _ = tmp.delete() // No-op after a successful move; cleans up the temp file if the write failed midway.
    }
  }

  /**
   * Scales `src` so its longest edge is at most `maxEdge`, repainting onto RGB (ImageIO's JPEG writer can't handle
   * alpha channels). Never upscales.
   *
   * Downscaling halves the image repeatedly before the final bilinear draw: a single bilinear pass from a much
   * larger source drops most of its samples and aliases, while `getScaledInstance(SCALE_SMOOTH)` — the usual
   * area-averaging alternative — is dramatically slower.
   */
  def scaleToMaxEdge(src: BufferedImage, maxEdge: Int): BufferedImage =
    scaleToMaxEdgeAs(src, maxEdge, BufferedImage.TYPE_INT_RGB)

  /**
   * Like `scaleToMaxEdge`, but keeps a transparent source transparent (ARGB) instead of flattening to RGB — for
   * PNG-bound output such as partner logos (#4516), where flattening would fill the background black.
   */
  def scaleToMaxEdgePreservingAlpha(src: BufferedImage, maxEdge: Int): BufferedImage = {
    val imageType = if (src.getColorModel.hasAlpha) BufferedImage.TYPE_INT_ARGB else BufferedImage.TYPE_INT_RGB
    scaleToMaxEdgeAs(src, maxEdge, imageType)
  }

  private def scaleToMaxEdgeAs(src: BufferedImage, maxEdge: Int, imageType: Int): BufferedImage = {
    val scale     = math.min(1.0, maxEdge.toDouble / math.max(src.getWidth, src.getHeight))
    val outWidth  = math.max(1, math.round(src.getWidth * scale).toInt)
    val outHeight = math.max(1, math.round(src.getHeight * scale).toInt)

    var current = src
    while (math.max(current.getWidth, current.getHeight) >= 2 * math.max(outWidth, outHeight)) {
      current = drawScaled(
        current,
        math.max(outWidth, current.getWidth / 2),
        math.max(outHeight, current.getHeight / 2),
        imageType
      )
    }
    drawScaled(current, outWidth, outHeight, imageType)
  }

  private def drawScaled(src: BufferedImage, width: Int, height: Int, imageType: Int): BufferedImage = {
    val out = new BufferedImage(width, height, imageType)
    val g2d = out.createGraphics()
    g2d.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR)
    g2d.drawImage(src, 0, 0, width, height, null)
    g2d.dispose()
    out
  }

  /**
   * Writes the image to the given file as a quality-controlled JPEG (ImageIO's default writer quality is lower).
   * Atomic, per [[atomically]].
   */
  def writeJpeg(img: BufferedImage, file: File, quality: Float): Unit = atomically(file) { tmp =>
    Using.resource(new FileImageOutputStream(tmp))(writeJpegTo(img, _, quality))
  }

  /** In-memory variant of `writeJpeg`, for images stored as DB bytes rather than files (partner logos, #4516). */
  def writeJpegBytes(img: BufferedImage, quality: Float): Array[Byte] = {
    val baos = new ByteArrayOutputStream()
    Using.resource(new MemoryCacheImageOutputStream(baos))(writeJpegTo(img, _, quality))
    baos.toByteArray
  }

  /** PNG bytes for an image; PNG is lossless, so unlike JPEG there is no quality knob. */
  def writePngBytes(img: BufferedImage): Array[Byte] = {
    val baos = new ByteArrayOutputStream()
    if (!ImageIO.write(img, "png", baos)) throw new IllegalStateException("No PNG writer available")
    baos.toByteArray
  }

  /**
   * Probes an image file's header without decoding pixel data — the shared upload guard for user-supplied images
   * (story photos, partner logos): the SNIFFED format (the client-declared MIME type plays no part) must be one of
   * `accepted`, and the declared dimensions must pass the decompression-bomb caps before anything decodes the raster.
   *
   * @param accepted     Lowercase ImageIO format names to allow (e.g. Set("jpeg", "png")).
   * @param maxDimension Per-edge cap on the declared dimensions.
   * @param maxPixels    Cap on declared width x height — a sane per-edge size can still decode to a huge raster.
   * @return The sniffed format name (lowercase), or None when the file is unreadable or trips a guard.
   */
  def sniffAcceptedFormat(file: File, accepted: Set[String], maxDimension: Int, maxPixels: Long): Option[String] = {
    Try {
      val stream = new FileImageInputStream(file)
      try {
        ImageIO.getImageReaders(stream).asScala.nextOption().flatMap { reader =>
          try {
            reader.setInput(stream)
            val width  = reader.getWidth(0)
            val height = reader.getHeight(0)
            val format = reader.getFormatName.toLowerCase
            Option.when(
              accepted.contains(format) && width <= maxDimension && height <= maxDimension &&
                width.toLong * height.toLong <= maxPixels
            )(format)
          } finally reader.dispose()
        }
      } finally stream.close()
    }.toOption.flatten
  }

  private def writeJpegTo(img: BufferedImage, out: ImageOutputStream, quality: Float): Unit = {
    val writer = ImageIO.getImageWritersByFormatName("jpg").next()
    try {
      val params = writer.getDefaultWriteParam
      params.setCompressionMode(ImageWriteParam.MODE_EXPLICIT)
      params.setCompressionQuality(quality)
      writer.setOutput(out)
      writer.write(null, new IIOImage(img, null, null), params)
    } finally writer.dispose()
  }
}
