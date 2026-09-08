package tracker.mcp.spike;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import javax.imageio.ImageIO;
import org.opensourcephysics.cabrillo.tracker.PointMass;
import org.opensourcephysics.cabrillo.tracker.PositionStep;
import org.opensourcephysics.cabrillo.tracker.SpikePreferences;
import org.opensourcephysics.cabrillo.tracker.TrackerPanel;
import org.opensourcephysics.controls.XMLControl;
import org.opensourcephysics.controls.XMLControlElement;
import org.opensourcephysics.display.Dataset;
import org.opensourcephysics.media.core.ImageCoordSystem;

/** GPL-3. Disposable experiment for the fixed synthetic-parabola-v1 fixture. */
final class S3Write {
  static void verifyReload(TrackerPanel panel, Path output) throws Exception {
    if (!(panel.getTrack("synthetic mass") instanceof PointMass mass)) throw new IOException("reloaded mass missing");
    verifyMarks(mass);
    requireClose(panel.getCoords().getAngle(0), Math.PI/6, "reloaded angle");
    requireClose(panel.getCoords().getOriginX(0), 96, "reloaded origin");
    requireClose(panel.getCoords().getScaleX(0), 40, "reloaded scale");
    export(mass, panel, output.resolve("reloaded.csv"));
    System.out.println("RESULT reload_verified=true");
  }
  static void run(TrackerPanel panel, Path video, Path output) throws Exception {
    // Tracker.java declares this package-private preference; never invoke its dialog.
    SpikePreferences.disableWarnings();

    ImageCoordSystem coords = panel.getCoords();
    coords.setLocked(false);
    coords.setFixedOrigin(true);
    coords.setFixedAngle(true);
    coords.setFixedScale(true);
    coords.setOriginXY(0, 96, 168);
    coords.setAngle(0, Math.PI / 6);
    coords.setScaleXY(0, 40, 40);
    panel.setLengthUnit("m", false);
    for (int n = 0; n < 12; n++) {
      requireClose(coords.getOriginX(n), 96, "origin x");
      requireClose(coords.getOriginY(n), 168, "origin y");
      requireClose(coords.getAngle(n), Math.PI / 6, "angle");
      requireClose(coords.getScaleX(n), 40, "scale");
    }
    System.out.println("RESULT coords_verified=true");

    PointMass mass = new PointMass();
    mass.setName("synthetic mass");
    mass.setMass(1);
    panel.addTrack(mass);
    mass.setLocked(false);
    for (int n = 0; n < 12; n++) {
      if (mass.createStep(n, 48 + 10*n + n*n, 190 - 7*n) == null) {
        throw new IllegalStateException("createStep rejected frame " + n);
      }
    }
    verifyMarks(mass);
    System.out.println("RESULT marks_verified=12");
    export(mass, panel, output.resolve("service.csv"));

    // Exercise correction and gap semantics, then restore the golden marks.
    mass.createStep(7, 180, 137);
    requireClose(((java.awt.geom.Point2D) ((PositionStep) mass.getStep(7)).getPosition()).getX(), 180, "replacement");
    mass.deleteStep(5);
    mass.deleteStep(6);
    if (mass.getStep(5) != null || mass.getStep(6) != null) {
      throw new IllegalStateException("gap deletion failed");
    }
    export(mass, panel, output.resolve("corrected.csv"));
    for (int n : new int[] {5, 6, 7}) mass.createStep(n, 48+10*n+n*n, 190-7*n);
    verifyMarks(mass);
    export(mass, panel, output.resolve("restored.csv"));
    if (!Files.readString(output.resolve("service.csv")).equals(Files.readString(output.resolve("restored.csv")))) {
      throw new IllegalStateException("restoring marks did not restore exported data");
    }

    String mediaName = "synthetic-parabola.mp4";
    Files.copy(video, output.resolve(mediaName));
    XMLControlElement control = new XMLControlElement(panel);
    XMLControl videoControl = control.getChildControl("videoclip").getChildControl("video");
    if (videoControl == null) throw new IOException("serialized video missing");
    // Same resource normalization as ExportZipDialog.java:280–298; no mark XML edits.
    videoControl.setValue("path", mediaName);
    videoControl.setValue("paths", null);
    Path trk = output.resolve("golden.trk");
    if (control.write(trk.toString()) == null || Files.size(trk) == 0) {
      throw new IOException("XMLControlElement.write failed");
    }
    Path html = output.resolve("golden_info.html");
    Files.writeString(html, "<!doctype html><title>Synthetic Tracker fixture</title><p>CC0 synthetic-parabola-v1, 12 frames, 10 fps.</p>", StandardCharsets.UTF_8);
    Path thumbnail = output.resolve("golden_thumbnail.png");
    panel.getVideo().setFrameNumber(0);
    if (!ImageIO.write(panel.getVideo().getImage(), "png", thumbnail.toFile())) throw new IOException("thumbnail failed");
    pack(output.resolve("minimal.trz"), trk, output.resolve(mediaName));
    pack(output.resolve("with-html.trz"), trk, output.resolve(mediaName), html);
    pack(output.resolve("with-html-thumbnail.trz"), trk, output.resolve(mediaName), html, thumbnail);
    System.out.println("RESULT write_candidates=" + output);
  }

  private static void verifyMarks(PointMass mass) {
    for (int n = 0; n < 12; n++) {
      PositionStep step = (PositionStep) mass.getStep(n);
      if (step == null) throw new IllegalStateException("missing mark " + n);
      java.awt.geom.Point2D point = step.getPosition();
      requireClose(point.getX(), 48+10*n+n*n, "mark x");
      requireClose(point.getY(), 190-7*n, "mark y");
    }
  }

  private static void export(PointMass mass, TrackerPanel panel, Path path) throws IOException {
    Map<String, double[]> columns = new LinkedHashMap<>();
    for (Dataset data : mass.getData(panel).getDatasets()) {
      columns.putIfAbsent(data.getXColumnName(), data.getXPoints());
      columns.put(data.getYColumnName(), data.getYPoints());
    }
    System.out.println("RESULT dataset_columns=" + columns.keySet());
    String[] names = {"t", "x", "y", "v_{x}", "v_{y}"};
    for (String name : names) if (!columns.containsKey(name)) throw new IOException("missing dataset " + name);
    int size = columns.get("t").length;
    if (size == 0) throw new IOException("empty data");
    for (String name : names) if (columns.get(name).length != size) throw new IOException("unaligned dataset " + name);
    StringBuilder csv = new StringBuilder("t,x,y,vx,vy\n");
    for (int row = 0; row < size; row++) {
      for (int col = 0; col < names.length; col++) {
        if (col > 0) csv.append(',');
        double value = columns.get(names[col])[row];
        if (Double.isFinite(value)) csv.append(Double.toString(value));
      }
      csv.append('\n');
    }
    Files.writeString(path, csv, StandardCharsets.UTF_8);
  }

  private static void pack(Path path, Path... entries) throws IOException {
    try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(path))) {
      for (Path entry : entries) {
        ZipEntry item = new ZipEntry(entry.getFileName().toString());
        item.setTime(0);
        zip.putNextEntry(item);
        Files.copy(entry, zip);
        zip.closeEntry();
      }
    }
  }

  private static void requireClose(double actual, double expected, String label) {
    if (!Double.isFinite(actual) || Math.abs(actual-expected) > 1e-10) {
      throw new IllegalStateException(label + ": " + actual + " != " + expected);
    }
  }
}
