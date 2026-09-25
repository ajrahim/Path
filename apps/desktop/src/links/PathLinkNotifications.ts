import { Notification } from "electron";
import messages from "@path/shared/messages/en.json";
import type { Diagnostics } from "../storage/DiagnosticLog";

/** Notification failures never interrupt a recording or turn committed work into a failure. */
export class PathLinkNotifications {
  private readonly visible = new Set<Notification>();

  constructor(
    private readonly open: (recordingId?: string) => void,
    private readonly diagnostics: Diagnostics,
  ) {}

  showStatus(): void {
    this.show("status", messages.appLinks.running);
  }

  show(
    phase: "starting" | "processing" | "complete" | "failed" | "status",
    detail: string,
    recordingId?: string,
  ): void {
    if (!Notification.isSupported()) {
      this.diagnostics.warn("System notifications are unavailable for Path links");

      return;
    }

    let notification: Notification | undefined;

    try {
      notification = new Notification({
        title: `Path — ${messages.appLinks[phase]}`,
        body: detail,
      });

      const visibleNotification = notification;

      this.visible.add(visibleNotification);
      notification.once("close", () => this.visible.delete(visibleNotification));
      notification.once("click", () => {
        this.visible.delete(visibleNotification);
        this.open(recordingId);
      });
      notification.once("failed", () => {
        this.visible.delete(visibleNotification);
        this.diagnostics.warn("A Path link system notification could not be shown");
      });
      notification.show();
    } catch (error) {
      if (notification) this.visible.delete(notification);
      this.diagnostics.warn("A Path link system notification could not be shown", error);
    }
  }
}
