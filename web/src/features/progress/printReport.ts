import type { Patient, ProgressReport } from '../../domain';
import { buildReportHtml } from './reportHtml';

const CLEANUP_MS = 120_000;

export function printProgressReport(patient: Patient, report: ProgressReport): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  let removed = false;
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