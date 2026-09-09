package service

import models.utils.ImageUtils
import org.scalatestplus.play.PlaySpec

import java.io.File
import java.nio.file.Files
import javax.imageio.ImageIO

/**
 * The on-demand display copy (#5256): the width arithmetic, the allowlist that bounds the cache, and a real
 * subsampled read against the crop fixtures' synthetic pano.
 */
class PanoDisplayCopySpec extends PlaySpec {

  private val pano = new File("test/resources/crops/synthetic-pano.png") // 1024x512

  "ImageUtils.subsamplePeriod" should {
    "leave an image the viewer can already texture alone" in {
      // Pannellum's limit is 2 x MAX_TEXTURE_SIZE, so a 16384-wide pano is exactly what an 8192 device renders.
      ImageUtils.subsamplePeriod(16384, 8192, 16384) mustBe 1
      ImageUtils.subsamplePeriod(11000, 5500, 16384) mustBe 1
    }

    "halve until both the width and the half-width height fit" in {
      ImageUtils.subsamplePeriod(16384, 8192, 8192) mustBe 2
      ImageUtils.subsamplePeriod(16384, 8192, 4096) mustBe 4
      // Under the cap rather than on it: powers of two are what a JPEG decoder can drop.
      ImageUtils.subsamplePeriod(11000, 5500, 8192) mustBe 2
    }

    "let the height bind on a pano that isn't 2:1" in {
      // Width alone would pass at period 1; the 8192-tall image needs the height under maxWidth / 2.
      ImageUtils.subsamplePeriod(8192, 8192, 8192) mustBe 2
    }
  }

  "PanoDisplayCopyService.snapToAllowed" should {
    "never hand back more than the device asked for" in {
      PanoDisplayCopyService.snapToAllowed(8192) mustBe 8192
      PanoDisplayCopyService.snapToAllowed(8191) mustBe 4096
      PanoDisplayCopyService.snapToAllowed(99999) mustBe 16384
    }

    "give the smallest allowed width to a device below the whole range" in {
      // Refusing would leave it the native file, which is strictly worse for a device that just said it can't.
      PanoDisplayCopyService.snapToAllowed(100) mustBe 2048
    }

    "only ever answer with a width the cache is allowed to hold" in {
      // The HMAC covers the path, not the query, so this is what stops a signed URL minting unbounded copies.
      for (w <- Seq(1, 100, 2047, 2048, 5000, 8192, 16384, 1000000)) {
        PanoDisplayCopyService.AllowedWidths must contain(PanoDisplayCopyService.snapToAllowed(w))
      }
    }
  }

  "ImageUtils.readSubsampled" should {
    "decode at the reduced size, and produce a JPEG a viewer can be handed" in {
      val out = File.createTempFile("display-copy", ".jpg")
      try {
        val img = ImageUtils.withReader(pano) { (reader, w, h) =>
          ImageUtils.subsamplePeriod(w, h, 512) mustBe 2
          ImageUtils.readSubsampled(reader, 2)
        }
        (img.getWidth, img.getHeight) mustBe (512, 256)
        ImageUtils.writeJpeg(img, out, PanoDisplayCopyService.JpegQuality)
        val written = ImageIO.read(out)
        (written.getWidth, written.getHeight) mustBe (512, 256)
        // The fixture's red channel ramps left to right; the copy keeps the image rather than a blank raster.
        ((written.getRGB(511, 128) >> 16) & 0xff) must be > (((written.getRGB(0, 128) >> 16) & 0xff) + 100)
      } finally {
        val _ = Files.deleteIfExists(out.toPath)
      }
    }
  }
}
