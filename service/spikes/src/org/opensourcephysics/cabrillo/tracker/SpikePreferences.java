package org.opensourcephysics.cabrillo.tracker;

/** GPL-3. Package bridge to source-verified non-public Tracker preferences. */
public final class SpikePreferences {
  private SpikePreferences() {}
  public static void disableWarnings() {
    Tracker.warnSkippedStep = false;
    Tracker.warnVariableDuration = false;
  }
}
