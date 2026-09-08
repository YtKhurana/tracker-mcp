package tracker.mcp.spike;

import java.awt.GraphicsEnvironment;
import java.awt.Window;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.swing.SwingUtilities;
import javax.imageio.ImageIO;
import org.opensourcephysics.cabrillo.tracker.TFrame;
import org.opensourcephysics.cabrillo.tracker.TrackerIO;
import org.opensourcephysics.cabrillo.tracker.TrackerPanel;
import org.opensourcephysics.display.OSPRuntime;
import org.opensourcephysics.media.core.Video;

public final class S2Probe {
  private S2Probe() {}

  public static void main(String[] args) throws Exception {
    String mode = args.length == 0 ? "classpath" : args[0];
    try {
    switch (mode) {
      case "classpath" -> classpathProbe();
      case "construct" -> constructProbe();
      case "construct_no_frame" -> constructNoFrameProbe();
      case "load" -> loadProbe(args);
      case "write" -> loadProbe(args);
      case "reload" -> loadProbe(args);
      default -> throw new IllegalArgumentException("unknown S2 mode: " + mode);
    }
    } catch (Exception failure) {
      try {
        SwingUtilities.invokeAndWait(() -> {
          for (Window window : Window.getWindows()) {
            if (window instanceof TFrame frame) {
              frame.dispose();
              while (frame.getTabCount() > 0) frame.removeTabSynchronously(frame.getTrackerPanelForTab(0));
            }
          }
        });
      } catch (Exception cleanupFailure) {
        failure.addSuppressed(cleanupFailure);
      }
      throw failure;
    }
  }

  private static void classpathProbe() throws Exception {
    String javaHome = System.getProperty("java.home");
    boolean appRuntime = Path.of(javaHome).toRealPath().startsWith(
        Path.of("/Applications/Tracker.app/Contents/runtime/Contents/Home").toRealPath());
    Class.forName("org.opensourcephysics.cabrillo.tracker.TrackerPanel", false,
        S2Probe.class.getClassLoader());
    Class.forName("com.xuggle.xuggler.IContainer", false, S2Probe.class.getClassLoader());

    result("runtime_app_jre", appRuntime);
    result("tracker_class", true);
    result("xuggle_class", true);
    result("java_version", System.getProperty("java.version"));
    result("process_arch", System.getProperty("os.arch"));
    result("java_library_path", System.getProperty("java.library.path"));
  }

  private static void constructProbe() throws Exception {
    if (GraphicsEnvironment.isHeadless()) {
      throw new IllegalStateException("S2 requires a display-capable app JRE");
    }
    final ProbeState state = new ProbeState();
    AtomicReference<Throwable> asynchronousFailure = new AtomicReference<>();
    Thread.setDefaultUncaughtExceptionHandler((thread, failure) -> {
      asynchronousFailure.compareAndSet(null, failure);
      System.err.println("asynchronous failure on " + thread.getName() + ": " + failure);
      failure.printStackTrace(System.err);
    });
    SwingUtilities.invokeAndWait(() -> {
      state.frame = new TFrame();
      state.panel = new TrackerPanel(state.frame);
      state.frame.setVisible(false);

      state.frameVisibleDuringProbe = state.frame.isVisible();
      state.panelHasFrame = state.panel.getTFrame() == state.frame;
      state.visibleWindowsDuringProbe = visibleWindowCount();
    });
    Thread.sleep(500);
    SwingUtilities.invokeAndWait(() -> {
      state.panel.dispose();
      state.frame.dispose();
    });
    SwingUtilities.invokeAndWait(() -> state.visibleWindowsAfterDispose = visibleWindowCount());
    Thread.sleep(250);

    if (asynchronousFailure.get() != null) {
      throw new IllegalStateException("asynchronous AWT failure", asynchronousFailure.get());
    }

    result("headless", false);
    result("constructed_on_edt", true);
    result("frame_visible_during_probe", state.frameVisibleDuringProbe);
    result("panel_has_frame", state.panelHasFrame);
    result("visible_windows_during_probe", state.visibleWindowsDuringProbe);
    result("visible_windows_after_dispose", state.visibleWindowsAfterDispose);
  }

