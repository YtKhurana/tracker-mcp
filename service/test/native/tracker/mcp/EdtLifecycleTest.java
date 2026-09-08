package tracker.mcp;

import java.lang.reflect.*;
import java.nio.file.*;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import javax.swing.SwingUtilities;

/** GPL-3. Native/app-classpath lifecycle test; no production test hooks. */
public final class EdtLifecycleTest {
  private static final Method EDT=method("edt",Callable.class,int.class);
  private static final Method DISPATCH=method("dispatch",String.class,Map.class);
  private static final Method WRITE=method("writeAtomic",Path.class,byte[].class);
  private static final Method CLEANUP=method("edtCleanup");
  private static Method method(String name,Class<?>... params) {
    try {Method method=TrackerService.class.getDeclaredMethod(name,params);method.setAccessible(true);return method;}
    catch(ReflectiveOperationException failure){throw new AssertionError(failure);}
  }
  private static Object invoke(Method method,Object target,Object... args) throws Exception {
    try{return method.invoke(target,args);}catch(InvocationTargetException failure){if(failure.getCause() instanceof Exception ex)throw ex;throw new AssertionError(failure.getCause());}
  }
  private static void expect(String code,Callable<?> action) throws Exception {
    try{action.call();throw new AssertionError("Expected "+code);}catch(Failure failure){if(!failure.code.equals(code))throw new AssertionError("Expected "+code+", got "+failure.code);}
  }
  public static void main(String[] args) throws Exception {
    runningTimeout();queuedTimeout();
    SwingUtilities.invokeAndWait(()->{if(java.util.Arrays.stream(java.awt.Window.getWindows()).anyMatch(java.awt.Window::isVisible))throw new AssertionError("Visible service window");});
    System.out.println("EdtLifecycleTest passed: timeout, poison, late output suppression, queue cancellation, cleanup");
  }
  private static void runningTimeout() throws Exception {
    TrackerService service=new TrackerService();Path dir=Files.createTempDirectory("tracker-timeout-test-");Path output=dir.resolve("late.csv");
    CountDownLatch started=new CountDownLatch(1),release=new CountDownLatch(1);AtomicReference<String> lateFailure=new AtomicReference<>();
    ExecutorService owner=Executors.newSingleThreadExecutor();
    try {
      Future<?> request=owner.submit(()->{
        try{expect("TIMEOUT",()->invoke(EDT,service,(Callable<Object>)()->{
          started.countDown();if(!release.await(5,TimeUnit.SECONDS))throw new AssertionError("release missing");
          try{invoke(WRITE,service,output,new byte[]{1,2,3});throw new AssertionError("late write succeeded");}
          catch(Failure failure){lateFailure.set(failure.code);}
          return null;
        },200));}catch(Exception failure){throw new CompletionException(failure);}
      });
      if(!started.await(2,TimeUnit.SECONDS))throw new AssertionError("EDT action did not start");
      request.get(2,TimeUnit.SECONDS);
      expect("SERVICE_UNAVAILABLE",()->invoke(DISPATCH,service,"status",Map.of()));
      release.countDown();SwingUtilities.invokeAndWait(()->{});
      if(!"TIMEOUT".equals(lateFailure.get())||Files.exists(output))throw new AssertionError("Late output was not suppressed");
      try(var entries=Files.list(dir)){if(entries.findAny().isPresent())throw new AssertionError("Output staging leaked");}
      invoke(CLEANUP,service);
    }finally{release.countDown();owner.shutdownNow();Files.deleteIfExists(output);Files.deleteIfExists(dir);}
  }
  private static void queuedTimeout() throws Exception {
    TrackerService service=new TrackerService();CountDownLatch blocked=new CountDownLatch(1),release=new CountDownLatch(1);AtomicBoolean executed=new AtomicBoolean();
    SwingUtilities.invokeLater(()->{blocked.countDown();try{if(!release.await(5,TimeUnit.SECONDS))throw new AssertionError("release missing");}catch(InterruptedException failure){Thread.currentThread().interrupt();throw new AssertionError(failure);}});
    if(!blocked.await(2,TimeUnit.SECONDS))throw new AssertionError("EDT blocker did not start");
    try {
      expect("TIMEOUT",()->invoke(EDT,service,(Callable<Object>)()->{executed.set(true);return null;},100));
      expect("SERVICE_UNAVAILABLE",()->invoke(DISPATCH,service,"status",Map.of()));
    }finally{release.countDown();}
    SwingUtilities.invokeAndWait(()->{});
    if(executed.get())throw new AssertionError("Timed-out queued action executed");
    invoke(CLEANUP,service);
  }
}
