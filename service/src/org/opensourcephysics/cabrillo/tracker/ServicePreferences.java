package org.opensourcephysics.cabrillo.tracker;

/** GPL-3. Source-verified package bridge; no dialog or action invocation. */
public final class ServicePreferences {
  private ServicePreferences() {}
  public static void configure() {
    Tracker.warnSkippedStep=false;
    Tracker.warnVariableDuration=false;
    Tracker.warnXuggleError=false;
  }
}