  private static void loadProbe(String[] args) throws Exception {
    if (args.length < 2) {
      throw new IllegalArgumentException("load mode requires an absolute video path");
    }
    Path videoPath = Path.of(args[1]).normalize();
    if (!videoPath.isAbsolute() || !videoPath.toFile().isFile()) {
      throw new IllegalArgumentException("video does not exist: " + videoPath);
    }
    Path outputDir = args.length >= 3
        ? Path.of(args[2]).toAbsolutePath().normalize()
        : Path.of("service", "build", "spikes", "output").toAbsolutePath().normalize();
    long timeoutSeconds = args.length >= 4 ? Long.parseLong(args[3]) : 30;
    outputDir.toFile().mkdirs();
    if (!outputDir.toFile().isDirectory()) {
      throw new IllegalArgumentException("output directory is unavailable: " + outputDir);
    }
    if (args[0].equals("write")) {
      try (var entries = java.nio.file.Files.list(outputDir)) {
        if (entries.findAny().isPresent()) throw new IllegalArgumentException("write output directory must be empty");
      }
    }
    if (GraphicsEnvironment.isHeadless()) {
      throw new IllegalStateException("S2 requires a display-capable app JRE");
    }

    final LoadState state = new LoadState();
    AtomicBoolean callbackHandled = new AtomicBoolean();
    CountDownLatch loaded = new CountDownLatch(1);
    AtomicReference<Throwable> asynchronousFailure = new AtomicReference<>();
    Thread.setDefaultUncaughtExceptionHandler((thread, failure) -> {
      asynchronousFailure.compareAndSet(null, failure);
      System.err.println("asynchronous failure on " + thread.getName() + ": " + failure);
      failure.printStackTrace(System.err);
      loaded.countDown();
    });
    OSPRuntime.autoAddLibrary = false;

    SwingUtilities.invokeAndWait(() -> {
      state.frame = new TFrame();
      state.frame.setVisible(false);
      TrackerIO.openURL(videoPath.toString(), state.frame, () -> {
        if (!callbackHandled.compareAndSet(false, true)) return;
        try {
          state.panel = state.frame.getSelectedPanel();
          state.visibleWindowsAtCallback = visibleWindowCount();
          if (state.panel != null) {
            state.video = state.panel.getVideo();
            if (state.video != null) {
              state.frameCount = state.video.getFrameCount();
              state.width = state.video.getImageSize(false).width;
              state.height = state.video.getImageSize(false).height;
              state.videoType = state.video.getTypeName();
              if (args[0].equals("write")) {
                S3Write.run(state.panel, videoPath, outputDir);
              }
              if (args[0].equals("reload")) S3Write.verifyReload(state.panel, outputDir);
              captureFrames(state.video, outputDir, state);
            }
          }
        } catch (Throwable failure) {
          asynchronousFailure.compareAndSet(null, failure);
        } finally {
          loaded.countDown();
        }
      });
    });

    if (!loaded.await(timeoutSeconds, TimeUnit.SECONDS)) {
      throw new IllegalStateException("video load timed out after " + timeoutSeconds + " seconds");
    }
    if (asynchronousFailure.get() != null) {
      throw new IllegalStateException("asynchronous Tracker load failure", asynchronousFailure.get());
    }
    if (state.panel == null || state.video == null) {
      throw new IllegalStateException("Tracker load callback completed without a video");
    }

    result("load_completed", true);
    result("path", videoPath);
    result("video_type", state.videoType);
    result("frame_count", state.frameCount);
    result("width", state.width);
    result("height", state.height);
    result("visible_windows_at_callback", state.visibleWindowsAtCallback);
    result("frame0_path", state.frame0Path);
    result("frame7_path", state.frame7Path);
    result("frame0_backseek_path", state.frame0BackseekPath);
    result("frame0_bright_center", state.frame0BrightCenter);
    result("frame7_bright_center", state.frame7BrightCenter);
    result("frame0_backseek_bright_center", state.frame0BackseekBrightCenter);

    Thread.sleep(500);
    SwingUtilities.invokeAndWait(() -> {
      // Dispose owned dialogs while the panel is still registered, then remove
      // the tab. Tracker 6.3.5's TrackControl disposal is not idempotent.
      state.frame.dispose();
      if (state.frame.getTab(state.panel.getID()) >= 0) {
        state.frame.removeTabSynchronously(state.panel);
      } else {
        state.panel.dispose();
      }
    });
    SwingUtilities.invokeAndWait(() -> state.visibleWindowsAfterDispose = visibleWindowCount());
    Thread.sleep(250);
    if (asynchronousFailure.get() != null) {
      throw new IllegalStateException("asynchronous AWT failure during teardown", asynchronousFailure.get());
    }
    result("visible_windows_after_dispose", state.visibleWindowsAfterDispose);
  }

