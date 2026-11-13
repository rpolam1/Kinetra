import type { Patient, ProgressReport } from '../../domain';
import { buildReportHtml } from './reportHtml';

// How long to wait before removing the print frame if the browser never reports that printing finished
const CLEANUP_MS = 120_000;

/** Prints the report through a hidden frame so the person gets the browser's print dialog and can save a PDF. */
export function printProgressReport(patient: Patient, report: ProgressReport): void {
  // A frame is used instead of a new window because pop up blockers stop windows opened after an async step
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  let removed = false;
  // The frame can be removed by the afterprint event or by the timer, so this makes sure it only happens once
  const remove = () => {
    if (removed) return;
    removed = true;
    frame.remove();
  };
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) {
      remove();
      return;
    }
    win.addEventListener('afterprint', remove);
    win.focus();
    win.print();
  };
  frame.srcdoc = buildReportHtml(patient, report, Date.now());
  document.body.appendChild(frame);
  window.setTimeout(remove, CLEANUP_MS);
}