  private static void constructNoFrameProbe() throws Exception {
    if (GraphicsEnvironment.isHeadless()) {
      throw new IllegalStateException("S2 requires a display-capable app JRE");
    }
    final ProbeState state = new ProbeState();
    AtomicReference<Throwable> asynchronousFailure = new AtomicReference<>();
    Thread.setDefaultUncaughtExceptionHandler((thread, failure) -> {
      asynchronousFailure.compareAndSet(null, failure);
      failure.printStackTrace(System.err);
    });
    SwingUtilities.invokeAndWait(() -> {
      state.panel = new TrackerPanel(false);
      state.panelHasFrame = state.panel.getTFrame() != null;
      state.visibleWindowsDuringProbe = visibleWindowCount();
    });
    Thread.sleep(500);
    SwingUtilities.invokeAndWait(() -> state.panel.dispose());
    SwingUtilities.invokeAndWait(() -> state.visibleWindowsAfterDispose = visibleWindowCount());
    Thread.sleep(250);
    if (asynchronousFailure.get() != null) {
      throw new IllegalStateException("asynchronous AWT failure", asynchronousFailure.get());
    }
    result("headless", false);
    result("constructed_on_edt", true);
    result("panel_has_frame", state.panelHasFrame);
    result("visible_windows_during_probe", state.visibleWindowsDuringProbe);
    result("visible_windows_after_dispose", state.visibleWindowsAfterDispose);
  }

  private static void captureFrames(Video video, Path outputDir, LoadState state) throws IOException {
    // Loaded projects retain their saved current frame; request zero explicitly.
    video.setFrameNumber(0);
    BufferedImage frame0 = video.getImage();
    if (frame0 == null || video.getFrameNumber() != 0) {
      throw new IOException("initial seek to frame 0 failed");
    }
    state.frame0Path = writePng(frame0, outputDir.resolve("frame0.png"));
    state.frame0BrightCenter = brightCenter(frame0);

    video.setFrameNumber(7);
    BufferedImage frame7 = video.getImage();
    if (frame7 == null || video.getFrameNumber() != 7) {
      throw new IOException("forward seek to frame 7 failed");
    }
    state.frame7Path = writePng(frame7, outputDir.resolve("frame7.png"));
    state.frame7BrightCenter = brightCenter(frame7);

    video.setFrameNumber(0);
    BufferedImage frame0Backseek = video.getImage();
    if (frame0Backseek == null || video.getFrameNumber() != 0) {
      throw new IOException("backward seek to frame 0 failed");
    }
    state.frame0BackseekPath = writePng(frame0Backseek, outputDir.resolve("frame0-after-backseek.png"));
    state.frame0BackseekBrightCenter = brightCenter(frame0Backseek);
  }

  private static Path writePng(BufferedImage image, Path path) throws IOException {
    if (!ImageIO.write(image, "png", path.toFile())) {
      throw new IOException("no PNG writer for " + path);
    }
    return path;
  }

  private static String brightCenter(BufferedImage image) throws IOException {
    long sumX = 0;
    long sumY = 0;
    long count = 0;
    for (int y = 0; y < image.getHeight(); y++) {
      for (int x = 0; x < image.getWidth(); x++) {
        int rgb = image.getRGB(x, y);
        int red = (rgb >> 16) & 0xff;
        int green = (rgb >> 8) & 0xff;
        int blue = rgb & 0xff;
        if (red > 180 && green > 160 && blue < 140) {
          sumX += x;
          sumY += y;
          count++;
        }
      }
    }
    if (count == 0) {
      throw new IOException("no bright fixture marker found in decoded frame");
    }
    return Math.round((double) sumX / count) + "," + Math.round((double) sumY / count);
  }

  private static long visibleWindowCount() {
    return Arrays.stream(Window.getWindows()).filter(Window::isVisible).count();
  }

  private static void result(String key, Object value) {
    System.out.println("RESULT " + key + "=" + value);
  }

  private static final class ProbeState {
    TFrame frame;
    TrackerPanel panel;
    boolean frameVisibleDuringProbe;
    boolean panelHasFrame;
    long visibleWindowsDuringProbe;
    long visibleWindowsAfterDispose;
  }

  private static final class LoadState {
    TFrame frame;
    TrackerPanel panel;
    Video video;
    String videoType;
    int frameCount;
    int width;
    int height;
    long visibleWindowsAtCallback;
    long visibleWindowsAfterDispose;
    Path frame0Path;
    Path frame7Path;
    Path frame0BackseekPath;
    String frame0BrightCenter;
    String frame7BrightCenter;
    String frame0BackseekBrightCenter;
  }
}
